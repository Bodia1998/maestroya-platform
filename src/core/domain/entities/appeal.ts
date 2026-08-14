import { InvalidAppealTransitionError } from "@/domain/errors/domain-error";

/**
 * Module 65 — Trust & Integrity System: requirement #17 — the appeal
 * workflow's state machine, mirroring `manual-review-case.ts`'s own shape.
 *
 * States: SUBMITTED -> UNDER_REVIEW -> APPROVED | REJECTED, and APPROVED ->
 * ACCOUNT_RESTORED as the final step once the account's restriction has
 * actually been lifted (kept as its own transition, rather than folded
 * into APPROVED, so "the appeal was approved" and "the account is fully
 * restored" can be observed and audited as two distinct moments — the
 * former is a decision, the latter is its execution, matching Dispute's
 * own resolved-vs-closed split).
 */
export type AppealStateValue = "SUBMITTED" | "UNDER_REVIEW" | "APPROVED" | "REJECTED" | "ACCOUNT_RESTORED";

const ALLOWED_TRANSITIONS: Readonly<Record<AppealStateValue, readonly AppealStateValue[]>> = {
  SUBMITTED: ["UNDER_REVIEW", "REJECTED"],
  UNDER_REVIEW: ["APPROVED", "REJECTED"],
  APPROVED: ["ACCOUNT_RESTORED"],
  REJECTED: [],
  ACCOUNT_RESTORED: [],
};

export function isTerminalAppealState(state: AppealStateValue): boolean {
  return state === "REJECTED" || state === "ACCOUNT_RESTORED";
}

export function canTransitionAppeal(from: AppealStateValue, to: AppealStateValue): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertValidAppealTransition(from: AppealStateValue, to: AppealStateValue): void {
  if (!canTransitionAppeal(from, to)) {
    throw new InvalidAppealTransitionError(from, to);
  }
}
