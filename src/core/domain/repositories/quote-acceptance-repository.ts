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

export type AppointmentStatusValue =
  | "PENDING_SCHEDULE"
  | "SCHEDULED"
  | "CONFIRMED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "CANCELLED"
  | "NO_SHOW"
  | "RESCHEDULED";

export interface AppointmentRecord {
  id: string;
  quoteId: string;
  serviceRequestId: string;
  addressId: string;
  status: AppointmentStatusValue;
  /** Always null on creation in this MVP — no scheduling implemented yet.
   *  See schema.prisma's Appointment.scheduledStart doc comment. */
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AcceptQuoteResult {
  serviceRequestId: string;
  acceptedQuoteId: string;
  appointment: AppointmentRecord;
}

export interface QuoteAcceptanceRepository {
  /**
   * Atomically, in a single database transaction:
   *  1. Re-verifies the ServiceRequest is still PUBLISHED (fetches its
   *     addressId for the Appointment at the same time).
   *  2. Transitions the selected Quote (must still be SENT/VIEWED) to
   *     ACCEPTED — conditioned on both id/serviceRequestId/status matching,
   *     so a concurrent acceptance attempt can never win twice.
   *  3. Transitions every other SENT/VIEWED Quote on the same
   *     ServiceRequest to REJECTED. WITHDRAWN/EXPIRED/already-terminal
   *     quotes are left untouched.
   *  4. Transitions the ServiceRequest to ACCEPTED — again conditioned on
   *     it still being PUBLISHED, closing the same race window.
   *  5. Creates exactly one Appointment referencing the accepted Quote, the
   *     ServiceRequest, and the ServiceRequest's own Address — status
   *     PENDING_SCHEDULE, scheduledStart left null (no scheduling in this
   *     MVP).
   *
   * Throws a domain error (see domain/errors/domain-error.ts) and performs
   * no writes at all if the ServiceRequest/Quote can no longer be accepted
   * — including the race case where a concurrent call already accepted it
   * between the caller's own pre-checks and this call.
   */
  acceptQuote(params: { quoteId: string; serviceRequestId: string }): Promise<AcceptQuoteResult>;
}
