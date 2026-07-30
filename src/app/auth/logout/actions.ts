"use server";

import { signOut } from "@/lib/auth";

/**
 * The only place `signOut()` is called.
 *
 * Auth.js's `signOut()` needs to clear the session cookie, which Next.js
 * only permits inside a Server Action or Route Handler — never during
 * Server Component rendering (that throws "Cookies can only be modified
 * in a Server Action or Route Handler"). This used to be called directly
 * in `logout/page.tsx`'s Server Component body, which meant merely
 * *rendering* that route (including via a background `next/link`
 * prefetch of a "Sign out" link, not just an actual click) attempted to
 * mutate cookies mid-render and threw — see `logout-redirect.tsx` and
 * `dashboard-shell.tsx` for the two call sites that now invoke this
 * Server Action via a real POST instead.
 */
export async function logoutAction(): Promise<void> {
  await signOut({ redirectTo: "/" });
}
