import { describe, expect, it } from 'vitest';
import {
  computePrice,
  type MetalRateSnapshot,
  type PricingInput,
} from '../../src/lib/pricing/engine';
import { rupeesToPaise } from '../../src/lib/pricing/money';

/** A FIXED-price product at full price, tax-inclusive. Overridden per test. */
const fixed = (over: Partial<PricingInput> = {}): PricingInput => ({
  pricingMode: 'FIXED',
  sellingPricePaise: rupeesToPaise(3_650),
  mrpPaise: null,
  netMetalWeightMg: 0,
  makingChargeType: 'PERCENTAGE',
  makingChargeValue: 0,
  wastageBasisPoints: 0,
  stoneValuePaise: 0,
  discountBasisPoints: 0,
  taxRateBasisPoints: null,
  taxInclusive: true,
  ...over,
});

const metalRate = (over: Partial<PricingInput> = {}): PricingInput => ({
  ...fixed(),
  pricingMode: 'METAL_RATE',
  sellingPricePaise: null,
  netMetalWeightMg: 18_400,
  makingChargeType: 'PERCENTAGE',
  makingChargeValue: 1_200, // 12%
  taxInclusive: false, // gold is conventionally quoted before GST
  ...over,
});

/** 22K, at the rate quoted in Bengaluru the week this was written. */
const GOLD_22K: MetalRateSnapshot = {
  ratePerGramPaise: rupeesToPaise(14_800),
  finenessPpt: 916,
  effectiveFrom: new Date('2026-09-04T04:00:00Z'),
  source: 'IBJA',
};

const unwrap = (input: PricingInput, rate: MetalRateSnapshot | null = null) => {
  const result = computePrice(input, rate);
  if (!result.ok) throw new Error(`expected a price, got ${result.reason}`);
  return result.breakdown;
};

describe('FIXED pricing — sterling silver and giftware', () => {
  it('reproduces a real listing: ₹3,650 from ₹7,000, incl. of all taxes', () => {
    const b = unwrap(fixed({ mrpPaise: rupeesToPaise(7_000) }));

    expect(b.totalPaise).toBe(365_000);
    expect(b.mrpPaise).toBe(700_000);
    expect(b.savingsPaise).toBe(335_000);
    // The storefront this is modelled on displays "47% Off" for exactly these
    // numbers. 47.857% floored — matching is the point of the test.
    expect(b.discountPercent).toBe(47);

    // Tax is carved out of the price, not added to it.
    expect(b.taxableValuePaise).toBe(354_369);
    expect(b.taxPaise).toBe(10_631);
    expect(b.taxableValuePaise + b.taxPaise).toBe(b.totalPaise);
  });

  it('shows no compare-at price at full price', () => {
    const b = unwrap(fixed());
    expect(b.mrpPaise).toBeNull();
    expect(b.savingsPaise).toBeNull();
    expect(b.discountPercent).toBeNull();
  });

  it('ignores an MRP that is not above the selling price', () => {
    // The DB CHECK rejects this too; the engine must not render "0% off" if a
    // row ever slips through, e.g. from a future migration backfill.
    const b = unwrap(fixed({ mrpPaise: rupeesToPaise(3_650) }));
    expect(b.discountPercent).toBeNull();
  });

  it('adds tax on top when prices are quoted exclusive', () => {
    const b = unwrap(fixed({ taxInclusive: false }));
    expect(b.taxableValuePaise).toBe(365_000);
    expect(b.taxPaise).toBe(10_950);
    expect(b.totalPaise).toBe(375_950);
  });

  it('applies a per-product tax rate — giftware is not taxed like jewellery', () => {
    // Candles and home decor sit in a 12% slab, jewellery at 3%. One global
    // rate cannot be right for a catalog that sells both.
    const b = unwrap(fixed({ taxRateBasisPoints: 1_200, taxInclusive: false }));
    expect(b.taxRateBasisPoints).toBe(1_200);
    expect(b.taxPaise).toBe(43_800);
  });

  it('carries no rate provenance — no rate was involved', () => {
    expect(unwrap(fixed()).rate).toBeNull();
  });
});

describe('METAL_RATE pricing — solid gold', () => {
  it('builds the invoice the way a jeweller does', () => {
    const b = unwrap(metalRate({ wastageBasisPoints: 200 }), GOLD_22K);

    expect(b.lines.map((l) => l.key)).toEqual(['metal', 'wastage', 'making']);

    //  metal   18.400 g × ₹14,800    = ₹2,72,320.00
    //  wastage 2% of metal           =    ₹5,446.40
    //  making  12% of metal          =   ₹32,678.40
    //                                  ─────────────
    //                                  ₹3,10,444.80
    expect(b.lines[0]?.amountPaise).toBe(27_232_000);
    expect(b.lines[1]?.amountPaise).toBe(544_640);
    expect(b.lines[2]?.amountPaise).toBe(3_267_840);

    expect(b.taxableValuePaise).toBe(31_044_480);
    expect(b.taxPaise).toBe(931_334); // 3%
    expect(b.totalPaise).toBe(31_975_814);
  });

  it('labels the metal line with the weight and rate used', () => {
    const b = unwrap(metalRate(), GOLD_22K);
    expect(b.lines[0]?.detail).toBe('18.400 g × ₹14,800/g');
  });

  it.each([
    ['PERCENTAGE' as const, 1_200, 3_267_840], // 12% of ₹2,72,320
    ['PER_GRAM' as const, rupeesToPaise(450), 828_000], // ₹450/g × 18.4 g
    ['FLAT' as const, rupeesToPaise(6_500), 650_000], // ₹6,500 for the article
  ])('computes a %s making charge', (makingChargeType, makingChargeValue, expected) => {
    const b = unwrap(metalRate({ makingChargeType, makingChargeValue }), GOLD_22K);
    expect(b.lines.find((l) => l.key === 'making')?.amountPaise).toBe(expected);
  });

  it('discounts the making charge, not the metal', () => {
    // "Flat 20% off making charges" is the standard Indian jewellery promotion.
    // Nobody discounts the metal — it is a commodity passed through at cost.
    const b = unwrap(metalRate({ discountBasisPoints: 2_000 }), GOLD_22K);

    const metal = b.lines.find((l) => l.key === 'metal')?.amountPaise;
    const discount = b.lines.find((l) => l.key === 'making_discount');

    expect(metal).toBe(27_232_000); // untouched
    expect(discount?.amountPaise).toBe(-653_568); // 20% of ₹32,678.40
  });

  it('shows the discount as its own negative line, not netted off silently', () => {
    const b = unwrap(metalRate({ discountBasisPoints: 2_000 }), GOLD_22K);
    expect(b.lines.map((l) => l.key)).toContain('making_discount');
    // A customer must be able to see what they were given.
    expect(b.lines.find((l) => l.key === 'making')?.amountPaise).toBe(3_267_840);
  });

  it('includes stone value, independent of the metal rate', () => {
    const b = unwrap(metalRate({ stoneValuePaise: rupeesToPaise(18_000) }), GOLD_22K);
    expect(b.lines.find((l) => l.key === 'stones')?.amountPaise).toBe(1_800_000);
  });

  it('omits zero-value lines rather than printing ₹0 rows', () => {
    const b = unwrap(metalRate({ makingChargeValue: 0 }), GOLD_22K);
    expect(b.lines.map((l) => l.key)).toEqual(['metal']);
  });

  it('records which rate produced the quote', () => {
    // Provenance is what makes a past quote reproducible during a dispute.
    const b = unwrap(metalRate(), GOLD_22K);
    expect(b.rate).toEqual(GOLD_22K);
  });

  it('reprices when the rate moves, from identical product data', () => {
    const input = metalRate();
    const monday = unwrap(input, GOLD_22K);
    const tuesday = unwrap(input, { ...GOLD_22K, ratePerGramPaise: rupeesToPaise(15_200) });

    expect(tuesday.totalPaise).toBeGreaterThan(monday.totalPaise);
    // ...and yesterday's quote is still recoverable by passing yesterday's rate.
    expect(unwrap(input, GOLD_22K).totalPaise).toBe(monday.totalPaise);
  });
});

describe('failure modes', () => {
  it('refuses to price gold with no rate, rather than quoting ₹0', () => {
    const result = computePrice(metalRate(), null);
    expect(result).toEqual({ ok: false, reason: 'NO_RATE_AVAILABLE' });
  });

  it('refuses a FIXED product with no selling price', () => {
    const result = computePrice(fixed({ sellingPricePaise: null }), null);
    expect(result).toEqual({ ok: false, reason: 'MISSING_SELLING_PRICE' });
  });

  it('refuses a zero selling price — free is a bug, not a price', () => {
    const result = computePrice(fixed({ sellingPricePaise: 0 }), null);
    expect(result).toEqual({ ok: false, reason: 'MISSING_SELLING_PRICE' });
  });
});

describe('invariants', () => {
  it('lines always sum to the pre-tax value', () => {
    for (const wastageBasisPoints of [0, 200, 1_200]) {
      for (const discountBasisPoints of [0, 500, 2_000]) {
        for (const stoneValuePaise of [0, 1_800_000]) {
          const b = unwrap(
            metalRate({ wastageBasisPoints, discountBasisPoints, stoneValuePaise }),
            GOLD_22K,
          );
          const sum = b.lines.reduce((t, l) => t + l.amountPaise, 0);
          expect(sum).toBe(b.taxableValuePaise);
        }
      }
    }
  });

  it('taxable + tax === total, inclusive or exclusive, at every rate', () => {
    for (const taxInclusive of [true, false]) {
      for (const taxRateBasisPoints of [0, 300, 500, 1_200, 1_800]) {
        for (const price of [1, 99, 365_000, 31_044_480]) {
          const b = unwrap(fixed({ sellingPricePaise: price, taxRateBasisPoints, taxInclusive }));
          expect(b.taxableValuePaise + b.taxPaise).toBe(b.totalPaise);
        }
      }
    }
  });

  it('returns whole paise — never a fraction', () => {
    const b = unwrap(metalRate({ wastageBasisPoints: 733, discountBasisPoints: 1_337 }), {
      ...GOLD_22K,
      ratePerGramPaise: 1_487_137, // deliberately awkward
    });
    for (const line of b.lines) expect(Number.isInteger(line.amountPaise)).toBe(true);
    expect(Number.isInteger(b.taxPaise)).toBe(true);
    expect(Number.isInteger(b.totalPaise)).toBe(true);
  });
});
