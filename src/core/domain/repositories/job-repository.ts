/**
 * Order / Job Lifecycle module (Module 11): repository interface for the
 * Job lifecycle AFTER creation (start / complete / cancel / read). Job
 * creation itself is not exposed here — a Job is created exactly once,
 * atomically alongside the initial Appointment, as part of
 * QuoteAcceptanceRepository.acceptQuote (see that repository's own doc
 * comment) — same "deliberately separate from post-creation lifecycle"
 * split AppointmentRepository already uses relative to
 * QuoteAcceptanceRepository.
 */

export type JobStatusValue = "CREATED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";

export type JobCancellationReasonValue =
  | "CUSTOMER_REQUEST"
  | "PROFESSIONAL_UNABLE_TO_COMPLETE"
  | "SERVICE_REQUEST_ISSUE"
  | "OTHER";

export interface JobRecord {
  id: string;
  serviceRequestId: string;
  quoteId: string;
  /** CustomerProfile.id — never a User.id, same convention as
   *  ServiceRequestRecord.customerId. */
  customerId: string;
  /** Denormalized from the accepted Quote at creation time — exactly one
   *  of professionalProfileId/companyProfileId is set, mirroring
   *  Quote's/Appointment's own ownership pattern. */
  professionalProfileId: string | null;
  companyProfileId: string | null;
  status: JobStatusValue;
  startedAt: Date | null;
  startedByUserId: string | null;
  completedAt: Date | null;
  completedByUserId: string | null;
  cancelledAt: Date | null;
  cancelledByUserId: string | null;
  cancellationReason: JobCancellationReasonValue | null;
  cancellationNote: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Cheap, list-friendly projection — avoids pulling every detail field for
 * "my jobs" screens. Mirrors AppointmentSummary's own shape/rationale.
 */
export interface JobSummary {
  id: string;
  serviceRequestId: string;
  serviceRequestTitle: string;
  status: JobStatusValue;
  startedAt: Date | null;
  completedAt: Date | null;
  /** The other side's display name relative to whichever caller the list
   *  was fetched for (customer sees the professional's/company's name and
   *  vice versa). */
  counterpartyName: string | null;
  createdAt: Date;
}

export interface ListJobsOptions {
  /** "active" = non-terminal (CREATED/IN_PROGRESS); "completed" = COMPLETED;
   *  "cancelled" = CANCELLED. Omit for everything. */
  filter?: "active" | "completed" | "cancelled";
  limit: number;
  offset: number;
}

export interface StartJobData {
  jobId: string;
  startedByUserId: string;
  /** Optimistic-concurrency guard, same convention as
   *  AppointmentRepository's mutating methods: the write only applies if
   *  the Job's status is still one of these when the write executes. */
  expectedStatuses: readonly JobStatusValue[];
}

export interface CompleteJobData {
  jobId: string;
  completedByUserId: string;
  expectedStatuses: readonly JobStatusValue[];
}

export interface CancelJobData {
  jobId: string;
  cancelledByUserId: string;
  reason: JobCancellationReasonValue;
  note: string | null;
  expectedStatuses: readonly JobStatusValue[];
}

export interface JobRepository {
  findById(id: string): Promise<JobRecord | null>;

  listForCustomer(customerId: string, options: ListJobsOptions): Promise<JobSummary[]>;
  listForProfessional(professionalProfileId: string, options: ListJobsOptions): Promise<JobSummary[]>;

  /** CREATED -> IN_PROGRESS. Conditioned on the Job's status still being
   *  one of `expectedStatuses` at write time — loses a race (e.g. a
   *  concurrent cancellation) the same way AppointmentRepository's mutating
   *  methods do, throwing ConflictError rather than silently overwriting a
   *  state change that happened concurrently. */
  startWork(data: StartJobData): Promise<JobRecord>;

  /**
   * IN_PROGRESS -> COMPLETED. The highest-risk operation on this
   * repository: implementations MUST verify, atomically with the status
   * write (inside the same transaction, re-reading — never trusting a
   * previously-fetched list), that no Appointment belonging to this Job is
   * still in a non-terminal status (PENDING_SCHEDULE/PROPOSED/CONFIRMED —
   * see appointment-state.ts's NON_TERMINAL_STATUSES). If any are found,
   * this must throw rather than complete the Job — a Job is never
   * completed while a visit is still outstanding, and Appointments are
   * never silently auto-completed as a side effect. See
   * PrismaJobRepository.complete's doc comment for the concrete
   * transaction shape, mirroring PrismaAppointmentRepository.confirm's own
   * "re-check inside the transaction" pattern.
   */
  complete(data: CompleteJobData): Promise<JobRecord>;

  /** CREATED/IN_PROGRESS -> CANCELLED. Conditioned on `expectedStatuses`,
   *  same pattern as startWork/complete. */
  cancel(data: CancelJobData): Promise<JobRecord>;
}
