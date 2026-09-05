/**
 * Money primitives.
 *
 * Every amount in this codebase is an integer count of paise. See
 * docs/adr/0005-integer-money-and-weights.md for why. This module is the only
 * place that knows how to convert into and out of that representation, and the
 * only place that rounds.
 *
 * A branded `Paise` type was considered and rejected: Drizzle returns plain
 * `number`, so a brand would require an `as Paise` assertion at every read —
 * which is not type safety, it is a cast that looks like type safety. The
 * guarantees here come instead from unit-suffixed field names, arithmetic that
 * never leaves this file, and exhaustive tests on the boundaries.
 */

/** Integer paise. 100 paise = ₹1. */
export type Paise = number;
/** Hundredths of a percent. 10000 bp = 100%. */
export type BasisPoints = number;

export const PAISE_PER_RUPEE = 100;
export const BASIS_POINTS_SCALE = 10_000;
export const MILLIGRAMS_PER_GRAM = 1_000;

/**
 * Round half away from zero — the convention used on invoices.
 *
 * Not `Math.round`, which rounds half toward +Infinity: it turns -2.5 into -2,
 * so a -₹0.025 variant price delta would round the wrong way. Every amount here
 * is usually positive, but "usually" is not a guarantee worth relying on.
 */
export function roundHalfAwayFromZero(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/**
 * `amount × basisPoints / 10000`, rounded once.
 *
 * Multiply before dividing, always. Dividing first discards the fraction that
 * the multiplication would have recovered — the classic way a rounding bug
 * gets a few paise off on every line and lakhs off across a year.
 */
export function applyBasisPoints(amount: Paise, bp: BasisPoints): Paise {
  return roundHalfAwayFromZero((amount * bp) / BASIS_POINTS_SCALE);
}

/** Value of `weightMg` milligrams of metal at `ratePerGramPaise` per gram. */
export function metalValue(weightMg: number, ratePerGramPaise: Paise): Paise {
  return roundHalfAwayFromZero((weightMg * ratePerGramPaise) / MILLIGRAMS_PER_GRAM);
}

export function rupeesToPaise(rupees: number): Paise {
  return roundHalfAwayFromZero(rupees * PAISE_PER_RUPEE);
}

export function paiseToRupees(paise: Paise): number {
  return paise / PAISE_PER_RUPEE;
}

/**
 * Split a tax-inclusive amount into its base and its tax, exactly.
 *
 *   base = total × 10000 / (10000 + rate)
 *   tax  = total − base
 *
 * The tax is derived by subtraction rather than computed independently, so
 * `base + tax === total` holds for every input. Rounding both separately would
 * leave the two disagreeing with the price on the page by a paisa, which is the
 * kind of thing that shows up in a reconciliation six months later.
 */
export function splitTaxInclusive(
  totalPaise: Paise,
  rateBp: BasisPoints,
): { basePaise: Paise; taxPaise: Paise } {
  const basePaise = roundHalfAwayFromZero(
    (totalPaise * BASIS_POINTS_SCALE) / (BASIS_POINTS_SCALE + rateBp),
  );
  return { basePaise, taxPaise: totalPaise - basePaise };
}

/**
 * Discount percentage for display, **floored**.
 *
 * Floored, not rounded: showing "48% off" when the true figure is 47.86% is a
 * claim that overstates the saving, and overstating a discount is a consumer-
 * protection problem, not a rounding preference.
 */
export function discountPercent(mrpPaise: Paise, sellingPricePaise: Paise): number {
  if (mrpPaise <= 0 || sellingPricePaise >= mrpPaise) return 0;
  return Math.floor(((mrpPaise - sellingPricePaise) * 100) / mrpPaise);
}

/** Grams, to three decimals — the precision gold is traded at. */
export function formatGrams(weightMg: number): string {
  return (weightMg / MILLIGRAMS_PER_GRAM).toFixed(3);
}

/** Carats, from points. 1 carat = 100 points. */
export function formatCarats(points: number): string {
  return (points / 100).toFixed(2);
}

/**
 * `₹1,04,857.35` — Indian digit grouping (lakh/crore), not the Western
 * thousands grouping. `en-IN` gets this right; hand-rolled grouping does not.
 */
export function formatINR(paise: Paise, options: { showPaise?: boolean } = {}): string {
  const showPaise = options.showPaise ?? paise % PAISE_PER_RUPEE !== 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: showPaise ? 2 : 0,
    maximumFractionDigits: showPaise ? 2 : 0,
  }).format(paiseToRupees(paise));
}

/**
 * Karat from millesimal fineness, for display where karat is the customary
 * unit. 916 → 22. Meaningless for silver, so callers check the metal first.
 */
export function karatFromFineness(finenessPpt: number): number {
  return Math.round((finenessPpt * 24) / 1000);
}
