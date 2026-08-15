/**
 * Module 66 — Job Completion & Payment Release Protection: JobCompletion-
 * Confirmation status-transition rules — same dependency-free helper style
 * as job-state.ts/dispute-state.ts. Every write to
 * `JobCompletionConfirmation.status` must go through
 * `canTransitionConfirmationStatus` (or one of the `is*` predicates below,
 * all derived from the same table), never a raw field write, and the same
 * check must be re-verified inside the persistence transaction (see
 * `PrismaJobCompletionConfirmationRepository`'s own doc comment) — the
 * exact "check in the use case AND re-check in the transaction" pattern
 * `JobRepository.complete` already documents for `Job.status`.
 *
 * Lifecycle:
 *
 *   WAITING_FOR_CUSTOMER -> CONFIRMED
 *   WAITING_FOR_CUSTOMER -> DISPUTED
 *   WAITING_FOR_CUSTOMER -> TIMED_OUT_UNDER_REVIEW
 *
 * All three of CONFIRMED/DISPUTED/TIMED_OUT_UNDER_REVIEW are terminal for
 * *this* status field — once the customer has acted (or the window has
 * lapsed), there is no path back to WAITING_FOR_CUSTOMER. This is
 * deliberately stricter than Dispute's own lifecycle (which allows
 * bouncing between UNDER_REVIEW and the WAITING_FOR_* statuses): here,
 * "did the customer respond in time" is a one-shot fact, not an ongoing
 * back-and-forth — an admin who later needs to change the *release*
 * outcome after a DISPUTED or TIMED_OUT_UNDER_REVIEW row does so through
 * `releaseStatus` (a separate field re-evaluated by
 * `EvaluatePaymentReleaseUseCase`/`AdminResolvePaymentReleaseUseCase`),
 * never by moving `status` itself back to WAITING_FOR_CUSTOMER.
 */
export type JobCompletionConfirmationStatus =
  | "WAITING_FOR_CUSTOMER"
  | "CONFIRMED"
  | "DISPUTED"
  | "TIMED_OUT_UNDER_REVIEW";

export const WAITING_FOR_CUSTOMER_STATUS: JobCompletionConfirmationStatus = "WAITING_FOR_CUSTOMER";
export const CONFIRMED_STATUS: JobCompletionConfirmationStatus = "CONFIRMED";
export const DISPUTED_STATUS: JobCompletionConfirmationStatus = "DISPUTED";
export const TIMED_OUT_UNDER_REVIEW_STATUS: JobCompletionConfirmationStatus = "TIMED_OUT_UNDER_REVIEW";

const TERMINAL_STATUSES: ReadonlySet<JobCompletionConfirmationStatus> = new Set([
  CONFIRMED_STATUS,
  DISPUTED_STATUS,
  TIMED_OUT_UNDER_REVIEW_STATUS,
]);

export function isTerminalConfirmationStatus(status: JobCompletionConfirmationStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

const TRANSITIONS: Record<JobCompletionConfirmationStatus, readonly JobCompletionConfirmationStatus[]> = {
  WAITING_FOR_CUSTOMER: [CONFIRMED_STATUS, DISPUTED_STATUS, TIMED_OUT_UNDER_REVIEW_STATUS],
  CONFIRMED: [],
  DISPUTED: [],
  TIMED_OUT_UNDER_REVIEW: [],
};

export function canTransitionConfirmationStatus(
  from: JobCompletionConfirmationStatus,
  to: JobCompletionConfirmationStatus,
): boolean {
  if (from === to) return false;
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/** Idempotency helper for ConfirmJobCompletionUseCase: a second, identical
 *  confirmation attempt on an already-CONFIRMED row is not an error, it's
 *  a no-op success (see that use case's own doc comment). Distinguishes
 *  that "safe to no-op" case from every other already-terminal status
 *  (DISPUTED/TIMED_OUT_UNDER_REVIEW), which must still reject a
 *  confirmation attempt. */
export function isAlreadyConfirmed(status: JobCompletionConfirmationStatus): boolean {
  return status === CONFIRMED_STATUS;
}
