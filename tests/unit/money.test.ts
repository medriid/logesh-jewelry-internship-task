import { describe, expect, it } from 'vitest';
import {
  applyBasisPoints,
  discountPercent,
  formatCarats,
  formatGrams,
  formatINR,
  karatFromFineness,
  metalValue,
  roundHalfAwayFromZero,
  rupeesToPaise,
  splitTaxInclusive,
} from '../../src/lib/pricing/money';

describe('roundHalfAwayFromZero', () => {
  it.each([
    [2.5, 3],
    [2.4, 2],
    [2.6, 3],
    [0, 0],
    [-2.4, -2],
    // Math.round(-2.5) is -2, which rounds a negative price delta the wrong way.
    [-2.5, -3],
  ])('%p → %p', (input, expected) => {
    expect(roundHalfAwayFromZero(input)).toBe(expected);
  });
});

describe('applyBasisPoints', () => {
  it('computes 3% of ₹1,000', () => {
    expect(applyBasisPoints(100_000, 300)).toBe(3_000);
  });

  it('multiplies before dividing', () => {
    // 7 paise at 1 bp is 0.0007 paise. Dividing first (7 × (1/10000)) loses it
    // in float error; multiplying first gives an exact 0.0007 → rounds to 0.
    // The distinction matters at scale: this is the same code path that handles
    // ₹3,03,909.12 × 300bp, where a lost fraction is real money.
    expect(applyBasisPoints(7, 1)).toBe(0);
    expect(applyBasisPoints(30_390_912, 300)).toBe(911_727);
  });

  it('returns zero for a zero rate', () => {
    expect(applyBasisPoints(123_456, 0)).toBe(0);
  });
});

describe('metalValue', () => {
  it('prices 18.400 g at ₹14,800/g', () => {
    expect(metalValue(18_400, rupeesToPaise(14_800))).toBe(27_232_000);
  });

  it('handles sub-gram weights without losing precision', () => {
    // 0.001 g — one milligram, the smallest unit the schema stores.
    expect(metalValue(1, rupeesToPaise(14_800))).toBe(1_480);
  });
});

describe('splitTaxInclusive', () => {
  it('splits ₹3,650 inclusive of 3% GST', () => {
    const { basePaise, taxPaise } = splitTaxInclusive(365_000, 300);
    expect(basePaise).toBe(354_369);
    expect(taxPaise).toBe(10_631);
  });

  it('always reconciles exactly — base + tax === total', () => {
    // The reason tax is derived by subtraction rather than computed. Rounding
    // both independently leaves them a paisa off the price on the page.
    for (let total = 1; total <= 5_000; total += 7) {
      for (const rate of [300, 500, 1_200, 1_800]) {
        const { basePaise, taxPaise } = splitTaxInclusive(total, rate);
        expect(basePaise + taxPaise).toBe(total);
      }
    }
  });

  it('is a no-op at a zero rate', () => {
    expect(splitTaxInclusive(365_000, 0)).toEqual({ basePaise: 365_000, taxPaise: 0 });
  });
});

describe('discountPercent', () => {
  it('floors rather than rounds', () => {
    // ₹3,650 from ₹7,000 is 47.857%. Displaying 48% overstates the saving.
    expect(discountPercent(700_000, 365_000)).toBe(47);
  });

  it.each([
    [700_000, 700_000, 0], // no discount
    [700_000, 800_000, 0], // "discount" above MRP is not a discount
    [0, 100, 0], // no MRP
    [100_000, 1, 99], // near-total discount stays under 100
  ])('mrp %p → selling %p gives %p%%', (mrp, selling, expected) => {
    expect(discountPercent(mrp, selling)).toBe(expected);
  });
});

describe('formatINR', () => {
  it('uses Indian lakh grouping, not Western thousands', () => {
    // ₹1,04,857.35 — not ₹104,857.35.
    expect(formatINR(10_485_735)).toBe('₹1,04,857.35');
  });

  it('omits paise when the amount is whole rupees', () => {
    expect(formatINR(365_000)).toBe('₹3,650');
  });

  it('shows paise when asked, even on a whole amount', () => {
    expect(formatINR(365_000, { showPaise: true })).toBe('₹3,650.00');
  });
});

describe('weights', () => {
  it('formats grams to the three decimals gold trades at', () => {
    expect(formatGrams(18_400)).toBe('18.400');
    expect(formatGrams(1)).toBe('0.001');
  });

  it('formats points as carats', () => {
    expect(formatCarats(75)).toBe('0.75');
  });
});

describe('karatFromFineness', () => {
  it.each([
    [999, 24],
    [916, 22],
    [750, 18],
    [585, 14],
  ])('%p ppt → %pK', (fineness, karat) => {
    expect(karatFromFineness(fineness)).toBe(karat);
  });
});
