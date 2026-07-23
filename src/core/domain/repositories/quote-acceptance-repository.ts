/**
 * Booking/Appointments module: repository interface for the single atomic
 * operation that implements Quote acceptance (see AcceptQuoteUseCase).
 *
 * Deliberately NOT a general-purpose AppointmentRepository — this module's
 * scope is limited to "create the Appointment that results from accepting a
 * Quote," never scheduling, rescheduling, availability, or a full
 * Appointment CRUD surface (see prisma/schema.prisma's Appointment model
 * doc and the module's own scope notes). A single method captures the
 * entire cross-aggregate write (Quote + competing Quotes + ServiceRequest +
 * Appointment) so it can be executed as one Prisma interactive transaction
 * — see PrismaQuoteAcceptanceRepository — rather than spreading it across
 * QuoteRepository/ServiceRequestRepository calls that would each commit
 * independently and reintroduce the partial-success risk this module must
 * avoid.
 */

/**
 * Booking & Scheduling module (Module 10) note: PROPOSED was added to the
 * underlying Prisma `AppointmentStatus` enum by
 * prisma/migrations/*_add_appointment_scheduling_lifecycle to represent "a
 * time has been put forward but not yet confirmed" — see
 * domain/services/appointment-state.ts for the full transition rules.
 * SCHEDULED remains declared on the Prisma enum for backward compatibility
 * but is never written by any code — superseded by the PROPOSED/CONFIRMED
 * distinction.
 */
export type AppointmentStatusValue =
  | "PENDING_SCHEDULE"
  | "SCHEDULED"
  | "PROPOSED"
  | "CONFIRMED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "CANCELLED"
  | "NO_SHOW"
  | "RESCHEDULED";

export interface AppointmentRecord {
  id: string;
  /** Order / Job Lifecycle module (Module 11): the Job this Appointment
   *  belongs to — created in the same transaction as this Appointment
   *  (see PrismaQuoteAcceptanceRepository.acceptQuote). Every Appointment
   *  has exactly one Job. */
  jobId: string;
  quoteId: string;
  serviceRequestId: string;
  addressId: string;
  /** Denormalized from the accepted Quote at creation time (Booking &
   *  Scheduling module) — exactly one of professionalProfileId/
   *  companyProfileId is set, mirroring Quote's own ownership pattern. See
   *  prisma/schema.prisma's Appointment model doc comment. */
  professionalProfileId: string | null;
  companyProfileId: string | null;
  status: AppointmentStatusValue;
  /** Always null on creation — no scheduling happens as part of Quote
   *  acceptance itself. See schema.prisma's Appointment.scheduledStart doc
   *  comment and the Booking & Scheduling module's propose/confirm flow. */
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Order / Job Lifecycle module (Module 11): minimal shape of the Job
 * created alongside the Appointment below — just enough for callers (and
 * tests) to assert the Job/Appointment/Quote/ServiceRequest relationships
 * without this repository depending on the full JobRecord type from
 * job-repository.ts (kept narrow, same "this interface only exposes what
 * this one atomic operation needs" convention as the rest of this file).
 */
export interface AcceptQuoteJobRecord {
  id: string;
  serviceRequestId: string;
  quoteId: string;
  customerId: string;
  professionalProfileId: string | null;
  companyProfileId: string | null;
  status: "CREATED";
  createdAt: Date;
  updatedAt: Date;
}

export interface AcceptQuoteResult {
  serviceRequestId: string;
  acceptedQuoteId: string;
  job: AcceptQuoteJobRecord;
  appointment: AppointmentRecord;
}

export interface QuoteAcceptanceRepository {
  /**
   * Atomically, in a single database transaction:
   *  1. Re-verifies the ServiceRequest is still PUBLISHED (fetches its
   *     addressId/customerId for the Job/Appointment at the same time).
   *  2. Transitions the selected Quote (must still be SENT/VIEWED) to
   *     ACCEPTED — conditioned on both id/serviceRequestId/status matching,
   *     so a concurrent acceptance attempt can never win twice.
   *  3. Transitions every other SENT/VIEWED Quote on the same
   *     ServiceRequest to REJECTED. WITHDRAWN/EXPIRED/already-terminal
   *     quotes are left untouched.
   *  4. Transitions the ServiceRequest to ACCEPTED — again conditioned on
   *     it still being PUBLISHED, closing the same race window.
   *  5. Order / Job Lifecycle module (Module 11): creates exactly one Job
   *     (status CREATED), 1:1 with the accepted Quote — see
   *     prisma/schema.prisma's Job model doc comment. `Job.quoteId`'s
   *     unique constraint provides database-level protection against a
   *     second Job for the same Quote; the same conditional-updateMany
   *     race guard on step 2 above ensures a concurrent acceptance attempt
   *     can never reach this step twice for the same Quote in the first
   *     place.
   *  6. Creates exactly one Appointment referencing the accepted Quote, the
   *     ServiceRequest, the ServiceRequest's own Address, and the Job just
   *     created (Appointment.jobId) — status PENDING_SCHEDULE,
   *     scheduledStart left null (no scheduling in this MVP).
   *
   * Throws a domain error (see domain/errors/domain-error.ts) and performs
   * no writes at all if the ServiceRequest/Quote can no longer be accepted
   * — including the race case where a concurrent call already accepted it
   * between the caller's own pre-checks and this call.
   */
  acceptQuote(params: { quoteId: string; serviceRequestId: string }): Promise<AcceptQuoteResult>;
}
