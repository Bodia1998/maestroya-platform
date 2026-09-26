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
 *
 * Module 120 — Multilingual Localization: deliberately NOT localized per
 * visitor. `llms.txt` is a crawler/AI-facing reference document with one
 * fixed wording (it never reads the request locale, cookies or
 * `Accept-Language`); its `SITE_DESCRIPTION` line is the canonical Spanish
 * description read from the `es` `seo` catalog (`shared/seo/site.ts`). The
 * literal lines below are therefore marked `i18n-ignore`.
 */
function buildLlmsTxt(): string {
  const lines = [
    `# ${SITE_NAME}`, // i18n-ignore: fixed-language crawler document
    "",
    `> ${SITE_DESCRIPTION}`,
    "",
    `${SITE_NAME} is a home-services marketplace intended to operate across Spain, connecting customers with independent professionals and companies. It currently publishes six service categories: plumbing, electrical work, air conditioning, painting, renovation, and furniture assembly. Customers describe what they need; professionals and companies who cover that category and area respond with quotes through the platform. National platform scope is distinct from verified local availability, which depends on which professionals are actually active in a given area at a given time — see the locations page below.`, // i18n-ignore: fixed-language crawler document
    "",
    "## Primary pages", // i18n-ignore: fixed-language crawler document
    "",
    `- [Home](${SITE_URL}/): platform overview and service categories.`, // i18n-ignore: fixed-language crawler document
    `- [Find a professional](${SITE_URL}/professionals): browse and search verified professionals by category and location.`, // i18n-ignore: fixed-language crawler document
    `- [Search directory](${SITE_URL}/search): filter professionals and companies by category, city, rating, and verification status.`, // i18n-ignore: fixed-language crawler document
    `- [Services](${SITE_URL}/servicios): the service categories MaestroYa currently publishes public pages for.`, // i18n-ignore: fixed-language crawler document
    `- [Locations](${SITE_URL}/ubicaciones): platform-wide (Spain) scope and the individual localities with confirmed coverage.`, // i18n-ignore: fixed-language crawler document
    `- [Spain-wide coverage](${SITE_URL}/ubicaciones/espana): what national platform scope means and how local availability works.`, // i18n-ignore: fixed-language crawler document
    "",
    "## Machine-readable references", // i18n-ignore: fixed-language crawler document
    "",
    `- [Sitemap](${SITE_URL}/sitemap.xml): every current public, canonical URL.`, // i18n-ignore: fixed-language crawler document
    `- [Robots policy](${SITE_URL}/robots.txt): crawl rules for this site.`, // i18n-ignore: fixed-language crawler document
    "",
    "## Notes", // i18n-ignore: fixed-language crawler document
    "",
    "- Individual professional and company profiles are published at stable, canonical URLs (see the sitemap) and are publicly readable without authentication.", // i18n-ignore: fixed-language crawler document
    "- Module 118 added dedicated per-service pages (`/servicios/{slug}`), per-location pages (`/ubicaciones/{slug}`), a Spain-wide coverage page (`/ubicaciones/espana`), and combined service+location pages (`/servicios/{slug}/{location}`) — each one only exists where MaestroYa's own data verifies the service/location/country is real; see the sitemap for the current list.", // i18n-ignore: fixed-language crawler document
    "- MaestroYa's platform scope is Spain-wide, but this does not mean every service is currently available in every municipality. Only the localities listed on the locations page have confirmed local coverage; local availability elsewhere depends on which professionals are actually active there.", // i18n-ignore: fixed-language crawler document
  ];

  return lines.join("\n") + "\n";
}

export async function GET(): Promise<Response> {
  return new Response(buildLlmsTxt(), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8", // i18n-ignore: HTTP header value
      // Same cache posture as robots.ts/sitemap.ts's own defaults for
      // this kind of low-churn, publicly cacheable static text —
      // revalidated at most once an hour.
      "Cache-Control": "public, max-age=0, s-maxage=3600", // i18n-ignore: HTTP header value
    },
  });
}
