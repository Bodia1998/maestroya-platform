/**
 * Re-exports the root `auth.ts` (required by Auth.js's file-location
 * convention) so the rest of the app can import via the `@/lib/auth`
 * alias instead of relative paths like `../../../auth`.
 */
export { auth, handlers, signIn, signOut } from "../../auth";
