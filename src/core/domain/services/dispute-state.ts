import type { DisputeStatusValue } from "@/domain/repositories/dispute-repository";

/**
 * Module 21 — Disputes & Support: Dispute status-transition rules, kept as a
 * small dependency-free domain helper — same style as job-state.ts/
 * appointment-state.ts/service-request-state.ts/conversation-state.ts — so
 * "what counts as a valid transition" has exactly one definition, not
 * scattered `if` checks across use cases. No use case is ever allowed to
 * write `Dispute.status` directly without going through
 * `canTransitionDisputeStatus` (or one of the more specific `is*`
 * predicates below, which are all derived from the same rules) first.
 *
 * Lifecycle (see docs/MODULE_21_DISPUTES_SUPPORT.md, "Lifecycle" for the
 * full reasoning and the reconciliation with the Module 01 scaffold):
 *
 *   OPEN -> UNDER_REVIEW
 *   UNDER_REVIEW -> WAITING_FOR_CUSTOMER
 *   UNDER_REVIEW -> WAITING_FOR_PROFESSIONAL
 *   UNDER_REVIEW -> RESOLVED
 *   UNDER_REVIEW -> REJECTED
 *   WAITING_FOR_CUSTOMER -> UNDER_REVIEW      (customer responded)
 *   WAITING_FOR_PROFESSIONAL -> UNDER_REVIEW  (professional responded)
 *   WAITING_FOR_CUSTOMER -> RESOLVED
 *   WAITING_FOR_PROFESSIONAL -> RESOLVED
 *   WAITING_FOR_CUSTOMER -> REJECTED
 *   WAITING_FOR_PROFESSIONAL -> REJECTED
 *   OPEN -> RESOLVED                          (admin resolves without a review step)
 *   OPEN -> REJECTED                          (admin declines to open a case)
 *   RESOLVED -> CLOSED
 *   REJECTED -> CLOSED
 *
 * RESOLVED, REJECTED and CLOSED are each reachable only from a non-terminal
 * status; CLOSED is the single terminal status — no transition is ever
 * allowed out of it (see the "Domain rules" decision below: reopening a
 * closed dispute is explicitly out of scope for this module).
 *
 * Decision — RESOLVED/REJECTED are NOT themselves terminal: both must still
 * be explicitly moved to CLOSED (an admin-only action, see
 * CloseDisputeUseCase) rather than auto-closing. This mirrors the module
 * spec's explicit lifecycle ("RESOLVED -> CLOSED") and keeps "the outcome
 * was decided" (RESOLVED/REJECTED) distinct from "the case is fully done
 * and archived" (CLOSED) — e.g. Module 22 might still need to read a
 * RESOLVED-but-not-yet-CLOSED dispute's resolution before the case is
 * finally closed out.
 *
 * Decision — admins may move a Dispute directly from OPEN to RESOLVED or
 * REJECTED without visiting UNDER_REVIEW first (e.g. an obviously invalid
 * case) — see ADMIN transitions above. This is still enforced through this
 * same whitelist, never a raw field write, but is a deliberately looser
 * rule than e.g. Job's linear lifecycle: a Dispute's "review" step is a
 * process marker, not a hard precondition for every outcome.
 *
 * Decision — WAITING_FOR_CUSTOMER and WAITING_FOR_PROFESSIONAL are not
 * reachable from each other directly (only via UNDER_REVIEW) — "who needs
 * to respond" is decided once from an active-review state, not toggled
 * directly between waiting-on-customer and waiting-on-professional.
 *
 * Decision — every transition, including admin-initiated ones, goes through
 * this exact whitelist (the module spec's "can admins override normal
 * transitions" answer: yes, admins can move to any valid state per the
 * whitelist, but still through the same transition-checked use case, never
 * a raw field write) — there is no separate "admin bypass" function.
 */

export const OPEN_STATUS: DisputeStatusValue = "OPEN";
export const UNDER_REVIEW_STATUS: DisputeStatusValue = "UNDER_REVIEW";
export const WAITING_FOR_CUSTOMER_STATUS: DisputeStatusValue = "WAITING_FOR_CUSTOMER";
export const WAITING_FOR_PROFESSIONAL_STATUS: DisputeStatusValue = "WAITING_FOR_PROFESSIONAL";
export const RESOLVED_STATUS: DisputeStatusValue = "RESOLVED";
export const REJECTED_STATUS: DisputeStatusValue = "REJECTED";
export const CLOSED_STATUS: DisputeStatusValue = "CLOSED";

/** Statuses in which the case is still actionable. CLOSED is the only
 *  terminal status — RESOLVED/REJECTED are "decided" but not yet archived
 *  (see this file's own doc comment). */
export const NON_TERMINAL_STATUSES: readonly DisputeStatusValue[] = [
  OPEN_STATUS,
  UNDER_REVIEW_STATUS,
  WAITING_FOR_CUSTOMER_STATUS,
  WAITING_FOR_PROFESSIONAL_STATUS,
  RESOLVED_STATUS,
  REJECTED_STATUS,
];

export const WAITING_STATUSES: readonly DisputeStatusValue[] = [
  WAITING_FOR_CUSTOMER_STATUS,
  WAITING_FOR_PROFESSIONAL_STATUS,
];

export function isTerminalStatus(status: DisputeStatusValue): boolean {
  return status === CLOSED_STATUS;
}

/** Whether a party (not an admin) posting a new message on the dispute
 *  should auto-transition it back to UNDER_REVIEW — see
 *  AddDisputeMessageUseCase. Only true from the two "waiting on a specific
 *  party" statuses, and only when that message's author is the party being
 *  waited on. */
export function isWaitingOnResponse(status: DisputeStatusValue): boolean {
  return WAITING_STATUSES.includes(status);
}

const TRANSITIONS: Record<DisputeStatusValue, readonly DisputeStatusValue[]> = {
  OPEN: [UNDER_REVIEW_STATUS, RESOLVED_STATUS, REJECTED_STATUS],
  UNDER_REVIEW: [WAITING_FOR_CUSTOMER_STATUS, WAITING_FOR_PROFESSIONAL_STATUS, RESOLVED_STATUS, REJECTED_STATUS],
  WAITING_FOR_CUSTOMER: [UNDER_REVIEW_STATUS, RESOLVED_STATUS, REJECTED_STATUS],
  WAITING_FOR_PROFESSIONAL: [UNDER_REVIEW_STATUS, RESOLVED_STATUS, REJECTED_STATUS],
  RESOLVED: [CLOSED_STATUS],
  REJECTED: [CLOSED_STATUS],
  CLOSED: [],
};

/**
 * Explicit transition whitelist — the single source of truth for every
 * status change this module is allowed to perform. Every use case that
 * mutates Dispute.status must check this before writing.
 */
export function canTransitionDisputeStatus(from: DisputeStatusValue, to: DisputeStatusValue): boolean {
  if (from === to) return false;
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/** Whether the Dispute can be resolved (RESOLVED) from this status. */
export function isResolvableStatus(status: DisputeStatusValue): boolean {
  return canTransitionDisputeStatus(status, RESOLVED_STATUS);
}

/** Whether the Dispute can be rejected (REJECTED) from this status. */
export function isRejectableStatus(status: DisputeStatusValue): boolean {
  return canTransitionDisputeStatus(status, REJECTED_STATUS);
}

/** Whether the Dispute can be closed (CLOSED) from this status — only from
 *  RESOLVED or REJECTED (see this file's own doc comment). */
export function isClosableStatus(status: DisputeStatusValue): boolean {
  return canTransitionDisputeStatus(status, CLOSED_STATUS);
}
