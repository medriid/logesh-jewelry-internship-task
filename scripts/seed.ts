/**
 * Seed the catalog with a realistic mix.
 *
 * Deliberately spans the whole range the business actually sells: 925 sterling
 * silver at fixed prices with struck-through MRPs, oxidised and kundan fashion
 * pieces, non-jewellery giftware at a different GST slab, and one solid-gold
 * piece priced from the live metal rate — so both pricing modes are exercised
 * by real rows rather than only by tests.
 *
 *   npm run db:seed
 */
import { sql } from 'drizzle-orm';

import { env } from '../src/config/env';
import { closeDb, db } from '../src/db';
import {
  adminUsers,
  attributeDefinitions,
  categories,
  collections,
  metalRates,
  productImages,
  products,
  stockLedger,
} from '../src/db/schema';
import { hashPassword } from '../src/lib/auth/password';

const rupees = (n: number) => Math.round(n * 100);
const grams = (n: number) => Math.round(n * 1000);

async function main() {
  console.log(`→ seeding ${env.DATABASE_DRIVER}`);

  // Idempotent: a re-run replaces the sample data rather than duplicating it.
  await db.execute(sql`
    truncate table stock_ledger, product_images, product_attributes, products,
                   collections, categories, attribute_definitions, metal_rates,
                   audit_logs, sessions, api_keys, admin_users
    restart identity cascade`);

  // ── Operator ──────────────────────────────────────────────────────────────
  const email = env.SEED_ADMIN_EMAIL ?? 'owner@loupe.jewelry';
  const password = env.SEED_ADMIN_PASSWORD ?? 'change-this-immediately';
  const [owner] = await db
    .insert(adminUsers)
    .values({
      email,
      name: 'Store Owner',
      passwordHash: await hashPassword(password),
      role: 'OWNER',
      status: 'ACTIVE',
    })
    .returning({ id: adminUsers.id });

  // ── Metal rate ────────────────────────────────────────────────────────────
  // 22K gold in Bengaluru, early September 2026. Real order of magnitude —
  // a placeholder rate makes every gold price on the page obviously wrong.
  await db.insert(metalRates).values([
    {
      metal: 'GOLD',
      finenessPpt: 916,
      ratePerGramPaise: rupees(14_852),
      source: 'IBJA',
      createdBy: owner!.id,
    },
    {
      metal: 'GOLD',
      finenessPpt: 999,
      ratePerGramPaise: rupees(16_203),
      source: 'IBJA',
      createdBy: owner!.id,
    },
    {
      metal: 'SILVER',
      finenessPpt: 925,
      ratePerGramPaise: rupees(192),
      source: 'IBJA',
      createdBy: owner!.id,
    },
  ]);

  // ── Taxonomy ──────────────────────────────────────────────────────────────
  const cats = await db
    .insert(categories)
    .values([
      { slug: 'earrings', name: 'Earrings', position: 1 },
      { slug: 'necklaces', name: 'Necklaces & Sets', position: 2 },
      { slug: 'bracelets', name: 'Bracelets', position: 3 },
      { slug: 'rings', name: 'Rings', position: 4 },
      { slug: 'giftware', name: 'Candles & Home', position: 5 },
    ])
    .returning({ id: categories.id, slug: categories.slug });
  const cat = (slug: string) => cats.find((c) => c.slug === slug)!.id;

  const [festive] = await db
    .insert(collections)
    .values({
      slug: 'diwali-2026',
      name: 'Diwali 2026',
      occasion: 'FESTIVE',
      description: 'Pieces chosen for the season of giving.',
      startsAt: new Date('2026-10-01'),
      endsAt: new Date('2026-11-15'),
    })
    .returning({ id: collections.id });

  // ── Custom attributes — the extensibility layer, with real values ─────────
  await db.insert(attributeDefinitions).values([
    {
      key: 'finish',
      label: 'Finish',
      type: 'ENUM',
      allowedValues: ['Oxidised', 'Rhodium', 'Gold Plated', 'Antique'],
      isFilterable: true,
      position: 1,
    },
    {
      key: 'stone',
      label: 'Stone',
      type: 'ENUM',
      allowedValues: ['Zircon', 'Kundan', 'Moonstone', 'Crystal', 'None'],
      isFilterable: true,
      position: 2,
    },
    {
      key: 'chain_length',
      label: 'Chain length',
      type: 'NUMBER',
      unit: 'inch',
      isFilterable: true,
      position: 3,
    },
  ]);

  // ── Products ──────────────────────────────────────────────────────────────
  const rows = await db
    .insert(products)
    .values([
      {
        sku: 'LPE-NK-0001',
        slug: 'radiant-filigree-moonstone-drop-necklace',
        name: 'Radiant Filigree Moonstone Drop Necklace',
        shortDescription: 'Hand-worked 925 filigree with a moonstone drop.',
        description:
          'Lace-like filigree, hand-set in 925 sterling silver, finished with a single moonstone drop. Light enough for all-day wear; the openwork catches light with every movement. Supplied as a matching earring and pendant set.',
        categoryId: cat('necklaces'),
        collectionId: festive!.id,
        metal: 'SILVER',
        finenessPpt: 925,
        grossWeightMg: grams(12.4),
        netMetalWeightMg: grams(11.8),
        pricingMode: 'FIXED',
        sellingPricePaise: rupees(3_650),
        mrpPaise: rupees(7_000),
        taxInclusive: true,
        stockQuantity: 8,
        lowStockThreshold: 2,
        status: 'ACTIVE',
        isFeatured: true,
        publishedAt: new Date(),
      },
      {
        sku: 'LPE-ER-0002',
        slug: 'oxidised-temple-jhumka',
        name: 'Oxidised Temple Jhumka',
        shortDescription: 'Antique-finish jhumkas with temple motif work.',
        description:
          'Traditional temple motifs in an oxidised antique finish. Lightweight domes with a secure post fitting.',
        categoryId: cat('earrings'),
        collectionId: festive!.id,
        metal: 'SILVER',
        finenessPpt: 925,
        grossWeightMg: grams(9.2),
        netMetalWeightMg: grams(9.2),
        pricingMode: 'FIXED',
        sellingPricePaise: rupees(2_199),
        mrpPaise: rupees(3_400),
        taxInclusive: true,
        stockQuantity: 2, // deliberately at the low-stock threshold
        lowStockThreshold: 2,
        status: 'ACTIVE',
        publishedAt: new Date(),
      },
      {
        sku: 'LPE-ER-0003',
        slug: 'zircon-chandbali',
        name: 'Zircon Chandbali',
        shortDescription: 'Crescent chandbali set with cubic zircon.',
        categoryId: cat('earrings'),
        metal: 'SILVER',
        finenessPpt: 925,
        grossWeightMg: grams(14.1),
        netMetalWeightMg: grams(12.6),
        pricingMode: 'FIXED',
        sellingPricePaise: rupees(4_299),
        taxInclusive: true,
        // Out of stock, but made to order — the storefront must show this as
        // purchasable-with-a-wait, not simply unavailable.
        stockQuantity: 0,
        allowBackorder: true,
        status: 'ACTIVE',
        publishedAt: new Date(),
      },
      {
        sku: 'LPE-BR-0004',
        slug: 'kundan-cuff-bracelet',
        name: 'Kundan Cuff Bracelet',
        shortDescription: 'Uncut kundan stones in an adjustable cuff.',
        categoryId: cat('bracelets'),
        metal: 'SILVER',
        finenessPpt: 925,
        grossWeightMg: grams(21.7),
        netMetalWeightMg: grams(18.3),
        pricingMode: 'FIXED',
        sellingPricePaise: rupees(5_850),
        mrpPaise: rupees(9_200),
        taxInclusive: true,
        stockQuantity: 0, // genuinely unavailable
        allowBackorder: false,
        status: 'ACTIVE',
        publishedAt: new Date(),
      },
      {
        // The one gold piece. Priced from the live rate, so it demonstrates the
        // METAL_RATE path against a real row.
        sku: 'LPE-NK-0005',
        slug: 'temple-choker-22k',
        name: 'Temple Choker, 22K',
        shortDescription: 'Hallmarked 22K gold, priced against today’s rate.',
        description:
          'Cast and hand-finished in 22K. Priced transparently: metal at the day’s rate on the stated net weight, plus a 12% making charge. BIS hallmarked with a six-character HUID.',
        categoryId: cat('necklaces'),
        metal: 'GOLD',
        finenessPpt: 916,
        isHallmarked: true,
        hallmarkNumber: 'AZ4K91',
        grossWeightMg: grams(21.2),
        netMetalWeightMg: grams(18.4),
        pricingMode: 'METAL_RATE',
        makingChargeType: 'PERCENTAGE',
        makingChargeValue: 1_200, // 12%
        wastageBasisPoints: 200, // 2%
        discountBasisPoints: 2_000, // 20% off making charges — festive offer
        taxInclusive: false, // gold is quoted before GST
        stockQuantity: 1, // one of a kind
        lowStockThreshold: 1,
        status: 'ACTIVE',
        isFeatured: true,
        publishedAt: new Date(),
      },
      {
        // Giftware. Different GST slab — the reason tax rate is per product.
        sku: 'LPE-GF-0006',
        slug: 'brass-diya-candle-set',
        name: 'Brass Diya Candle Set',
        shortDescription: 'Set of four cast brass diyas with soy candles.',
        categoryId: cat('giftware'),
        collectionId: festive!.id,
        metal: 'SILVER', // not precious; weights left at zero
        finenessPpt: 1,
        grossWeightMg: 0,
        netMetalWeightMg: 0,
        pricingMode: 'FIXED',
        sellingPricePaise: rupees(1_450),
        mrpPaise: rupees(1_900),
        taxRateBasisPoints: 1_200, // candles are 12%, not 3%
        taxInclusive: true,
        stockQuantity: 24,
        status: 'ACTIVE',
        publishedAt: new Date(),
      },
      {
        sku: 'LPE-RG-0007',
        slug: 'stacking-band-trio',
        name: 'Stacking Band Trio',
        shortDescription: 'Three fine 925 bands, worn together or apart.',
        categoryId: cat('rings'),
        metal: 'SILVER',
        finenessPpt: 925,
        grossWeightMg: grams(4.8),
        netMetalWeightMg: grams(4.8),
        pricingMode: 'FIXED',
        sellingPricePaise: rupees(1_899),
        taxInclusive: true,
        stockQuantity: 15,
        status: 'DRAFT', // unpublished — must not appear in public listings
      },
    ])
    .returning({ id: products.id, sku: products.sku, stockQuantity: products.stockQuantity });

  // Opening balances. Stock never changes without a ledger row, including here.
  await db.insert(stockLedger).values(
    rows
      .filter((r) => r.stockQuantity > 0)
      .map((r) => ({
        productId: r.id,
        delta: r.stockQuantity,
        balanceAfter: r.stockQuantity,
        reason: 'INITIAL' as const,
        note: 'Opening balance from seed',
        actorId: owner!.id,
      })),
  );

  await db.insert(productImages).values(
    rows.map((r, i) => ({
      productId: r.id,
      url: `https://images.unsplash.com/photo-15${15 + i}000000000-placeholder`,
      altText: `${r.sku} photographed on a neutral ground`,
      isPrimary: true,
      position: 0,
    })),
  );

  console.log(`✓ ${rows.length} products, ${cats.length} categories, 3 metal rates`);
  console.log(`✓ admin: ${email}`);
  if (password === 'change-this-immediately') {
    console.warn('⚠ using the default seed password — set SEED_ADMIN_PASSWORD');
  }
}

main()
  .then(() => closeDb())
  .then(() => process.exit(0))
  .catch(async (error: unknown) => {
    console.error('✗ seed failed');
    console.error(error);
    await closeDb().catch(() => {});
    process.exit(1);
  });
