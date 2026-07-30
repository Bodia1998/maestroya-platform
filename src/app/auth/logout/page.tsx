import { LogoutRedirect } from "./logout-redirect";

export const metadata = { title: "Log out" };

/**
 * This route's Server Component body never touches `signOut()` or any
 * cookie — it only renders a small client island (`LogoutRedirect`) that
 * submits a real POST to the `logoutAction` Server Action on mount (see
 * actions.ts). That's what fixes the regression: this page used to call
 * `signOut()` directly during render, which Next.js only permits inside a
 * Server Action/Route Handler, and which also meant a mere GET to this
 * route (e.g. a background `next/link` prefetch of a visible "Sign out"
 * link) could silently tear down the session. Existing entry points that
 * simply navigate here (marketing header, mobile nav, the
 * post-account-deletion redirect) keep working unchanged, since visiting
 * this page still results in the user being signed out — just via a real
 * client-triggered POST instead of a render-time side effect.
 */
export default function LogoutPage() {
  return <LogoutRedirect />;
}
