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
const securityHeaders = [
  { key: "X-DNS-Prefetch-Control", value: "on" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(self)",
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

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
