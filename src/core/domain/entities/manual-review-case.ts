import { InvalidManualReviewTransitionError } from "@/domain/errors/domain-error";

/**
 * Module 65 — Trust & Integrity System: requirement #16 — the manual
 * investigation queue's state machine. A thin, dependency-free set of pure
 * transition-validity functions (not a full `Entity<Props>` class, same
 * "narrow, module-scoped" convention `materials-procurement-rules.ts`
 * uses) — `ManualReviewCaseRepository`'s implementation persists the
 * state, this file only decides whether a requested transition is legal.
 *
 * States: OPEN -> UNDER_REVIEW -> ESCALATED -> RESOLVED | REJECTED, with
 * UNDER_REVIEW able to resolve/reject directly without escalating, and
 * ESCALATED able to do the same after a senior reviewer looks at it. No
 * state is ever re-enterable once RESOLVED/REJECTED — a case that needs to
 * be reopened gets a brand-new row (mirrors `Dispute`'s own terminal-state
 * convention).
 */
export type ManualReviewCaseStateValue = "OPEN" | "UNDER_REVIEW" | "ESCALATED" | "RESOLVED" | "REJECTED";

const ALLOWED_TRANSITIONS: Readonly<Record<ManualReviewCaseStateValue, readonly ManualReviewCaseStateValue[]>> = {
  OPEN: ["UNDER_REVIEW", "REJECTED"],
  UNDER_REVIEW: ["ESCALATED", "RESOLVED", "REJECTED"],
  ESCALATED: ["RESOLVED", "REJECTED"],
  RESOLVED: [],
  REJECTED: [],
};

export function isTerminalManualReviewState(state: ManualReviewCaseStateValue): boolean {
  return state === "RESOLVED" || state === "REJECTED";
}

export function canTransitionManualReviewCase(
  from: ManualReviewCaseStateValue,
  to: ManualReviewCaseStateValue,
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** Throws `InvalidManualReviewTransitionError` rather than returning a
 *  boolean — every call site (`TransitionManualReviewCaseUseCase`) wants a
 *  hard stop, the same "assert, don't ask" shape
 *  `assertValidMaterialsList` uses. */
export function assertValidManualReviewTransition(
  from: ManualReviewCaseStateValue,
  to: ManualReviewCaseStateValue,
): void {
  if (!canTransitionManualReviewCase(from, to)) {
    throw new InvalidManualReviewTransitionError(from, to);
  }
}
