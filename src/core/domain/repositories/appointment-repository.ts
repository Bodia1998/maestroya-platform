import type { AppointmentRecord, AppointmentStatusValue } from "@/domain/repositories/quote-acceptance-repository";

export type { AppointmentRecord, AppointmentStatusValue } from "@/domain/repositories/quote-acceptance-repository";

/**
 * Booking & Scheduling module (Module 10): repository interface for the
 * Appointment lifecycle AFTER initial creation (propose / confirm /
 * reschedule / cancel / read).
 *
 * Deliberately separate from QuoteAcceptanceRepository, which stays scoped
 * to exactly one thing — the atomic write that produces the initial
 * PENDING_SCHEDULE Appointment as a side effect of accepting a Quote (see
 * that repository's own doc comment). This repository never creates an
 * Appointment from scratch; every Appointment it operates on already
 * exists, created by QuoteAcceptanceRepository.acceptQuote (or, for a
 * rescheduled appointment, by this repository's own `reschedule`, which is
 * the one place this repository does create a new Appointment row — see
 * its doc comment).
 */

export type AppointmentCancellationReasonValue =
  | "CUSTOMER_REQUEST"
  | "PROFESSIONAL_UNAVAILABLE"
  | "SCHEDULING_CONFLICT"
  | "OTHER";

/**
 * The full Appointment shape needed once the lifecycle moves beyond
 * "just created" — everything AppointmentRecord has, plus the
 * proposal/cancellation/reschedule-link fields this module introduces.
 */
export interface AppointmentDetailRecord extends AppointmentRecord {
  proposedStart: Date | null;
  proposedEnd: Date | null;
  proposedByUserId: string | null;
  notes: string | null;
  cancelledAt: Date | null;
  cancelledByUserId: string | null;
  cancellationReason: AppointmentCancellationReasonValue | null;
  cancellationNote: string | null;
  rescheduledFromId: string | null;
  /** Set on an old (RESCHEDULED) Appointment once a new one supersedes it. */
  rescheduledToId: string | null;
}

/**
 * Cheap, list-friendly projection — avoids pulling every detail field for
 * "my appointments" screens. Denormalizes a couple of read-only display
 * fields (service request title, other participant's name) the same way
 * ConversationSummary does for Chat, so the UI never needs a second lookup
 * per row.
 */
export interface AppointmentSummary {
  id: string;
  serviceRequestId: string;
  serviceRequestTitle: string;
  status: AppointmentStatusValue;
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  proposedStart: Date | null;
  proposedEnd: Date | null;
  /** The other side's display name relative to whichever caller the list
   *  was fetched for (customer sees the professional's/company's name and
   *  vice versa). */
  counterpartyName: string | null;
  createdAt: Date;
}

export interface ProposeAppointmentTimeData {
  appointmentId: string;
  proposedStart: Date;
  proposedEnd: Date;
  proposedByUserId: string;
  /** Optimistic-concurrency guard, same convention as
   *  QuoteAcceptanceRepository's conditional updateMany: the write only
   *  applies if the appointment's status is still one of these when the
   *  write executes. */
  expectedStatuses: readonly AppointmentStatusValue[];
}

export interface CancelAppointmentData {
  appointmentId: string;
  cancelledByUserId: string;
  reason: AppointmentCancellationReasonValue;
  note: string | null;
  expectedStatuses: readonly AppointmentStatusValue[];
}

export interface RescheduleAppointmentData {
  appointmentId: string;
  proposedStart: Date;
  proposedEnd: Date;
  proposedByUserId: string;
  expectedStatuses: readonly AppointmentStatusValue[];
}

/** Order / Job Lifecycle module (Module 11). */
export interface CompleteAppointmentData {
  appointmentId: string;
  expectedStatuses: readonly AppointmentStatusValue[];
}

export interface RescheduleAppointmentResult {
  previous: AppointmentDetailRecord;
  next: AppointmentDetailRecord;
}

export interface ListAppointmentsOptions {
  /** "upcoming" = non-terminal, or terminal with scheduledStart in the
   *  future (PROPOSED/CONFIRMED/PENDING_SCHEDULE); "past" = COMPLETED or
   *  any non-cancelled appointment whose scheduledEnd has passed;
   *  "cancelled" = status CANCELLED. Omit for everything. */
  filter?: "upcoming" | "past" | "cancelled";
  limit: number;
  offset: number;
}

export interface AppointmentRepository {
  findById(id: string): Promise<AppointmentDetailRecord | null>;

  listForCustomer(customerId: string, options: ListAppointmentsOptions): Promise<AppointmentSummary[]>;
  listForProfessional(
    professionalProfileId: string,
    options: ListAppointmentsOptions,
  ): Promise<AppointmentSummary[]>;

  /**
   * Puts forward (or counter-proposes) a `[proposedStart, proposedEnd)`
   * window. Conditioned on the appointment's status still being one of
   * `expectedStatuses` at write time (see ProposeAppointmentTimeData) —
   * loses a race the same way QuoteAcceptanceRepository's conditional
   * updateMany does, throwing ConflictError rather than silently
   * overwriting a state change that happened concurrently (e.g. the other
   * party cancelled while this proposal was in flight).
   */
  proposeTime(data: ProposeAppointmentTimeData): Promise<AppointmentDetailRecord>;

  /**
   * Confirms the appointment's currently-proposed time, making it the
   * authoritative `scheduledStart`/`scheduledEnd`. This is the highest-risk
   * concurrency operation in the module — see
   * PrismaAppointmentRepository.confirm's doc comment for the full
   * application-level + transaction-level double-booking protection.
   * Throws ConflictError both for a lost optimistic-concurrency race (the
   * appointment's status changed since the caller last read it) and for a
   * genuine scheduling conflict (the same professional/company already has
   * a CONFIRMED appointment overlapping this window) — callers should
   * treat both as "this confirmation could not be completed, refresh and
   * try again," not assume which one occurred from the error alone (the
   * message differs; the error type does not need to).
   */
  confirm(appointmentId: string, expectedStatuses: readonly AppointmentStatusValue[]): Promise<AppointmentDetailRecord>;

  cancel(data: CancelAppointmentData): Promise<AppointmentDetailRecord>;

  /**
   * Order / Job Lifecycle module (Module 11): CONFIRMED -> COMPLETED — one
   * visit/work session is done. Conditioned on `expectedStatuses`, same
   * optimistic-concurrency pattern as every other mutating method here.
   * Deliberately does not touch Job.status — Appointment completion and Job
   * completion are separate concepts (see domain/services/job-state.ts's
   * doc comment); CompleteJobUseCase is a distinct, explicit action.
   */
  complete(data: CompleteAppointmentData): Promise<AppointmentDetailRecord>;

  /**
   * Non-destructive reschedule: the existing appointment transitions to
   * RESCHEDULED (terminal, its full proposal/confirmation history left
   * intact) and a brand-new Appointment row is created, linked via
   * `rescheduledFromId`, carrying over quoteId/serviceRequestId/addressId/
   * ownership from the row it supersedes and starting at PROPOSED with the
   * newly proposed time — it still requires the other party's confirmation
   * (see appointment-state.ts), so this never bypasses the same
   * conflict-checked `confirm` path a fresh proposal would.
   */
  reschedule(data: RescheduleAppointmentData): Promise<RescheduleAppointmentResult>;
}
