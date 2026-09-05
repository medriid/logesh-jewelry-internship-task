import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { categories, products } from '../../src/db/schema';
import { createTestDatabase, PG, violationOf, type TestHarness } from '../helpers/database';

/**
 * These tests assert that the *database* refuses bad data — not that our service
 * layer remembers to check. Every rule here survives a buggy handler, a bad
 * migration, and somebody at a psql prompt at 2am.
 */

let h: TestHarness;
const CATEGORY_ID = '11111111-1111-1111-1111-111111111111';

/**
 * A row that satisfies every constraint; each test breaks exactly one field.
 * FIXED pricing, because that is the catalog default — sterling silver and
 * giftware, not gold.
 */
const validProduct = (overrides: Record<string, unknown> = {}) => ({
  sku: `LPE-${Math.random().toString(36).slice(2, 9).toUpperCase()}`,
  slug: `p-${Math.random().toString(36).slice(2, 9)}`,
  name: 'Test Piece',
  categoryId: CATEGORY_ID,
  grossWeightMg: 21_200,
  netMetalWeightMg: 18_400,
  pricingMode: 'FIXED' as const,
  sellingPricePaise: 365_000,
  ...overrides,
});

beforeAll(async () => {
  h = await createTestDatabase();
  await h.db.insert(categories).values({ id: CATEGORY_ID, slug: 'necklaces', name: 'Necklaces' });
});

afterAll(async () => h?.close());

describe('inventory invariants', () => {
  it('rejects negative stock', async () => {
    const v = await violationOf(() =>
      h.db.insert(products).values(validProduct({ stockQuantity: -1 })),
    );
    expect(v.code).toBe(PG.CHECK_VIOLATION);
    // Two checks cover this: stock >= 0, and reserved (0) <= stock (-1). Postgres
    // reports whichever it evaluates first, so accept either — the guarantee under
    // test is "negative stock cannot be stored", not the evaluation order.
    expect(v.constraint).toMatch(/^products_(stock_non_negative|reserved_within_stock)$/);
  });

  it('rejects reserving more than is on hand', async () => {
    const v = await violationOf(() =>
      h.db.insert(products).values(validProduct({ stockQuantity: 2, reservedQuantity: 3 })),
    );
    expect(v.constraint).toBe('products_reserved_within_stock');
  });

  it('allows reserving exactly the full stock — the boundary is inclusive', async () => {
    await expect(
      h.db.insert(products).values(validProduct({ stockQuantity: 2, reservedQuantity: 2 })),
    ).resolves.toBeDefined();
  });
});

describe('physical invariants', () => {
  it('rejects more metal than the article weighs', async () => {
    const v = await violationOf(() =>
      h.db.insert(products).values(validProduct({ grossWeightMg: 1_000, netMetalWeightMg: 9_000 })),
    );
    expect(v.constraint).toBe('products_net_within_gross');
  });

  it('rejects a fineness outside 1–1000 parts per thousand', async () => {
    const v = await violationOf(() =>
      h.db.insert(products).values(validProduct({ finenessPpt: 1_200 })),
    );
    expect(v.constraint).toBe('products_fineness_range');
  });

  it('accepts 925 sterling — the reason purity is fineness and not karat', async () => {
    // A `purityKarat` column could not express this at all: silver is not
    // measured in karats, and the old CHECK actively rejected 925.
    await expect(
      h.db.insert(products).values(validProduct({ metal: 'SILVER', finenessPpt: 925 })),
    ).resolves.toBeDefined();
  });

  it('accepts 916 for 22K gold on the same column', async () => {
    await expect(
      h.db.insert(products).values(validProduct({ metal: 'GOLD', finenessPpt: 916 })),
    ).resolves.toBeDefined();
  });
});

describe('pricing coherence', () => {
  it('rejects a FIXED-price product with no price — it would be unsellable', async () => {
    const v = await violationOf(() =>
      h.db.insert(products).values(validProduct({ pricingMode: 'FIXED', sellingPricePaise: null })),
    );
    expect(v.constraint).toBe('products_pricing_coherent');
  });

  it('rejects an MRP at or below the selling price', async () => {
    // A struck-through price below the selling price is a markup dressed as a
    // discount. Equal renders as "0% off", which looks broken.
    const v = await violationOf(() =>
      h.db.insert(products).values(validProduct({ sellingPricePaise: 365_000, mrpPaise: 365_000 })),
    );
    expect(v.constraint).toBe('products_mrp_above_selling');
  });

  it('accepts a genuine MRP above the selling price', async () => {
    await expect(
      h.db.insert(products).values(validProduct({ sellingPricePaise: 365_000, mrpPaise: 700_000 })),
    ).resolves.toBeDefined();
  });

  it('rejects a tax rate above 100%', async () => {
    const v = await violationOf(() =>
      h.db.insert(products).values(validProduct({ taxRateBasisPoints: 10_001 })),
    );
    expect(v.constraint).toBe('products_tax_rate_range');
  });

  it('rejects a METAL_RATE product with no metal — it would price at zero', async () => {
    const v = await violationOf(() =>
      h.db.insert(products).values(
        validProduct({
          pricingMode: 'METAL_RATE',
          sellingPricePaise: null,
          grossWeightMg: 500,
          netMetalWeightMg: 0,
        }),
      ),
    );
    expect(v.constraint).toBe('products_pricing_coherent');
  });

  it('rejects a discount above 100%', async () => {
    const v = await violationOf(() =>
      h.db.insert(products).values(validProduct({ discountBasisPoints: 10_001 })),
    );
    expect(v.constraint).toBe('products_discount_range');
  });
});

describe('full-text search column', () => {
  it('is generated by Postgres and weights the name above the description', async () => {
    await h.db.insert(products).values(
      validProduct({
        sku: 'LPE-NK-0001',
        slug: 'kundan-temple-choker',
        name: 'Kundan Temple Choker',
        shortDescription: 'Handcrafted 22K temple choker',
      }),
    );

    const [row] = await h.raw(
      `select search_vector::text as v from products where sku = 'LPE-NK-0001'`,
    );
    // 'kundan' appears only in the name → weight A. '22k' only in the short
    // description → weight B. Rank order falls out of that automatically.
    expect(row?.v).toMatch(/'kundan':\d+A/);
    expect(row?.v).toMatch(/'22k':\d+B/);
  });

  it('ranks a name match above a description-only match', async () => {
    await h.db
      .insert(products)
      .values(
        validProduct({ sku: 'LPE-A', slug: 'polki-necklace', name: 'Polki Bridal Necklace' }),
      );
    await h.db.insert(products).values(
      validProduct({
        sku: 'LPE-B',
        slug: 'plain-chain',
        name: 'Plain Rope Chain',
        description: 'Pairs beautifully with a polki set.',
      }),
    );

    const ranked = await h.raw(`
      select sku from products
      where search_vector @@ websearch_to_tsquery('english', 'polki')
      order by ts_rank(search_vector, websearch_to_tsquery('english', 'polki')) desc`);

    expect(ranked.map((r) => r.sku)).toEqual(['LPE-A', 'LPE-B']);
  });
});

describe('uniqueness', () => {
  it('refuses a duplicate SKU', async () => {
    await h.db.insert(products).values(validProduct({ sku: 'LPE-DUP', slug: 'dup-1' }));
    const v = await violationOf(() =>
      h.db.insert(products).values(validProduct({ sku: 'LPE-DUP', slug: 'dup-2' })),
    );
    expect(v.constraint).toBe('products_sku_uq');
  });
});
