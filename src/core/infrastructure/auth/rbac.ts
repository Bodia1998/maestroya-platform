import { UnauthorizedError } from "@/domain/errors/domain-error";
import { auth } from "@/lib/auth";
import { PrismaUserRepository } from "@/infrastructure/database/prisma/repositories/prisma-user-repository";

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
 * Module 82 — Admin RBAC & Production Auth Hardening: every existing call
 * site in this codebase that invokes `requireRole()` includes ADMIN and/or
 * SUPER_ADMIN in its allowed list (see admin/actions.ts and every other
 * admin-area actions.ts — none of them gate on CUSTOMER/PROVIDER/MODERATOR
 * alone). That makes "does `allowed` include an admin-tier role" the exact
 * seam for the JWT/admin-role freshness fix below: a fresh DB check here
 * covers every one of the ~50 admin Server Actions with a single change,
 * with zero DB overhead added to ordinary (non-admin-gated) requests.
 */
const ADMIN_TIER_ROLES: ReadonlySet<RoleKey> = new Set([ROLES.ADMIN, ROLES.SUPER_ADMIN]);

const users = new PrismaUserRepository();

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

/**
 * Throws UnauthorizedError if signed in but missing every one of `allowed`.
 *
 * Module 82 — Admin RBAC & Production Auth Hardening (JWT/admin-role
 * freshness gap): the session/JWT role claim checked above is only as
 * fresh as the last sign-in or explicit `update()` trigger (see
 * auth-config.ts's `jwt` callback) — a session can carry a 24-hour, or
 * 30-day with "remember me", maxAge (see `DEFAULT_SESSION_MAX_AGE_SECONDS`/
 * `REMEMBER_ME_SESSION_MAX_AGE_SECONDS`). An admin demoted or suspended
 * mid-session would otherwise keep acting as that role for up to that
 * entire window.
 *
 * Rather than rewriting the session/JWT architecture (a much larger, riskier
 * change touching every authenticated request), this re-verifies the
 * caller's *current* status and role directly against the database, but
 * only when `allowed` is an admin-tier check (see ADMIN_TIER_ROLES above)
 * — never on every authenticated request, and never for the large majority
 * of `requireRole()` calls that don't exist today (there are none that
 * omit ADMIN/SUPER_ADMIN, but the guard is written to be correct if one
 * is ever added). This closes the freshness gap to effectively zero for
 * every admin-gated Server Action: the very next privileged call after a
 * demotion/suspension is rejected, regardless of how much of the session's
 * maxAge remains. It does not rewrite the JWT itself — the session cookie
 * keeps showing the stale role for UI purposes (e.g. admin/layout.tsx's nav)
 * until the token naturally refreshes — but no *action* can be taken on it,
 * which is the actual security boundary.
 */
export async function requireRole(...allowed: RoleKey[]) {
  const user = await requireAuth();
  const hasRole = user.roles.some((role) => allowed.includes(role as RoleKey));
  if (!hasRole) {
    throw new UnauthorizedError("You do not have permission to do that.");
  }

  if (allowed.some((role) => ADMIN_TIER_ROLES.has(role))) {
    const fresh = await users.findById(user.id);
    if (!fresh || fresh.status !== "ACTIVE") {
      throw new UnauthorizedError("You do not have permission to do that.");
    }

    const freshRoles = await users.getRoleKeys(user.id);
    const stillHasRole = freshRoles.some((role) => allowed.includes(role as RoleKey));
    if (!stillHasRole) {
      throw new UnauthorizedError("You do not have permission to do that.");
    }

    return { ...user, roles: freshRoles };
  }

  return user;
}
