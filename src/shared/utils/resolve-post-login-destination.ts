/**
 * Professional Onboarding — post-login redirect decision.
 *
 * Root cause this exists to fix: the login form previously always
 * navigated to `callbackUrl` (defaulting to the plain `"/dashboard"`)
 * after a successful sign-in, and relied entirely on `middleware.ts`
 * re-evaluating the freshly-set session on that *next* request to correct
 * course for a PROFESSIONAL-intent account (redirecting on to
 * `/dashboard/professional/onboarding`). That two-hop dependency is what
 * made the bug hard to see: it *should* work (middleware does correctly
 * receive `roles`/`signupIntent` on the next request — see
 * auth-config.ts's `jwt`/`session` callbacks, unchanged here), but it
 * added an easily-broken, hard-to-observe extra round trip for exactly
 * the one flow (professional login) this feature cares about most, and
 * never accounted for requirement #3 below at all (an already-activated
 * professional signing back in still landed on the generic dashboard,
 * not their professional one).
 *
 * This function is the single, pure, client-safe (no server-only imports
 * — see login-form.tsx, a "use client" component) place that decision now
 * lives: called once, right after `signIn()` resolves, using the fresh
 * session `getSession()` returns, so the *first* navigation already goes
 * to the right place instead of guessing "/dashboard" and hoping
 * middleware fixes it up. `middleware.ts` is intentionally left
 * untouched — it remains the authoritative safety net for every other
 * way a user reaches `/dashboard/*` (a stale bookmark, a direct URL,
 * resuming interrupted onboarding on a later day), just no longer the
 * *only* mechanism the login flow depends on.
 *
 * Decision, in order:
 *   1. An explicit `callbackUrl` (the user was bounced here from a
 *      specific protected route, e.g. `/admin` or `/dashboard/messages`)
 *      always wins — this is existing behavior (role-gated redirects,
 *      "return to where you were") and must not change.
 *   2. PROVIDER role already granted → `/dashboard/professional` (the
 *      Professional Dashboard) — requirement #3.
 *   3. `signupIntent === "PROFESSIONAL"` but no PROVIDER role yet →
 *      `/dashboard/professional/onboarding` — requirement #2.
 *   4. Otherwise, the ordinary customer default.
 *
 * The `"PROVIDER"` literal (not `ROLES.PROVIDER` from rbac.ts) is
 * deliberate — rbac.ts transitively imports `@/lib/auth`, which is
 * `server-only`; importing it here would break the client bundle this
 * function ships in. `middleware.ts` makes the exact same trade-off for
 * the exact same reason.
 */
export interface PostLoginSession {
  roles: string[];
  signupIntent: string | null;
}

export interface ResolvePostLoginDestinationOptions {
  /** `searchParams.get("callbackUrl")` — `null` when absent, never defaulted before calling this. */
  explicitCallbackUrl: string | null;
  /** Where an ordinary customer with no explicit callbackUrl lands. */
  defaultDestination: string;
}

export function resolvePostLoginDestination(
  session: PostLoginSession,
  { explicitCallbackUrl, defaultDestination }: ResolvePostLoginDestinationOptions,
): string {
  if (explicitCallbackUrl) {
    return explicitCallbackUrl;
  }

  if (session.roles.includes("PROVIDER")) {
    return "/dashboard/professional";
  }

  if (session.signupIntent === "PROFESSIONAL") {
    return "/dashboard/professional/onboarding";
  }

  return defaultDestination;
}
