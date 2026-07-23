import type { AppointmentStatusValue } from "@/domain/repositories/quote-acceptance-repository";

/**
 * Booking & Scheduling module (Module 10): Appointment state-transition
 * rules, kept as a small dependency-free domain helper — same style as
 * quote-state.ts/service-request-state.ts — so "what counts as a valid
 * transition" has exactly one definition, not scattered `if` checks across
 * use cases.
 *
 * Business/schema reconciliation: the existing `AppointmentStatus` enum
 * (added ahead of this module, in the Quote-acceptance MVP) declares
 * PENDING_SCHEDULE, SCHEDULED, CONFIRMED, IN_PROGRESS, COMPLETED,
 * CANCELLED, NO_SHOW, RESCHEDULED. This module deliberately implements only
 * a subset of those — see the per-state decisions below — rather than
 * wiring up every declared value just because it exists on the enum.
 *
 * Decision — PENDING_SCHEDULE is the only creation-time status (unchanged
 * from the Quote-acceptance workflow — see QuoteAcceptanceRepository).
 *
 * Decision — SCHEDULED is never used by this module. It predates this
 * module (a stale schema-level `@default`) and is superseded by the
 * PROPOSED/CONFIRMED distinction below, which this module needs to
 * represent "one party proposed a time" separately from "both parties have
 * agreed." Nothing in this module ever writes AppointmentStatus.SCHEDULED.
 *
 * Decision — PROPOSED: either the customer or the professional can put
 * forward a `[proposedStart, proposedEnd)` window (see
 * ProposeAppointmentTimeUseCase). This is a negotiation state, not a
 * commitment — a PROPOSED appointment holds no scheduling conflict
 * guarantee against other professionals' bookings (see
 * ConfirmAppointmentUseCase for where conflict checking actually happens).
 * Either party may re-propose (PROPOSED -> PROPOSED with a new
 * proposedByUserId) to counter-offer a different time.
 *
 * Decision — CONFIRMED: the *other* party (i.e. not whoever last proposed)
 * accepts the currently-proposed window, which becomes the appointment's
 * authoritative `scheduledStart`/`scheduledEnd`. This is the only state
 * that participates in double-booking conflict detection.
 *
 * Decision — IN_PROGRESS is explicitly out of scope for this module (no
 * concrete near-term need identified — see the module's audit report,
 * Phase 3 "Recommended appointment state machine"). CONFIRMED transitions
 * directly to COMPLETED.
 *
 * Decision — NO_SHOW is explicitly deferred. The audit's Phase 3 target
 * architecture treats it as a "should implement now" item, but the module
 * spec for this implementation pass explicitly excludes automated no-show
 * workflows, and a manual-only no-show action was judged not essential for
 * this pass either. Left for a follow-up change; the enum value already
 * exists on the schema for when that lands, and nothing here forecloses it
 * (a future NO_SHOW transition would simply be added to CONFIRMED's
 * outgoing edges below).
 *
 * Decision — RESCHEDULED is a terminal marker only, never an active
 * appointment state a user interacts with. RescheduleAppointmentUseCase
 * moves the *old* Appointment row to RESCHEDULED and creates a brand new
 * Appointment row (linked via `rescheduledFromId`) that starts back at
 * PENDING_SCHEDULE — this keeps rescheduling non-destructive (the original
 * row's history, including who proposed/confirmed it and when, is
 * preserved forever) instead of overwriting `scheduledStart` in place.
 *
 * Decision — CANCELLED is reachable from every non-terminal state
 * (PENDING_SCHEDULE, PROPOSED, CONFIRMED) — see CancelAppointmentUseCase.
 * Once CANCELLED, COMPLETED, NO_SHOW, or RESCHEDULED, an Appointment is
 * terminal and this module refuses every further transition, including a
 * second cancellation.
 */

export const PENDING_SCHEDULE_STATUS: AppointmentStatusValue = "PENDING_SCHEDULE";
export const PROPOSED_STATUS: AppointmentStatusValue = "PROPOSED";
export const CONFIRMED_STATUS: AppointmentStatusValue = "CONFIRMED";
export const COMPLETED_STATUS: AppointmentStatusValue = "COMPLETED";
export const CANCELLED_STATUS: AppointmentStatusValue = "CANCELLED";
export const RESCHEDULED_STATUS: AppointmentStatusValue = "RESCHEDULED";

/** States in which the Appointment can still be acted on. Anything not in
 *  this set (CANCELLED, COMPLETED, RESCHEDULED, and the unused NO_SHOW) is
 *  terminal. Exported so repositories can use the exact same set as the
 *  optimistic-concurrency `expectedStatuses` guard on a write, rather than
 *  redeclaring it. */
export const NON_TERMINAL_STATUSES: readonly AppointmentStatusValue[] = [
  PENDING_SCHEDULE_STATUS,
  PROPOSED_STATUS,
  CONFIRMED_STATUS,
];

/** Statuses from which a time can be (counter-)proposed. */
export const PROPOSABLE_STATUSES: readonly AppointmentStatusValue[] = [
  PENDING_SCHEDULE_STATUS,
  PROPOSED_STATUS,
];

/** Statuses from which an appointment can be rescheduled. */
export const RESCHEDULABLE_STATUSES: readonly AppointmentStatusValue[] = [PROPOSED_STATUS, CONFIRMED_STATUS];

export function isTerminalStatus(status: AppointmentStatusValue): boolean {
  return !NON_TERMINAL_STATUSES.includes(status);
}

/** Whether a time can be proposed (initial proposal or a counter-proposal)
 *  from this status. */
export function isProposableStatus(status: AppointmentStatusValue): boolean {
  return PROPOSABLE_STATUSES.includes(status);
}

/** Whether the currently-proposed time can be confirmed from this status. */
export function isConfirmableStatus(status: AppointmentStatusValue): boolean {
  return status === PROPOSED_STATUS;
}

/** Whether the appointment can be cancelled from this status. */
export function isCancellableStatus(status: AppointmentStatusValue): boolean {
  return NON_TERMINAL_STATUSES.includes(status);
}

/** Whether the appointment can be rescheduled (superseded by a new linked
 *  Appointment row) from this status — only once a time exists to move,
 *  i.e. it's been proposed or confirmed. A PENDING_SCHEDULE appointment
 *  with no time at all is "proposed," not "rescheduled." */
export function isReschedulableStatus(status: AppointmentStatusValue): boolean {
  return RESCHEDULABLE_STATUSES.includes(status);
}

/** Whether the appointment can be marked completed from this status. */
export function isCompletableStatus(status: AppointmentStatusValue): boolean {
  return status === CONFIRMED_STATUS;
}

/**
 * Explicit transition whitelist — the single source of truth for every
 * status change this module is allowed to perform. Every use case that
 * mutates AppointmentStatus must check this (or one of the more specific
 * `is*Status` predicates above, which are all derived from the same rules)
 * before writing, and the same check is re-verified inside the persistence
 * transaction for the highest-risk transitions (see
 * ConfirmAppointmentUseCase).
 */
export function canTransitionAppointmentStatus(
  from: AppointmentStatusValue,
  to: AppointmentStatusValue,
): boolean {
  if (isTerminalStatus(from)) {
    return false;
  }

  switch (to) {
    case PROPOSED_STATUS:
      return isProposableStatus(from);
    case CONFIRMED_STATUS:
      return isConfirmableStatus(from);
    case CANCELLED_STATUS:
      return isCancellableStatus(from);
    case RESCHEDULED_STATUS:
      return isReschedulableStatus(from);
    case COMPLETED_STATUS:
      return isCompletableStatus(from);
    default:
      return false;
  }
}
