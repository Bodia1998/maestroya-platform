import { UnauthorizedError } from "@/domain/errors/domain-error";
import { auth } from "@/lib/auth";

export const ROLES = {
  ADMIN: "ADMIN",
  SUPER_ADMIN: "SUPER_ADMIN",
  SUPPORT: "SUPPORT",
  CUSTOMER: "CUSTOMER",
  PROVIDER: "PROVIDER",
  MODERATOR: "MODERATOR",
} as const;

export type RoleKey = (typeof ROLES)[keyof typeof ROLES];

/**
 * Returns the signed-in user (id + roles) or null. The one place
 * Server Components/Actions should read "who is this" from — never read
 * `auth()` ad hoc elsewhere, so this stays the single seam if the shape
 * of that data ever needs to change.
 */
export async function getCurrentUser() {
  const session = await auth();
  if (!session?.user) return null;
  return {
    id: session.user.id,
    email: session.user.email,
    roles: session.user.roles,
    signupIntent: session.user.signupIntent,
  };
}

/** Throws UnauthorizedError if nobody is signed in. */
export async function requireAuth() {
  const user = await getCurrentUser();
  if (!user) throw new UnauthorizedError("You must be signed in to do that.");
  return user;
}

/** Throws UnauthorizedError if signed in but missing every one of `allowed`. */
export async function requireRole(...allowed: RoleKey[]) {
  const user = await requireAuth();
  const hasRole = user.roles.some((role) => allowed.includes(role as RoleKey));
  if (!hasRole) {
    throw new UnauthorizedError("You do not have permission to do that.");
  }
  return user;
}
