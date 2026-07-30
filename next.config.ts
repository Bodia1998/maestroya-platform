import type { NextConfig } from "next";

/**
 * Next.js configuration.
 *
 * Notes:
 * - `reactStrictMode` is on by default in Next 15; kept explicit for clarity.
 * - Security headers are set here rather than only in `middleware.ts` so they
 *   apply to static assets too, not just middleware-matched routes.
 * - Image remote patterns are scoped to Cloudinary — tighten/extend as needed.
 */
const isProductionBuild = process.env.NODE_ENV === "production";

/**
 * Content-Security-Policy (Module 25 — Production Infrastructure).
 *
 * Scoped to this app's actual external dependencies as of this audit:
 * Cloudinary-hosted images (`next.config.ts`'s own `images.remotePatterns`),
 * and Stripe's API for the Stripe client already present in
 * `infrastructure/payments/stripe/client.ts` (server-side only today — no
 * client-side Stripe.js/Elements usage found in `src/`, so `js.stripe.com`
 * is deliberately not yet in `script-src`; add it there if/when Module 12
 * introduces Stripe Elements).
 *
 * `script-src`/`style-src` include `'unsafe-inline'` rather than a
 * nonce-based policy: Next.js's App Router streams inline hydration
 * scripts and several UI dependencies (Tailwind's arbitrary-value inline
 * styles, component libraries) rely on inline `style` attributes. A
 * nonce-based CSP is the stronger option but requires threading a
 * per-request nonce through the root layout and every inline
 * script/style — a real change to `src/app/layout.tsx` and beyond, out of
 * scope for this module. Documented as a "Future improvement" rather than
 * silently skipped; see docs/MODULE_25_PRODUCTION_INFRASTRUCTURE.md.
 *
 * `'unsafe-eval'` is added to `script-src` in development only. `next dev`'s
 * webpack dev server bundles and Fast Refresh runtime use `eval()`
 * (`eval-source-map`-style devtool) to load/update modules — without
 * `'unsafe-eval'`, the browser silently blocks that eval call via CSP,
 * which means the client JS bundle never finishes executing and React
 * never hydrates *anywhere* in the app. The page still renders (from SSR
 * HTML), so it looks fine until you interact with it: every "use client"
 * component — including this app's login/register forms — sits there
 * with no event listeners attached, so a real `<form>` submit falls back
 * to the browser's native, unprevented submission (method defaults to
 * GET, action defaults to the current URL), which is exactly how
 * `POST`-via-`signIn()` turned into `GET /auth/login?email=...&password=...`
 * in the logs — not an authentication bug, a CSP-vs-dev-tooling one.
 * Production's `next build` output doesn't use `eval()`, so this stays
 * exactly as strict as before for real deployments.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProductionBuild ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://res.cloudinary.com",
  "font-src 'self' data:",
  "connect-src 'self' https://res.cloudinary.com https://api.stripe.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "X-DNS-Prefetch-Control", value: "on" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(self)",
  },
  { key: "Content-Security-Policy", value: CONTENT_SECURITY_POLICY },
  // HSTS only makes sense — and is only safe — once the app is actually
  // served over HTTPS in production. Sending it in local dev (plain HTTP)
  // would have browsers remember a bogus upgrade instruction for
  // localhost. `env.ts`'s production `superRefine` already requires
  // NEXT_PUBLIC_APP_URL/AUTH_URL to be https:// in production, so this
  // condition and that validation agree with each other.
  ...(isProductionBuild
    ? [
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains; preload",
        },
      ]
    : []),
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  // Standalone output produces a minimal, self-contained `.next/standalone`
  // server bundle (only the production `node_modules` subset actually
  // required at runtime) — this is what the production Dockerfile (see
  // `Dockerfile`) copies into its final image, keeping the container
  // small rather than shipping the full source tree + devDependencies.
  output: "standalone",

  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "res.cloudinary.com",
        pathname: "/**",
      },
    ],
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },

  experimental: {
    // Reduces the client bundle for libraries commonly used server-side.
    serverComponentsHmrCache: true,
  },
};

export default nextConfig;
