import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { auth } from "@/lib/auth";
import { REQUEST_ID_HEADER, resolveRequestId } from "@/infrastructure/observability/request-id";

/**
 * Route protection rules. Kept as simple prefix arrays rather than a
 * config file — there's no admin/provider UI built yet for the
 * role-gated prefixes below (that's other modules' work), but the
 * gating logic itself is Authentication's responsibility and is ready
 * for when those routes exist.
 */
const PROTECTED_PREFIXES = ["/dashboard"];
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
 */
function withRequestId(req: NextRequest, response: NextResponse): NextResponse {
  const requestId = resolveRequestId(req.headers.get(REQUEST_ID_HEADER));

  const forwardedRequestHeaders = new Headers(req.headers);
  forwardedRequestHeaders.set(REQUEST_ID_HEADER, requestId);

  // NextResponse.next()/redirect() already exist by the time this runs;
  // re-issuing with the augmented request headers is the documented way
  // to make middleware-computed values visible to the rest of the
  // request lifecycle without a redirect round-trip.
  const augmented =
    response.status >= 300 && response.status < 400
      ? response
      : NextResponse.next({ request: { headers: forwardedRequestHeaders } });

  augmented.headers.set(REQUEST_ID_HEADER, requestId);
  return augmented;
}

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isSignedIn = !!req.auth?.user;
  const roles = req.auth?.user?.roles ?? [];

  const roleGate = ROLE_GATED_PREFIXES.find((g) => pathname.startsWith(g.prefix));
  if (roleGate) {
    if (!isSignedIn) {
      const loginUrl = new URL("/auth/login", req.nextUrl.origin);
      loginUrl.searchParams.set("callbackUrl", pathname);
      return withRequestId(req, NextResponse.redirect(loginUrl));
    }
    if (!roleGate.roles.some((r) => roles.includes(r))) {
      return withRequestId(req, NextResponse.redirect(new URL("/", req.nextUrl.origin)));
    }
    return withRequestId(req, NextResponse.next());
  }

  const isProtected = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));
  if (isProtected && !isSignedIn) {
    const loginUrl = new URL("/auth/login", req.nextUrl.origin);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return withRequestId(req, NextResponse.redirect(loginUrl));
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
    return withRequestId(
      req,
      NextResponse.redirect(new URL(PROFESSIONAL_ONBOARDING_PATH, req.nextUrl.origin)),
    );
  }

  return withRequestId(req, NextResponse.next());
});

/**
 * `matcher` intentionally excludes static assets and API auth routes —
 * running middleware on every image request would add needless latency.
 */
export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
