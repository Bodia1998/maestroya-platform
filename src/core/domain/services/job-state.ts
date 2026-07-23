import type { JobStatusValue } from "@/domain/repositories/job-repository";

/**
 * Order / Job Lifecycle module (Module 11): Job state-transition rules,
 * kept as a small dependency-free domain helper — same style as
 * appointment-state.ts/quote-state.ts/service-request-state.ts — so "what
 * counts as a valid transition" has exactly one definition, not scattered
 * `if` checks across use cases.
 *
 * Lifecycle (deliberately smaller than the module's own conceptual
 * hypothesis — see the module's audit report, "State Machine
 * Recommendation"):
 *
 *   CREATED -> IN_PROGRESS -> COMPLETED
 *   CREATED -> CANCELLED
 *   IN_PROGRESS -> CANCELLED
 *
 * COMPLETED and CANCELLED are terminal — no transition is ever allowed out
 * of either.
 *
 * Decision — CREATED is the only creation-time status. A Job is always
 * created automatically as a side effect of Quote acceptance (see
 * QuoteAcceptanceRepository.acceptQuote), never directly by a customer or
 * professional.
 *
 * Decision — completing directly from CREATED is deliberately NOT allowed.
 * The module's own audit recommends an explicit professional-side "start
 * work" action (StartJobUseCase) distinct from Appointment confirmation,
 * so a Job should normally be started (CREATED -> IN_PROGRESS) before it
 * can be completed — `isCompletableStatus` only accepts IN_PROGRESS. This
 * also means "was work ever started" is always recoverable from
 * `startedAt`/`startedByUserId` being set, rather than ambiguous.
 *
 * Decision — Job completion is a separate concept from Appointment
 * completion (CONFIRMED -> COMPLETED, see appointment-state.ts): Appointment
 * COMPLETED means "one visit/work session is done"; Job COMPLETED means
 * "the entire engagement is done." This module's own use case
 * (CompleteJobUseCase) is responsible for verifying no non-terminal
 * Appointment remains before allowing the Job transition — that check is
 * NOT expressed here, since it depends on a second aggregate's state
 * (Appointment), not just the Job's own status, and must be re-verified
 * atomically inside the repository's transaction (see
 * JobRepository.complete's doc comment) rather than trusted from a
 * previously-fetched list.
 *
 * Decision — CANCELLED is reachable from every non-terminal status
 * (CREATED, IN_PROGRESS) — either party (customer or professional/company)
 * may cancel, see CancelJobUseCase. Once COMPLETED or CANCELLED, a Job is
 * terminal and this module refuses every further transition, including a
 * second cancellation. Reopening a completed/cancelled Job (e.g. via a
 * future Dispute) is explicitly out of scope — see the module's audit
 * report, "CAN BE DEFERRED".
 */

export const CREATED_STATUS: JobStatusValue = "CREATED";
export const IN_PROGRESS_STATUS: JobStatusValue = "IN_PROGRESS";
export const COMPLETED_STATUS: JobStatusValue = "COMPLETED";
export const CANCELLED_STATUS: JobStatusValue = "CANCELLED";

/** States in which the Job can still be acted on. Anything not in this set
 *  (COMPLETED, CANCELLED) is terminal. Exported so the repository can use
 *  the exact same set as the optimistic-concurrency `expectedStatuses`
 *  guard on a write, rather than redeclaring it. */
export const NON_TERMINAL_STATUSES: readonly JobStatusValue[] = [CREATED_STATUS, IN_PROGRESS_STATUS];

export function isTerminalStatus(status: JobStatusValue): boolean {
  return !NON_TERMINAL_STATUSES.includes(status);
}

/** Whether work can be started (CREATED -> IN_PROGRESS) from this status. */
export function isStartableStatus(status: JobStatusValue): boolean {
  return status === CREATED_STATUS;
}

/** Whether the Job can be marked completed from this status. Only
 *  IN_PROGRESS — a Job should normally be started before it's completed
 *  (see this module's doc comment above). Does NOT account for whether any
 *  Appointment on the Job is still non-terminal — that is a cross-aggregate
 *  check performed by CompleteJobUseCase/JobRepository.complete, not this
 *  pure per-Job-status predicate. */
export function isCompletableStatus(status: JobStatusValue): boolean {
  return status === IN_PROGRESS_STATUS;
}

/** Whether the Job can be cancelled from this status — every non-terminal
 *  status, mirroring Appointment's own "cancellable from anywhere
 *  non-terminal" rule. */
export function isCancellableStatus(status: JobStatusValue): boolean {
  return NON_TERMINAL_STATUSES.includes(status);
}

/**
 * Explicit transition whitelist — the single source of truth for every
 * status change this module is allowed to perform. Every use case that
 * mutates Job.status must check this (or one of the more specific `is*Status`
 * predicates above, which are all derived from the same rules) before
 * writing, and the same check is re-verified inside the persistence
 * transaction for the highest-risk transitions (see
 * PrismaJobRepository.complete).
 */
export function canTransitionJobStatus(from: JobStatusValue, to: JobStatusValue): boolean {
  if (isTerminalStatus(from)) {
    return false;
  }

  switch (to) {
    case IN_PROGRESS_STATUS:
      return isStartableStatus(from);
    case COMPLETED_STATUS:
      return isCompletableStatus(from);
    case CANCELLED_STATUS:
      return isCancellableStatus(from);
    default:
      return false;
  }
}
