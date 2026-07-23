import { ConflictError, NotFoundError } from "@/domain/errors/domain-error";
import type {
  AcceptQuoteResult,
  AppointmentRecord,
  QuoteAcceptanceRepository,
} from "@/domain/repositories/quote-acceptance-repository";
import { OPEN_QUOTE_STATUSES } from "@/domain/services/quote-state";
import { FakeCustomerProfileRepository, FakeQuoteRepository, FakeServiceRequestRepository } from "../quotes/fakes";

/**
 * In-memory test doubles for the Booking/Appointments module, following the
 * same pattern as tests/integration/quotes/fakes.ts and
 * tests/integration/service-request/fakes.ts: implement the real interfaces
 * so AcceptQuoteUseCase runs its genuine orchestration/authorization logic,
 * with only storage swapped out.
 *
 * Reuses the exact same FakeQuoteRepository/FakeServiceRequestRepository/
 * FakeCustomerProfileRepository the Offers/Quotes module's own tests use
 * (rather than a second copy) so this module's tests exercise the same
 * QuoteStatus/ServiceRequestStatus values those fakes already produce.
 */
export { FakeCustomerProfileRepository, FakeQuoteRepository, FakeServiceRequestRepository };

let appointmentIdCounter = 0;

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
  appointments = new Map<string, AppointmentRecord>();

  constructor(
    private readonly quotes: FakeQuoteRepository,
    private readonly serviceRequests: FakeServiceRequestRepository,
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
    const appointment: AppointmentRecord = {
      id: `fake-appointment-${appointmentIdCounter}`,
      quoteId,
      serviceRequestId,
      addressId: `fake-address-for-${serviceRequestId}`,
      status: "PENDING_SCHEDULE",
      scheduledStart: null,
      scheduledEnd: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.appointments.set(appointment.id, appointment);

    return { serviceRequestId, acceptedQuoteId: quoteId, appointment };
  }
}
