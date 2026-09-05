import type { NextConfig } from 'next';

/**
 * Headers that never vary per request live here; the Content-Security-Policy
 * carries a per-request nonce and is therefore set in `src/middleware.ts`.
 */
const securityHeaders = [
  // Force HTTPS for two years, including subdomains, and opt into the preload list.
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  // Never let a browser sniff a JSON error body into executable script.
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // The admin console must not be framable — clickjacking on a "delete product"
  // button is a real risk. CSP frame-ancestors is the modern equivalent; both are sent.
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Deny every powerful browser feature we do not use.
  {
    key: 'Permissions-Policy',
    value: 'accelerometer=(), autoplay=(), camera=(), display-capture=(), encrypted-media=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), midi=(), payment=(), usb=(), xr-spatial-tracking=()',
  },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
  // We publish no crawler-visible admin surface and no Flash/PDF cross-domain policy.
  { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Do not advertise the framework version to attackers scanning for CVEs.
  poweredByHeader: false,

  // A failing type check or lint must fail the build. These default to `false`
  // already; they are pinned explicitly so nobody "temporarily" flips them.
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: false },

  images: {
    // Allowlist, not wildcard: /_next/image is a server-side fetcher, and an open
    // one is an SSRF primitive. Only hosts we actually publish assets to.
    remotePatterns: [
      { protocol: 'https', hostname: 'res.cloudinary.com' },
      { protocol: 'https', hostname: 'images.unsplash.com' },
    ],
    formats: ['image/avif', 'image/webp'],
    // Jewellery is a detail-heavy product; keep the large end generous.
    deviceSizes: [360, 480, 640, 828, 1080, 1280, 1920, 2560],
  },

  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
