/**
 * Module 43 — SEO Infrastructure: the crawl rules `src/app/robots.ts`
 * serves, pulled out into their own framework-free module so a unit test
 * can assert against the same list `robots.ts` actually uses (no
 * duplicated/hand-copied path list to drift out of sync) and so any other
 * future producer (e.g. a `<meta name="robots">` override) can reuse it.
 *
 * Every prefix below corresponds to a route this app already gates behind
 * authentication/role checks in `middleware.ts` (`PROTECTED_PREFIXES`,
 * `ROLE_GATED_PREFIXES`) or that has no indexable public content of its
 * own. Disallowing them here is defense-in-depth for crawl budget and
 * accidental exposure in search results, not the access-control boundary
 * itself — `middleware.ts` and each Server Action's own `requireAuth()`
 * call remain the real security boundary; a `robots.txt` disallow is only
 * ever a polite request well-behaved crawlers honor.
 */

/** Never publicly indexable: authenticated-only app surface. Kept as the
 *  same prefixes `middleware.ts`'s `PROTECTED_PREFIXES` + `ROLE_GATED_PREFIXES`
 *  already define as auth-required, so this list can never drift to
 *  disallow a route that isn't actually gated (or vice versa) without
 *  someone noticing the duplication. */
export const DISALLOWED_PATHS = [
  "/dashboard",
  "/admin",
  "/requests",
  "/appointments",
  "/jobs",
  "/messages",
  "/disputes",
  "/support-tickets",
  "/profile",
  // Internal/API surface — never meant to be crawled or indexed; some
  // routes here (webhooks, cron) must never even appear in a search
  // engine's request logs.
  "/api",
  // Auth flow pages: no indexable content of their own, and
  // `/auth/reset-password` and `/auth/verify-email` carry single-use,
  // sensitive tokens in their query string that must never be crawled,
  // cached, or surfaced in search results/referrer headers.
  "/auth",
] as const;

/** Explicitly public, crawlable marketing/discovery surface — documented
 *  here (even though "allow" is robots.txt's default) so the intent is
 *  visible next to what's disallowed above, and so tests can assert both
 *  sides of the same policy. */
export const ALLOWED_PATHS = ["/", "/professionals", "/companies/", "/search"] as const;
