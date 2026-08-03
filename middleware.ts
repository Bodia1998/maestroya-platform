import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { auth } from "@/lib/auth";
import { REQUEST_ID_HEADER, resolveRequestId } from "@/infrastructure/observability/request-id";
import { LOCALE_HEADER_NAME } from "@/shared/i18n/locales";
import { matchSupportedLocale, parseAcceptLanguage } from "@/shared/i18n/negotiate-locale";

/**
 * Route protection rules. Kept as simple prefix arrays rather than a
 * config file — there's no admin/provider UI built yet for the
 * role-gated prefixes below (that's other modules' work), but the
 * gating logic itself is Authentication's responsibility and is ready
 * for when those routes exist.
 *
 * Root cause this list exists to fix: every page under the `(dashboard)`
 * route group already calls `requireAuth()` (directly or via a Server
 * Action) and throws `UnauthorizedError` for a signed-out visitor — but
 * `(dashboard)` is a route group, so its URL surface is NOT `/dashboard/*`
 * for most of these pages (Next.js route groups add no URL segment).
 * `/requests`, `/appointments`, `/jobs`, `/messages`, `/disputes`,
 * `/support-tickets`, and `/profile` are each their own top-level path.
 * Previously only `/dashboard` itself was listed here, so an anonymous
 * visitor hitting any of those other URLs directly (e.g. a "Request this
 * service" link from a public professional profile — see
 * (marketing)/professionals/[id]/page.tsx) never got the usual
 * `/auth/login?callbackUrl=...` redirect; they hit `requireAuth()`'s thrown
 * error with no route-level redirect boundary to catch it, i.e. a raw
 * error page instead of a login prompt. Every prefix below corresponds to
 * a real page.tsx under `(dashboard)` that already requires auth on its
 * own — this only changes *how* that requirement is enforced (redirect vs.
 * thrown error), never *whether* auth is required.
 */
const PROTECTED_PREFIXES = [
  "/dashboard",
  "/requests",
  "/appointments",
  "/jobs",
  "/messages",
  "/disputes",
  "/support-tickets",
  "/profile",
];
const ROLE_GATED_PREFIXES: Array<{ prefix: string; roles: string[] }> = [
  { prefix: "/admin", roles: ["ADMIN", "SUPER_ADMIN"] },
];

/**
 * Professional Onboarding: the one route a PROFESSIONAL-intent user
 * without the PROVIDER role yet is always allowed to reach under
 * `/dashboard` — every other `/dashboard` route bounces here instead (see
 * the check below). Kept as a plain constant, not a prefix array entry,
 * since this isn't a role gate — no auth/role requirement is being
 * enforced here, only a redirect target.
 */
const PROFESSIONAL_ONBOARDING_PATH = "/dashboard/professional/onboarding";

/**
 * Interface language negotiation (Module 29 — Internationalization).
 *
 * This is deliberately the *smallest possible* i18n step: it parses
 * `Accept-Language` once per request and forwards the matched locale (if
 * any) on `x-maestroya-locale`, so that downstream Server Components
 * don't each re-parse the same header. That is all it does.
 *
 * What it explicitly does NOT do, and why:
 *
 * - **No locale URL segment, no rewrite/redirect.** The obvious
 *   next-intl-style setup routes every page under `/[locale]/…`. That
 *   would move every existing URL in this app, and — far worse here —
 *   every `callbackUrl` this same middleware builds for the next-auth
 *   redirect a few lines below, plus `PROTECTED_PREFIXES`,
 *   `ROLE_GATED_PREFIXES`, `PROFESSIONAL_ONBOARDING_PATH`, every
 *   `redirect()`/`revalidatePath()` call in the app, and every stored
 *   deep link. The language a user reads the UI in is a per-user
 *   preference on an account, not a property of a resource, so there is
 *   nothing to gain from putting it in the URL and a whole auth flow to
 *   put at risk. Persistence is cookie + database instead. See
 *   docs/MODULE_29_INTERNATIONALIZATION.md §3.
 * - **No database read.** Middleware runs on the Edge runtime, where
 *   Prisma is unavailable, and the authenticated user's stored
 *   `preferredLocale` must come from a use case anyway. That resolution
 *   happens in `server-locale.ts`, which treats this header only as the
 *   *browser* signal — one rung below the account preference.
 * - **No cookie write.** A guest's language lives in `localStorage`,
 *   mirrored to the cookie by the client. Having middleware also write
 *   the cookie would silently promote "your browser is set to German" to
 *   "you chose German", which is a different and stickier statement.
 *
 * The auth chain below is untouched: this function only *decorates* the
 * response next-auth's callback already decided on, exactly as the
 * pre-existing request-ID logic it now sits alongside does.
 */
function negotiateLocale(req: NextRequest): string | null {
  return matchSupportedLocale(parseAcceptLanguage(req.headers.get("accept-language")));
}

/**
 * Request correlation ID (Module 25 — Production Infrastructure).
 *
 * Reuses (validated) an incoming `x-request-id` from a trusted upstream
 * (load balancer/reverse proxy/API gateway) if present, otherwise
 * generates a fresh one — see request-id.ts for the trust boundary this
 * enforces. The resolved ID is written onto the *request* headers (so
 * every Server Component/Server Action/Route Handler downstream of this
 * middleware can read it back via `next/headers`, see
 * server-request-context.ts) and onto the *response* headers (so the
 * caller — browser or upstream proxy — receives it back for its own
 * correlation/support purposes).
 *
 * Module 29 extended this one function to carry the negotiated interface
 * locale alongside the request ID — same mechanism, same two write
 * targets (forwarded request headers + response headers), so there is one
 * decorator on the response rather than two competing ones.
 */
function withRequestContext(req: NextRequest, response: NextResponse): NextResponse {
  const requestId = resolveRequestId(req.headers.get(REQUEST_ID_HEADER));
  const locale = negotiateLocale(req);

  const forwardedRequestHeaders = new Headers(req.headers);
  forwardedRequestHeaders.set(REQUEST_ID_HEADER, requestId);
  // Only set when a supported language actually matched. An absent header
  // means "the browser asked for nothing we speak", which the resolver
  // treats as "fall through to Spanish" — distinct from a header pinned
  // to "es", which would claim the browser asked for Spanish.
  if (locale) forwardedRequestHeaders.set(LOCALE_HEADER_NAME, locale);

  // NextResponse.next()/redirect() already exist by the time this runs;
  // re-issuing with the augmented request headers is the documented way
  // to make middleware-computed values visible to the rest of the
  // request lifecycle without a redirect round-trip.
  const augmented =
    response.status >= 300 && response.status < 400
      ? response
      : NextResponse.next({ request: { headers: forwardedRequestHeaders } });

  augmented.headers.set(REQUEST_ID_HEADER, requestId);
  if (locale) augmented.headers.set(LOCALE_HEADER_NAME, locale);
  return augmented;
}

export default auth((req) => {
  const { pathname, search } = req.nextUrl;
  const isSignedIn = !!req.auth?.user;
  const roles = req.auth?.user?.roles ?? [];
  // Preserves query params (e.g. `/requests/new?categoryId=...&city=...`,
  // the "Request this service" prefill link from a public professional
  // profile) across the login round trip — previously only `pathname` was
  // carried into `callbackUrl`, so any such hint was silently dropped the
  // moment an anonymous visitor had to log in first.
  const pathWithQuery = `${pathname}${search}`;

  const roleGate = ROLE_GATED_PREFIXES.find((g) => pathname.startsWith(g.prefix));
  if (roleGate) {
    if (!isSignedIn) {
      const loginUrl = new URL("/auth/login", req.nextUrl.origin);
      loginUrl.searchParams.set("callbackUrl", pathWithQuery);
      return withRequestContext(req, NextResponse.redirect(loginUrl));
    }
    if (!roleGate.roles.some((r) => roles.includes(r))) {
      return withRequestContext(req, NextResponse.redirect(new URL("/", req.nextUrl.origin)));
    }
    return withRequestContext(req, NextResponse.next());
  }

  const isProtected = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));
  if (isProtected && !isSignedIn) {
    const loginUrl = new URL("/auth/login", req.nextUrl.origin);
    loginUrl.searchParams.set("callbackUrl", pathWithQuery);
    return withRequestContext(req, NextResponse.redirect(loginUrl));
  }

  /**
   * Professional Onboarding.
   *
   * A user who registered through the "Soy profesional" CTA carries
   * `signupIntent === "PROFESSIONAL"` (see auth-config.ts's jwt callback)
   * until onboarding completes and clears it (see
   * CompleteProfessionalOnboardingUseCase). Until then, they must never
   * see the Customer Dashboard — every `/dashboard` route except the
   * onboarding page itself redirects here instead.
   *
   * This check re-runs on *every* request against the DB-backed
   * `signupIntent` (refreshed into the session/JWT at sign-in — see
   * auth-config.ts), not a one-time post-registration redirect — so it
   * equally covers "interrupted onboarding": closing the browser before
   * finishing and logging back in later still resumes here.
   */
  const isProfessionalIntent = (req.auth?.user?.signupIntent ?? null) === "PROFESSIONAL";
  const hasProviderRole = roles.includes("PROVIDER");
  if (
    isSignedIn &&
    isProfessionalIntent &&
    !hasProviderRole &&
    pathname.startsWith("/dashboard") &&
    pathname !== PROFESSIONAL_ONBOARDING_PATH
  ) {
    return withRequestContext(
      req,
      NextResponse.redirect(new URL(PROFESSIONAL_ONBOARDING_PATH, req.nextUrl.origin)),
    );
  }

  return withRequestContext(req, NextResponse.next());
});

/**
 * `matcher` intentionally excludes static assets and API auth routes —
 * running middleware on every image request would add needless latency.
 */
export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
