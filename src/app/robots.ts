import type { MetadataRoute } from "next";

import { DISALLOWED_PATHS } from "@/shared/seo/robots-rules";
import { SITE_URL } from "@/shared/seo/site";

/**
 * Module 43 — SEO Infrastructure: `robots.txt`, served at `/robots.txt`
 * via Next's `robots.ts` file convention. Rule source of truth is
 * `shared/seo/robots-rules.ts` (`DISALLOWED_PATHS`) — see that file's own
 * doc comment for why each prefix is disallowed and how it maps back to
 * `middleware.ts`'s auth gating.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [...DISALLOWED_PATHS],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
