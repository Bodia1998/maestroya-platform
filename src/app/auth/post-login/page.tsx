import { redirect } from "next/navigation";

import { getCurrentUser } from "@/infrastructure/auth/rbac";
import { resolvePostLoginDestination } from "@/shared/utils/resolve-post-login-destination";

/**
 * Server-authoritative post-login redirect target.
 *
 * Root cause this exists to fix: `LoginForm` previously computed the
 * post-login destination entirely client-side, calling `getSession()`
 * (from `next-auth/react`) immediately after `signIn({redirect:false})`
 * resolved and navigating with `window.location.href` based on that
 * client-read session. In the real browser this was occasionally racy —
 * `getSession()` can be served from next-auth's own in-memory client cache
 * rather than a fresh read of the just-set session cookie, so it would
 * sometimes still report the *pre-login* (empty) session for one request.
 * `resolvePostLoginDestination` would then compute the plain customer
 * default, `window.location.href` would navigate there, and
 * `middleware.ts` — reading the cookie directly, which *was* already
 * correctly set — would let it through fine... but for the rarer case
 * where the stale client read happened combined with a role-gated
 * `callbackUrl`, or simply because the wrong destination was chosen, the
 * user's *perceived* symptom was "redirect didn't happen"/"landed
 * somewhere unexpected"/"had to log in again". Retrying the exact same
 * action a moment later succeeded because by then next-auth's client
 * cache had caught up.
 *
 * The fix: don't decide the destination from a client-side session read at
 * all. `LoginForm` still calls `signIn({redirect:false})` first (so
 * credential errors still render inline, no navigation), but on success it
 * navigates here via a full top-level request instead of computing the
 * destination itself. By the time *this* page's Server Component runs,
 * the session cookie set by `signIn` is guaranteed present on the request
 * (it's the same cookie jar, and this is a brand new HTTP request, not a
 * same-tick client fetch) — `getCurrentUser()` reads it authoritatively,
 * with no race possible. Reuses the exact same
 * `resolvePostLoginDestination` decision function `LoginForm` used to call
 * client-side — the *decision* doesn't change, only *where* it now runs.
 *
 * Also the one route `middleware.ts`'s own Professional Onboarding
 * redirect (see its doc comment) and this page's decision can never
 * disagree, since both ultimately key off the same
 * roles/signupIntent — this page just gets there in one hop instead of
 * requiring middleware to correct course on a second request.
 */
export default async function PostLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; intent?: string }>;
}) {
  const { callbackUrl, intent } = await searchParams;

  const user = await getCurrentUser();
  if (!user) {
    // Shouldn't happen in practice — this route is only ever navigated to
    // right after a successful `signIn()` — but fail safe rather than
    // rendering a blank/broken page if the cookie somehow didn't stick.
    const fallback = callbackUrl ? `/auth/login?callbackUrl=${encodeURIComponent(callbackUrl)}` : "/auth/login";
    redirect(fallback);
  }

  const destination = resolvePostLoginDestination(
    { roles: user.roles, signupIntent: user.signupIntent },
    {
      explicitCallbackUrl: callbackUrl ?? null,
      defaultDestination: "/dashboard",
      loginIntent: intent === "professional" ? "professional" : null,
    },
  );

  redirect(destination);
}
