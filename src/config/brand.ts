/**
 * The single place the brand's identity lives.
 *
 * Everything a white-label deployment needs to change — name, palette, currency,
 * tax posture, hallmarking language, contact details — is here. No brand string
 * is hard-coded anywhere else in the codebase.
 *
 * Rename the brand: change `name` and `legalName`. Nothing else moves.
 */

export const brand = {
  /**
   * A loupe is the jeweller's 10× lens — the one tool in the trade whose entire
   * purpose is verification. You hand someone a loupe when you have nothing to
   * hide, which is the argument this whole API makes: net weight, making charge,
   * the day's gold rate and the BIS hallmark number are all public fields, not
   * things buried behind a sticker price. It reads as *loop* too — a chain, a ring.
   */
  name: 'Loupe',

  legalName: 'Loupe Fine Jewellery',
  domain: 'loupe.jewelry',

  tagline: 'Look closer.',

  description:
    'Hallmarked 22K gold, priced in the open against the day’s rate. Every gram accounted for.',

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
     * GST on gold jewellery in India: 3% on the article. Basis points, so a 0.5%
     * cess-style rate needs no decimals. Overridable per product.
     */
    defaultRateBasisPoints: 300,
    label: 'GST',
    /** Catalog prices are quoted tax-exclusive; GST is shown as its own line. */
    pricesIncludeTax: false,
  },

  hallmarking: {
    /** BIS is the Indian hallmarking authority; 916 is the purity mark for 22K. */
    authority: 'BIS',
    authorityFullName: 'Bureau of Indian Standards',
    puritySealByKarat: { 24: '999', 22: '916', 18: '750', 14: '585', 9: '375' } as const,
  },

  contact: {
    supportEmail: 'care@loupe.jewelry',
    supportPhone: '+91 00000 00000',
    whatsapp: '+910000000000',
  },

  /**
   * Design tokens. The storefront and admin console read these; nothing hardcodes
   * a hex value. Swapping these lines re-skins the entire surface.
   */
  theme: {
    /** Gold is always a gradient in use — a flat fill of this reads as mustard. */
    gold: '#B08D3F',
    goldLight: '#D4B063',
    champagne: '#E7D3A1',
    goldDeep: '#7E5F22',
    /** Warm near-black. A true #000 beside gold looks like a spreadsheet. */
    ink: '#16130F',
    inkSoft: '#3A342B',
    muted: '#6B6154',
    parchment: '#FAF8F4',
    rule: '#E4DED2',
    fontDisplay: '"Cormorant Garamond", Georgia, serif',
    fontBody: '"Inter", system-ui, sans-serif',
  },
} as const;

export type Brand = typeof brand;
