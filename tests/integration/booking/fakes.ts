import { ConflictError, NotFoundError } from "@/domain/errors/domain-error";
import type {
  AppointmentCancellationReasonValue,
  AppointmentDetailRecord,
  AppointmentRepository,
  AppointmentSummary,
  CancelAppointmentData,
  ListAppointmentsOptions,
  ProposeAppointmentTimeData,
  RescheduleAppointmentData,
  RescheduleAppointmentResult,
} from "@/domain/repositories/appointment-repository";
import type {
  AcceptQuoteResult,
  AppointmentStatusValue,
  QuoteAcceptanceRepository,
} from "@/domain/repositories/quote-acceptance-repository";
import { OPEN_QUOTE_STATUSES } from "@/domain/services/quote-state";
import { FakeCustomerProfileRepository, FakeQuoteRepository, FakeServiceRequestRepository } from "../quotes/fakes";

/**
 * In-memory test doubles for the Booking & Scheduling module, following the
 * same pattern as tests/integration/quotes/fakes.ts and
 * tests/integration/service-request/fakes.ts: implement the real interfaces
 * so the real use cases run their genuine orchestration/authorization
 * logic, with only storage swapped out.
 *
 * Reuses the exact same FakeQuoteRepository/FakeServiceRequestRepository/
 * FakeCustomerProfileRepository the Offers/Quotes module's own tests use
 * (rather than a second copy) so this module's tests exercise the same
 * QuoteStatus/ServiceRequestStatus values those fakes already produce.
 */
export { FakeCustomerProfileRepository, FakeQuoteRepository, FakeServiceRequestRepository };

let appointmentIdCounter = 0;

/** Shared in-memory "table" both fakes below operate on — mirrors how
 *  PrismaQuoteAcceptanceRepository and PrismaAppointmentRepository are two
 *  separate classes reading/writing the same underlying `appointments`
 *  table. Tests construct one AppointmentStore and pass it to both fakes. */
export type AppointmentStore = Map<string, AppointmentDetailRecord>;

export function createAppointmentStore(): AppointmentStore {
  return new Map();
}

const NON_TERMINAL: AppointmentStatusValue[] = ["PENDING_SCHEDULE", "PROPOSED", "CONFIRMED"];

/**
 * Mirrors PrismaQuoteAcceptanceRepository's contract on top of the same
 * in-memory Maps FakeQuoteRepository/FakeServiceRequestRepository already
 * use, so a test can seed data via those fakes and then observe the same
 * underlying records this repository mutates.
 *
 * This fake has no real database transaction to roll back, but achieves the
 * same "no partial writes on failure" guarantee the real implementation
 * gets from Prisma's interactive transaction: every precondition is
 * validated *before* any mutation below runs, so a thrown error always
 * happens before this method has touched any Map.
 */
export class FakeQuoteAcceptanceRepository implements QuoteAcceptanceRepository {
  constructor(
    private readonly quotes: FakeQuoteRepository,
    private readonly serviceRequests: FakeServiceRequestRepository,
    readonly appointments: AppointmentStore = createAppointmentStore(),
  ) {}

  async acceptQuote({
    quoteId,
    serviceRequestId,
  }: {
    quoteId: string;
    serviceRequestId: string;
  }): Promise<AcceptQuoteResult> {
    const request = this.serviceRequests.requests.get(serviceRequestId);
    if (!request) {
      throw new NotFoundError("ServiceRequest", serviceRequestId);
    }
    if (request.status !== "PUBLISHED") {
      throw new ConflictError("This request can no longer accept a quote.");
    }

    const quote = this.quotes.quotes.get(quoteId);
    if (
      !quote ||
      quote.serviceRequestId !== serviceRequestId ||
      !OPEN_QUOTE_STATUSES.includes(quote.status)
    ) {
      throw new ConflictError("This quote can no longer be accepted.");
    }

    // Every check above passed — now (and only now) mutate state, same
    // "validate everything, then write" ordering PrismaQuoteAcceptanceRepository
    // gets for free from its conditional updateMany() counts.
    this.quotes.quotes.set(quoteId, { ...quote, status: "ACCEPTED", updatedAt: new Date() });

    for (const other of this.quotes.quotes.values()) {
      if (
        other.serviceRequestId === serviceRequestId &&
        other.id !== quoteId &&
        OPEN_QUOTE_STATUSES.includes(other.status)
      ) {
        this.quotes.quotes.set(other.id, { ...other, status: "REJECTED", updatedAt: new Date() });
      }
    }

    this.serviceRequests.requests.set(serviceRequestId, {
      ...request,
      status: "ACCEPTED",
      updatedAt: new Date(),
    });

    appointmentIdCounter += 1;
    const appointment: AppointmentDetailRecord = {
      id: `fake-appointment-${appointmentIdCounter}`,
      quoteId,
      serviceRequestId,
      addressId: `fake-address-for-${serviceRequestId}`,
      // Booking & Scheduling module (Module 10): denormalized from the
      // accepted Quote, mirroring PrismaQuoteAcceptanceRepository.
      professionalProfileId: quote.professionalProfileId,
      companyProfileId: null,
      status: "PENDING_SCHEDULE",
      scheduledStart: null,
      scheduledEnd: null,
      proposedStart: null,
      proposedEnd: null,
      proposedByUserId: null,
      notes: null,
      cancelledAt: null,
      cancelledByUserId: null,
      cancellationReason: null,
      cancellationNote: null,
      rescheduledFromId: null,
      rescheduledToId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.appointments.set(appointment.id, appointment);

    return { serviceRequestId, acceptedQuoteId: quoteId, appointment };
  }
}

/**
 * Mirrors PrismaAppointmentRepository's contract, including its conflict
 * detection for `confirm` (half-open-interval overlap against other
 * CONFIRMED appointments for the same provider) — so tests exercising
 * double-booking rejection get real behavior, not a stub that always
 * succeeds. Operates on the same AppointmentStore a
 * FakeQuoteAcceptanceRepository was constructed with, so a test can accept
 * a quote and then drive the resulting Appointment through its full
 * lifecycle against one shared in-memory table.
 */
export class FakeAppointmentRepository implements AppointmentRepository {
  constructor(private readonly appointments: AppointmentStore) {}

  async findById(id: string): Promise<AppointmentDetailRecord | null> {
    return this.appointments.get(id) ?? null;
  }

  async listForCustomer(customerId: string, options: ListAppointmentsOptions): Promise<AppointmentSummary[]> {
    // Test-only shortcut: fakes.ts's ServiceRequest records don't carry
    // enough joined data to resolve customerId -> appointments without a
    // second fake; tests that need list behavior seed
    // `serviceRequestCustomerIds` directly.
    return this.filterToSummaries((a) => this.serviceRequestCustomerIds.get(a.serviceRequestId) === customerId, options);
  }

  async listForProfessional(
    professionalProfileId: string,
    options: ListAppointmentsOptions,
  ): Promise<AppointmentSummary[]> {
    return this.filterToSummaries((a) => a.professionalProfileId === professionalProfileId, options);
  }

  /** Test seam: maps serviceRequestId -> customerId so listForCustomer can
   *  filter without a full ServiceRequest join (see its comment above). */
  serviceRequestCustomerIds = new Map<string, string>();

  private filterToSummaries(
    predicate: (a: AppointmentDetailRecord) => boolean,
    options: ListAppointmentsOptions,
  ): AppointmentSummary[] {
    const now = new Date();
    const matches = [...this.appointments.values()].filter(predicate).filter((a) => {
      if (options.filter === "upcoming") return NON_TERMINAL.includes(a.status);
      if (options.filter === "cancelled") return a.status === "CANCELLED";
      if (options.filter === "past") {
        return a.status === "COMPLETED" || (NON_TERMINAL.includes(a.status) && !!a.scheduledEnd && a.scheduledEnd < now);
      }
      return true;
    });
    return matches
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(options.offset, options.offset + options.limit)
      .map((a) => ({
        id: a.id,
        serviceRequestId: a.serviceRequestId,
        serviceRequestTitle: "Service request",
        status: a.status,
        scheduledStart: a.scheduledStart,
        scheduledEnd: a.scheduledEnd,
        proposedStart: a.proposedStart,
        proposedEnd: a.proposedEnd,
        counterpartyName: null,
        createdAt: a.createdAt,
      }));
  }

  async proposeTime(data: ProposeAppointmentTimeData): Promise<AppointmentDetailRecord> {
    const appointment = this.appointments.get(data.appointmentId);
    if (!appointment || !data.expectedStatuses.includes(appointment.status)) {
      throw new ConflictError("This appointment can no longer be proposed for.");
    }
    const updated: AppointmentDetailRecord = {
      ...appointment,
      status: "PROPOSED",
      proposedStart: data.proposedStart,
      proposedEnd: data.proposedEnd,
      proposedByUserId: data.proposedByUserId,
      updatedAt: new Date(),
    };
    this.appointments.set(appointment.id, updated);
    return updated;
  }

  async confirm(
    appointmentId: string,
    expectedStatuses: readonly AppointmentStatusValue[],
  ): Promise<AppointmentDetailRecord> {
    const appointment = this.appointments.get(appointmentId);
    if (!appointment || !expectedStatuses.includes(appointment.status)) {
      throw new ConflictError("This appointment can no longer be confirmed.");
    }
    if (!appointment.proposedStart || !appointment.proposedEnd) {
      throw new ConflictError("No proposed time to confirm.");
    }

    const conflict = [...this.appointments.values()].some(
      (other) =>
        other.id !== appointmentId &&
        other.status === "CONFIRMED" &&
        ((appointment.professionalProfileId && other.professionalProfileId === appointment.professionalProfileId) ||
          (appointment.companyProfileId && other.companyProfileId === appointment.companyProfileId)) &&
        other.scheduledStart! < appointment.proposedEnd! &&
        other.scheduledEnd! > appointment.proposedStart!,
    );
    if (conflict) {
      throw new ConflictError(
        "This professional already has a confirmed appointment that overlaps with this time.",
      );
    }

    const updated: AppointmentDetailRecord = {
      ...appointment,
      status: "CONFIRMED",
      scheduledStart: appointment.proposedStart,
      scheduledEnd: appointment.proposedEnd,
      updatedAt: new Date(),
    };
    this.appointments.set(appointment.id, updated);
    return updated;
  }

  async cancel(data: CancelAppointmentData): Promise<AppointmentDetailRecord> {
    const appointment = this.appointments.get(data.appointmentId);
    if (!appointment || !data.expectedStatuses.includes(appointment.status)) {
      throw new ConflictError("This appointment can no longer be cancelled.");
    }
    const updated: AppointmentDetailRecord = {
      ...appointment,
      status: "CANCELLED",
      cancelledAt: new Date(),
      cancelledByUserId: data.cancelledByUserId,
      cancellationReason: data.reason as AppointmentCancellationReasonValue,
      cancellationNote: data.note,
      updatedAt: new Date(),
    };
    this.appointments.set(appointment.id, updated);
    return updated;
  }

  async reschedule(data: RescheduleAppointmentData): Promise<RescheduleAppointmentResult> {
    const previous = this.appointments.get(data.appointmentId);
    if (!previous || !data.expectedStatuses.includes(previous.status)) {
      throw new ConflictError("This appointment can no longer be rescheduled.");
    }

    const updatedPrevious: AppointmentDetailRecord = {
      ...previous,
      status: "RESCHEDULED",
      updatedAt: new Date(),
    };

    appointmentIdCounter += 1;
    const next: AppointmentDetailRecord = {
      id: `fake-appointment-${appointmentIdCounter}`,
      quoteId: previous.quoteId,
      serviceRequestId: previous.serviceRequestId,
      addressId: previous.addressId,
      professionalProfileId: previous.professionalProfileId,
      companyProfileId: previous.companyProfileId,
      status: "PROPOSED",
      scheduledStart: null,
      scheduledEnd: null,
      proposedStart: data.proposedStart,
      proposedEnd: data.proposedEnd,
      proposedByUserId: data.proposedByUserId,
      notes: null,
      cancelledAt: null,
      cancelledByUserId: null,
      cancellationReason: null,
      cancellationNote: null,
      rescheduledFromId: previous.id,
      rescheduledToId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    updatedPrevious.rescheduledToId = next.id;
    this.appointments.set(previous.id, updatedPrevious);
    this.appointments.set(next.id, next);

    return { previous: updatedPrevious, next };
  }
}
