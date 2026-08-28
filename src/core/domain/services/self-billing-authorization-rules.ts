import type { SelfBillingAuthorizationRecord } from "@/domain/repositories/self-billing-authorization-repository";

/**
 * Module 79 — Invoicing & Credit Notes: pure rules for whether a
 * professional/company may enter MaestroYa's self-billing invoice flow —
 * kept as a small, dependency-free domain helper (same style as
 * `quote-state.ts`/`job-state.ts`) so "is this party authorized" has
 * exactly one definition, never re-implemented ad hoc inside a use case.
 *
 * Do NOT assume every professional automatically has self-billing
 * authorization (see the module brief) — `isSelfBillingAuthorized` is the
 * single gate every invoice-creation path must pass through.
 */
export function isSelfBillingAuthorized(
  authorization: SelfBillingAuthorizationRecord | null,
): boolean {
  return authorization !== null && authorization.status === "ACTIVE";
}

/** Whether an authorization currently ACTIVE may be revoked. Revoking an
 *  already-REVOKED authorization is rejected (not idempotent) so a
 *  caller always gets an explicit signal rather than silently doing
 *  nothing — same reasoning as `canTransitionInvoiceStatus` rejecting a
 *  no-op transition rather than accepting it as valid. */
export function canRevokeSelfBillingAuthorization(
  authorization: SelfBillingAuthorizationRecord | null,
): boolean {
  return authorization !== null && authorization.status === "ACTIVE";
}
