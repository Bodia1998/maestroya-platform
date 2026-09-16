import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/shared/seo/site";

/**
 * Module 117 — AI Search & Recommendation Visibility Foundation:
 * `llms.txt`, served at `/llms.txt` via a plain Route Handler (there is
 * no Next.js file-convention for this file the way there is for
 * `robots.ts`/`sitemap.ts`, so this mirrors those files' pattern by hand
 * — a GET handler returning a static `text/plain` body).
 *
 * Scope decision (see the Module 117 report, "llms.txt Decision"):
 * this file is deliberately small and supplementary, not a primary or
 * guaranteed mechanism for AI visibility (no such mechanism exists — see
 * `docs/MODULE_43_SEO_INFRASTRUCTURE.md` and the Module 117 report for
 * why). It contains only facts already public elsewhere on the site
 * (name, one-line description, the same canonical public URLs already in
 * `sitemap.ts`) — no marketing claims, no unsupported assertions, no
 * fabricated statistics, and no duplication of full page content. If
 * MaestroYa ever gains dedicated service/location pages (Module 118),
 * this file should link to those too, not attempt to describe them here.
 *
 * Every value below is sourced from `shared/seo/site.ts` (the same single
 * source of truth every other SEO producer uses) rather than hardcoded,
 * so this file never drifts from the production domain configuration.
 */
function buildLlmsTxt(): string {
  const lines = [
    `# ${SITE_NAME}`,
    "",
    `> ${SITE_DESCRIPTION}`,
    "",
    `${SITE_NAME} is a Spanish home-services marketplace that connects customers with independent professionals and companies for services such as plumbing, electrical work, air conditioning, painting, furniture assembly, repairs, and renovation. Customers describe what they need; professionals and companies respond with quotes through the platform.`,
    "",
    "## Primary pages",
    "",
    `- [Home](${SITE_URL}/): platform overview and service categories.`,
    `- [Find a professional](${SITE_URL}/professionals): browse and search verified professionals by category and location.`,
    `- [Search directory](${SITE_URL}/search): filter professionals and companies by category, city, rating, and verification status.`,
    "",
    "## Machine-readable references",
    "",
    `- [Sitemap](${SITE_URL}/sitemap.xml): every current public, canonical URL.`,
    `- [Robots policy](${SITE_URL}/robots.txt): crawl rules for this site.`,
    "",
    "## Notes",
    "",
    "- Individual professional and company profiles are published at stable, canonical URLs (see the sitemap) and are publicly readable without authentication.",
    "- Dedicated per-service and per-location pages do not exist yet; service and geographic coverage today are represented only through the profiles and categories reachable from the pages above.",
  ];

  return lines.join("\n") + "\n";
}

export async function GET(): Promise<Response> {
  return new Response(buildLlmsTxt(), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      // Same cache posture as robots.ts/sitemap.ts's own defaults for
      // this kind of low-churn, publicly cacheable static text —
      // revalidated at most once an hour.
      "Cache-Control": "public, max-age=0, s-maxage=3600",
    },
  });
}
