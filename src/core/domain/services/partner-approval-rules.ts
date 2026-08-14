import { InvalidPartnerTransitionError } from "@/domain/errors/domain-error";
import type { PartnerStatusValue } from "@/domain/repositories/partner-repository";

/**
 * Module 61 — Affiliate & Partner System: the partner approval-workflow
 * state machine. Every admin action (approve/reject/suspend/ban) that
 * changes `Partner.status` must go through `assertValidPartnerStatusTransition`
 * first — same "the lifecycle rule lives in one pure function, raised from
 * inside a domain-level check, never re-validated ad hoc at every call
 * site" convention `InvalidPaymentTransitionError`/`InvalidBackupTransitionError`
 * document for their own aggregates.
 *
 * Allowed transitions:
 *   PENDING   -> APPROVED | REJECTED
 *   APPROVED  -> SUSPENDED | BANNED
 *   SUSPENDED -> APPROVED | BANNED
 *   REJECTED  -> (terminal — a rejected applicant must re-apply, not be
 *                 flipped straight to APPROVED)
 *   BANNED    -> (terminal — a ban is never auto-reversible; if a ban was a
 *                 mistake, that is an out-of-band data correction, not a
 *                 state transition this module models)
 */
const ALLOWED_TRANSITIONS: Record<PartnerStatusValue, readonly PartnerStatusValue[]> = {
  PENDING: ["APPROVED", "REJECTED"],
  APPROVED: ["SUSPENDED", "BANNED"],
  SUSPENDED: ["APPROVED", "BANNED"],
  REJECTED: [],
  BANNED: [],
};

export function canTransitionPartnerStatus(from: PartnerStatusValue, to: PartnerStatusValue): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertValidPartnerStatusTransition(from: PartnerStatusValue, to: PartnerStatusValue): void {
  if (!canTransitionPartnerStatus(from, to)) {
    throw new InvalidPartnerTransitionError(
      `Cannot transition a Partner from "${from}" to "${to}".`,
    );
  }
}

/** A partner may only generate referral links / earn commissions while
 *  `APPROVED` — `PENDING` (not yet reviewed), `REJECTED`, `SUSPENDED`, and
 *  `BANNED` all deny it, for the same reason: the approval workflow exists
 *  precisely to gate this capability. */
export function isPartnerActiveForAffiliateActivity(status: PartnerStatusValue): boolean {
  return status === "APPROVED";
}
