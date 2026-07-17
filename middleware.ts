export { auth as middleware } from "@/lib/auth";

/**
 * Runs Auth.js's session check at the edge, before a request reaches a
 * route. This is a cheap, coarse-grained gate (redirect unauthenticated
 * users away from protected paths); the (dashboard) layout's own
 * `auth()` check remains as defense-in-depth in case middleware is
 * bypassed or misconfigured.
 *
 * `matcher` intentionally excludes static assets and API auth routes —
 * running middleware on every image request would add needless latency.
 */
export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
