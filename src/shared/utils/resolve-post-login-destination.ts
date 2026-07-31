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
 *   2. PROVIDER role already granted → `/dashboard` (the Professional
 *      Dashboard overview — see build-dashboard-nav-groups.ts's
 *      "Professional dashboard" nav item, which links here too) —
 *      requirement #3. Deliberately NOT `/dashboard/professional` (that
 *      route is the professional's *profile-editing* page — "Professional
 *      profile" in the nav, a distinct destination) — landing a
 *      just-logged-in professional straight on a settings form instead of
 *      the overview that actually shows their available requests/quotes/
 *      appointments/jobs at a glance was itself part of the "confusing
 *      dashboard" root cause; see dashboard/page.tsx, which already
 *      renders a dedicated "Professional overview" section up top for any
 *      PROVIDER account, cleanly separated from the customer section below
 *      it.
 *   3. `signupIntent === "PROFESSIONAL"` but no PROVIDER role yet →
 *      `/dashboard/professional/onboarding` — requirement #2.
 *   4. The *login page's own* `?intent=professional` query param (see
 *      `loginIntent` below) — distinct from `signupIntent` above, which
 *      only exists once someone has actually registered through the
 *      professional signup CTA. This covers "Soy profesional" on the
 *      marketing header: an existing customer-only account (no PROVIDER
 *      role, no lingering `signupIntent`) clicking a professional *login*
 *      entry point. Per the underlying request, such an account must
 *      never be silently granted PROVIDER here — this only changes where
 *      they land after an ordinary login, sending them to the same
 *      onboarding page requirement #2 uses (which itself requires no
 *      more than `requireAuth()` — see its own doc comment) rather than
 *      the plain Customer Dashboard, so they can opt in to becoming a
 *      professional instead of being routed past that option entirely.
 *   5. Otherwise, the ordinary customer default.
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
  /**
   * `searchParams.get("intent") === "professional"` on the *login* page —
   * i.e. how the user arrived at `/auth/login`, not anything persisted on
   * their account. `null`/omitted for an ordinary login link. Named
   * distinctly from `session.signupIntent` (a persisted, DB-backed value
   * set only at registration time) so the two are never confused: this
   * field can never grant PROVIDER or mutate the account by itself, it
   * only chooses where a successful login navigates to.
   */
  loginIntent?: "professional" | null;
}

export function resolvePostLoginDestination(
  session: PostLoginSession,
  { explicitCallbackUrl, defaultDestination, loginIntent = null }: ResolvePostLoginDestinationOptions,
): string {
  if (explicitCallbackUrl) {
    return explicitCallbackUrl;
  }

  if (session.roles.includes("PROVIDER")) {
    return "/dashboard";
  }

  if (session.signupIntent === "PROFESSIONAL") {
    return "/dashboard/professional/onboarding";
  }

  if (loginIntent === "professional") {
    return "/dashboard/professional/onboarding";
  }

  return defaultDestination;
}
