import { brand } from '@/config/brand';
import {
  applyBasisPoints,
  discountPercent,
  formatGrams,
  formatINR,
  metalValue,
  MILLIGRAMS_PER_GRAM,
  splitTaxInclusive,
  type BasisPoints,
  type Paise,
} from './money';

/**
 * The pricing engine.
 *
 * A pure function. No database handle, no clock, no config lookup beyond the
 * static brand defaults — it takes a product and a rate and returns a fully
 * itemised breakdown. Three consequences, all of them the point:
 *
 *   1. It is exhaustively unit-testable without a database.
 *   2. Passing last Tuesday's rate reproduces last Tuesday's quote exactly,
 *      which is what makes a customer dispute a query rather than an argument.
 *   3. It returns a *breakdown*, not a number. A buyer can see ₹X of metal,
 *      ₹Y of labour and ₹Z of GST. That transparency is the brand.
 *
 * See docs/adr/0006-price-is-a-computation.md.
 */

// ── Inputs ───────────────────────────────────────────────────────────────────

export type PricingMode = 'FIXED' | 'METAL_RATE';
export type MakingChargeType = 'PER_GRAM' | 'PERCENTAGE' | 'FLAT';

/** The subset of a product row the engine reads. Nothing else is relevant. */
export type PricingInput = {
  pricingMode: PricingMode;

  /** FIXED: the price, before tax handling. */
  sellingPricePaise: Paise | null;
  /** FIXED: struck-through compare-at price, or null at full price. */
  mrpPaise: Paise | null;

  /** METAL_RATE: metal content, in milligrams. */
  netMetalWeightMg: number;
  makingChargeType: MakingChargeType;
  makingChargeValue: Paise;
  wastageBasisPoints: BasisPoints;
  stoneValuePaise: Paise;
  /** METAL_RATE: discount on the making charge only. */
  discountBasisPoints: BasisPoints;

  /** null falls back to the brand default. */
  taxRateBasisPoints: BasisPoints | null;
  taxInclusive: boolean;
};

export type MetalRateSnapshot = {
  ratePerGramPaise: Paise;
  finenessPpt: number;
  effectiveFrom: Date;
  source: string;
};

// ── Output ───────────────────────────────────────────────────────────────────

export type PriceLine = {
  /** Stable machine key, for clients that want to relabel or reorder. */
  key: 'metal' | 'wastage' | 'making' | 'making_discount' | 'stones' | 'item';
  label: string;
  /** Human detail: "18.400 g × ₹1,480.00/g". */
  detail?: string;
  amountPaise: Paise;
};

export type PriceBreakdown = {
  mode: PricingMode;
  currency: 'INR';

  lines: PriceLine[];

  /** Struck-through price and the saving against it, when there is one. */
  mrpPaise: Paise | null;
  savingsPaise: Paise | null;
  discountPercent: number | null;

  taxableValuePaise: Paise;
  taxPaise: Paise;
  taxRateBasisPoints: BasisPoints;
  taxLabel: string;
  taxInclusive: boolean;

  /** What the customer pays. Always `taxableValue + tax`. */
  totalPaise: Paise;

  /**
   * Which rate row produced this, when one was involved. Provenance is not
   * decoration — without it a past quote cannot be re-derived.
   */
  rate: MetalRateSnapshot | null;
};

/**
 * Why a price could not be produced. The database CHECK constraints already
 * guarantee a FIXED product has a price and a METAL_RATE product has metal, so
 * in practice this is the missing-rate case — but a product with no price must
 * render "Price on request", never "₹0".
 */
export type PricingFailure =
  'NO_RATE_AVAILABLE' | 'RATE_FINENESS_MISMATCH' | 'MISSING_SELLING_PRICE';

export type PriceResult =
  { ok: true; breakdown: PriceBreakdown } | { ok: false; reason: PricingFailure };

// ── Engine ───────────────────────────────────────────────────────────────────

export function computePrice(input: PricingInput, rate: MetalRateSnapshot | null): PriceResult {
  const taxRateBp = input.taxRateBasisPoints ?? brand.tax.defaultRateBasisPoints;

  const priced =
    input.pricingMode === 'FIXED' ? priceFixed(input) : priceFromMetalRate(input, rate);
  if (!priced.ok) return priced;

  const { lines, grossPaise, rateUsed } = priced;

  // `grossPaise` is what the customer pays if prices are quoted inclusive, or
  // the pre-tax base if they are quoted exclusive. Everything downstream of
  // here is identical for both pricing modes.
  const { taxableValuePaise, taxPaise, totalPaise } = input.taxInclusive
    ? inclusive(grossPaise, taxRateBp)
    : exclusive(grossPaise, taxRateBp);

  const mrpPaise = input.pricingMode === 'FIXED' ? input.mrpPaise : null;
  const hasCompareAt = mrpPaise !== null && mrpPaise > grossPaise;

  return {
    ok: true,
    breakdown: {
      mode: input.pricingMode,
      currency: 'INR',
      lines,
      mrpPaise: hasCompareAt ? mrpPaise : null,
      savingsPaise: hasCompareAt ? mrpPaise - grossPaise : null,
      discountPercent: hasCompareAt ? discountPercent(mrpPaise, grossPaise) : null,
      taxableValuePaise,
      taxPaise,
      taxRateBasisPoints: taxRateBp,
      taxLabel: brand.tax.label,
      taxInclusive: input.taxInclusive,
      totalPaise,
      rate: rateUsed,
    },
  };
}

// ── Modes ────────────────────────────────────────────────────────────────────

type Priced =
  | { ok: true; lines: PriceLine[]; grossPaise: Paise; rateUsed: MetalRateSnapshot | null }
  | { ok: false; reason: PricingFailure };

function priceFixed(input: PricingInput): Priced {
  if (input.sellingPricePaise === null || input.sellingPricePaise <= 0) {
    return { ok: false, reason: 'MISSING_SELLING_PRICE' };
  }
  return {
    ok: true,
    grossPaise: input.sellingPricePaise,
    rateUsed: null,
    lines: [{ key: 'item', label: 'Item price', amountPaise: input.sellingPricePaise }],
  };
}

/**
 * How an Indian jeweller actually builds a gold price:
 *
 *   metal    = rate × net weight
 *   wastage  = metal × wastage%          metal lost in fabrication, billed on
 *   making   = per-gram | % of metal | flat
 *   discount = making × discount%        the trade discounts labour, not metal
 *   stones   = flat, independent of the rate
 *
 * Wastage as a percentage of *weight* and as a percentage of *value* give the
 * same rupee figure, since value is weight × rate. The trade quotes it both
 * ways and means the same thing.
 *
 * A percentage making charge is taken on the base metal value, before wastage —
 * the prevailing retail convention. Charging labour on metal that was consumed
 * rather than delivered is the sharp-practice version.
 */
function priceFromMetalRate(input: PricingInput, rate: MetalRateSnapshot | null): Priced {
  if (!rate) return { ok: false, reason: 'NO_RATE_AVAILABLE' };

  const lines: PriceLine[] = [];

  const metal = metalValue(input.netMetalWeightMg, rate.ratePerGramPaise);
  lines.push({
    key: 'metal',
    label: 'Metal',
    detail: `${formatGrams(input.netMetalWeightMg)} g × ${formatINR(rate.ratePerGramPaise)}/g`,
    amountPaise: metal,
  });

  const wastage = applyBasisPoints(metal, input.wastageBasisPoints);
  if (wastage > 0) {
    lines.push({
      key: 'wastage',
      label: 'Wastage',
      detail: `${input.wastageBasisPoints / 100}%`,
      amountPaise: wastage,
    });
  }

  const making = makingCharge(input, metal);
  if (making > 0) {
    lines.push({
      key: 'making',
      label: 'Making charge',
      detail: makingChargeDetail(input, metal),
      amountPaise: making,
    });
  }

  // Negative line: it must be visible as a discount, not silently netted off
  // the making charge, or the customer cannot see what they were given.
  const makingDiscount = applyBasisPoints(making, input.discountBasisPoints);
  if (makingDiscount > 0) {
    lines.push({
      key: 'making_discount',
      label: 'Making charge discount',
      detail: `${input.discountBasisPoints / 100}% off`,
      amountPaise: -makingDiscount,
    });
  }

  if (input.stoneValuePaise > 0) {
    lines.push({ key: 'stones', label: 'Stones', amountPaise: input.stoneValuePaise });
  }

  const grossPaise = lines.reduce((sum, line) => sum + line.amountPaise, 0);
  return { ok: true, lines, grossPaise, rateUsed: rate };
}

function makingCharge(input: PricingInput, metalPaise: Paise): Paise {
  switch (input.makingChargeType) {
    case 'PER_GRAM':
      return metalValue(input.netMetalWeightMg, input.makingChargeValue);
    case 'PERCENTAGE':
      return applyBasisPoints(metalPaise, input.makingChargeValue);
    case 'FLAT':
      return input.makingChargeValue;
  }
}

function makingChargeDetail(input: PricingInput, metalPaise: Paise): string {
  switch (input.makingChargeType) {
    case 'PER_GRAM':
      return `${formatINR(input.makingChargeValue)}/g × ${formatGrams(input.netMetalWeightMg)} g`;
    case 'PERCENTAGE':
      return `${input.makingChargeValue / 100}% of ${formatINR(metalPaise)}`;
    case 'FLAT':
      return 'Flat';
  }
}

// ── Tax ──────────────────────────────────────────────────────────────────────

/**
 * Composite supply: ready-made jewellery is a single supply whose principal
 * component is the metal, so one rate applies to the whole invoice — metal,
 * wastage and making charge together. Showing a breakdown on the page does not
 * split the supply.
 *
 * The 5% job-work rate (SAC 9988) is a different transaction: a customer
 * bringing their own gold and paying for labour alone. A product catalog does
 * not sell that, so it is deliberately not modelled here.
 */
function exclusive(basePaise: Paise, rateBp: BasisPoints) {
  const taxPaise = applyBasisPoints(basePaise, rateBp);
  return { taxableValuePaise: basePaise, taxPaise, totalPaise: basePaise + taxPaise };
}

function inclusive(totalPaise: Paise, rateBp: BasisPoints) {
  const { basePaise, taxPaise } = splitTaxInclusive(totalPaise, rateBp);
  return { taxableValuePaise: basePaise, taxPaise, totalPaise };
}

// ── Convenience ──────────────────────────────────────────────────────────────

/** Which (metal, fineness) rate a product needs. Null for FIXED products. */
export function requiredRateKey(input: {
  pricingMode: PricingMode;
  metal: string;
  finenessPpt: number;
}): { metal: string; finenessPpt: number } | null {
  return input.pricingMode === 'METAL_RATE'
    ? { metal: input.metal, finenessPpt: input.finenessPpt }
    : null;
}

export const GRAMS = MILLIGRAMS_PER_GRAM;
