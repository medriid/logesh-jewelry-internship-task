/**
 * The single place the storefront's identity lives.
 *
 * Everything a white-label deployment needs to change — name, palette, currency,
 * tax posture, hallmarking language, contact details — is here. No brand string
 * is hard-coded anywhere else in the codebase; `npm run verify` includes a lint
 * pass that fails if one shows up in `src/app` or `src/components`.
 *
 * Rename the brand: change `name` and `wordmark`. Nothing else needs to move.
 */

export const brand = {
  /** Short wordmark. Appears in the header, page titles, OG tags, email subjects. */
  name: 'Auric',

  /** Full legal/marketing name used in footers, invoices, and structured data. */
  legalName: 'Auric Fine Jewellery',

  /**
   * "Au" is gold's element symbol; *auric* is the chemical adjective for gold(III)
   * compounds — literally "of gold" — and it reads as *aura*. Kept here so the
   * story survives a handover.
   */
  tagline: 'Weighed in gold. Kept for generations.',

  description:
    'Hallmarked 22K gold jewellery, priced transparently against the day’s gold rate.',

  locale: 'en-IN',
  timezone: 'Asia/Kolkata',

  currency: {
    code: 'INR',
    symbol: '₹',
    /**
     * Money is stored as an integer count of the smallest unit — paise — everywhere:
     * database columns, API payloads, arithmetic. Floating point never touches a
     * price. `minorUnitsPerMajor` is the only place the 100 lives.
     */
    minorUnitsPerMajor: 100,
    minorUnitName: 'paise',
  },

  tax: {
    /**
     * GST on gold jewellery in India: 3% on the article. Basis points so we can
     * express 0.5% cess-style rates without decimals. Overridable per product.
     */
    defaultRateBasisPoints: 300,
    label: 'GST',
    /** Catalog prices are quoted tax-exclusive and GST is shown as a line item. */
    pricesIncludeTax: false,
  },

  hallmarking: {
    /** BIS is the Indian hallmarking authority; 916 is the purity mark for 22K. */
    authority: 'BIS',
    authorityFullName: 'Bureau of Indian Standards',
    /** Purity marks by karat, printed on product detail pages. */
    puritySealByKarat: { 24: '999', 22: '916', 18: '750', 14: '585' } as const,
  },

  contact: {
    supportEmail: 'care@auric.example',
    supportPhone: '+91 00000 00000',
    whatsapp: '+910000000000',
  },

  /**
   * Design tokens. The storefront and admin console read these; nothing hardcodes
   * a hex value. Swapping these three lines re-skins the entire surface.
   */
  theme: {
    gold: '#B08D3F',
    goldLight: '#E7D3A1',
    ink: '#1A1714',
    parchment: '#FAF7F2',
    fontDisplay: '"Cormorant Garamond", Georgia, serif',
    fontBody: '"Inter", system-ui, sans-serif',
  },
} as const;

export type Brand = typeof brand;
