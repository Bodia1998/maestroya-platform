import { signOut } from "@/lib/auth";

export const metadata = { title: "Log out" };

/**
 * No client JS needed: Auth.js v5's server-side `signOut()` clears the
 * session cookie and redirects in one step when called directly from a
 * Server Component/Action.
 */
export default async function LogoutPage() {
  await signOut({ redirectTo: "/" });
  return null;
}
