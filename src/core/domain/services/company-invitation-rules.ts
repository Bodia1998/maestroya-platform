import { createHash, randomBytes } from "crypto";

/**
 * Module 18 — Company Professional: pure, dependency-free business rules for
 * CompanyInvitation. Token generation uses Node's `crypto` (same primitive
 * every other secure-token flow in this codebase already relies on
 * indirectly via bcrypt/crypto in the auth module) but nothing here touches
 * a database or the network — it's still a "domain service", not
 * infrastructure, exactly like professional-verification-rules.ts.
 */

export const COMPANY_INVITATION_STATUS_VALUES = ["PENDING", "ACCEPTED", "DECLINED", "EXPIRED", "CANCELLED"] as const;
export type CompanyInvitationStatusValue = (typeof COMPANY_INVITATION_STATUS_VALUES)[number];

/** An invitation is valid for this long before it must be re-issued. */
export const INVITATION_VALIDITY_DAYS = 14;

const TRANSITIONS: Record<CompanyInvitationStatusValue, CompanyInvitationStatusValue[]> = {
  PENDING: ["ACCEPTED", "DECLINED", "EXPIRED", "CANCELLED"],
  ACCEPTED: [],
  DECLINED: [],
  EXPIRED: [],
  CANCELLED: [],
};

export function canTransitionInvitation(
  from: CompanyInvitationStatusValue,
  to: CompanyInvitationStatusValue,
): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Only a PENDING, unexpired invitation can be accepted/declined/cancelled. */
export function isInvitationActionable(status: CompanyInvitationStatusValue, expiresAt: Date, now: Date): boolean {
  return status === "PENDING" && expiresAt.getTime() > now.getTime();
}

export function computeInvitationExpiresAt(from: Date): Date {
  const expires = new Date(from);
  expires.setUTCDate(expires.getUTCDate() + INVITATION_VALIDITY_DAYS);
  return expires;
}

/** An invitation can never grant OWNER — ownership only changes via
 *  TransferCompanyOwnershipUseCase. */
export function isInvitableRole(role: string): boolean {
  return role === "ADMIN" || role === "MANAGER" || role === "MEMBER";
}

/**
 * Generates a cryptographically random invitation token and its hash. The
 * raw token is what's sent to the invitee (e.g. in the invitation link/UI);
 * only `tokenHash` is ever persisted (`CompanyInvitation.tokenHash`) — same
 * "never store the raw token" convention as EmailVerificationToken/
 * PasswordResetToken/RefreshToken.
 */
export function generateInvitationToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("hex");
  return { token, tokenHash: hashInvitationToken(token) };
}

export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
