import { NullNotificationCreator } from "@/application/ports/notification-creator";
import type { NotificationCreator } from "@/application/ports/notification-creator";
import { NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import type { CustomerProfileRepository } from "@/domain/repositories/customer-profile-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { AcceptQuoteResult, QuoteAcceptanceRepository } from "@/domain/repositories/quote-acceptance-repository";
import type { QuoteRepository } from "@/domain/repositories/quote-repository";
import type { ServiceRequestRepository } from "@/domain/repositories/service-request-repository";
import { isAcceptableQuoteStatus } from "@/domain/services/quote-state";
import { isAcceptableStatus } from "@/domain/services/service-request-state";

export type { AcceptQuoteResult } from "@/domain/repositories/quote-acceptance-repository";

/**
 * Booking/Appointments module: the central "accept a Quote" use case.
 *
 * Implements the transition described in the module spec: the
 * *authenticated* Customer accepts one of the Quotes on their own
 * ServiceRequest, which atomically accepts that Quote, rejects every other
 * still-open Quote on the same request, moves the ServiceRequest to
 * ACCEPTED, and creates the resulting Appointment.
 *
 * Authorization is never based on a client-supplied customerId/quoteId
 * pairing being "trusted" — every ownership check here is re-derived from
 * the authenticated session's own CustomerProfile, same convention as
 * CancelServiceRequestUseCase/WithdrawQuoteUseCase:
 *   - `userId` must come from the server-side session (see requireAuth()).
 *   - The ServiceRequest must belong to that session's own CustomerProfile.
 *   - The Quote must belong to that exact ServiceRequest.
 * A ServiceRequest or Quote that exists but isn't the caller's own surfaces
 * as the same NotFoundError as one that doesn't exist at all, so a customer
 * can never probe for someone else's requests/quotes this way.
 *
 * This use case performs the "nice error message" pre-checks (state
 * validation before ever touching the database's write path); the actual
 * atomic write — and the authoritative, race-safe re-check of both
 * statuses — happens inside QuoteAcceptanceRepository.acceptQuote (see its
 * doc comment). Losing a race with a concurrent acceptance attempt surfaces
 * as that repository's own ConflictError, not a silent partial success.
 */
export class AcceptQuoteUseCase {
  constructor(
    private readonly customerProfiles: CustomerProfileRepository,
    private readonly serviceRequests: ServiceRequestRepository,
    private readonly quotes: QuoteRepository,
    private readonly quoteAcceptance: QuoteAcceptanceRepository,
    // Notifications module (Module 15): both optional, defaulting to
    // undefined/a no-op so every pre-existing direct construction of this
    // use case (this codebase's own tests) keeps compiling and behaving
    // exactly as before — see NullNotificationCreator's own doc comment.
    private readonly professionals?: ProfessionalRepository,
    private readonly notifications: NotificationCreator = new NullNotificationCreator(),
  ) {}

  async execute(userId: string, serviceRequestId: string, quoteId: string): Promise<AcceptQuoteResult> {
    const customer = await this.customerProfiles.findByUserId(userId);
    if (!customer) {
      throw new NotFoundError("ServiceRequest", serviceRequestId);
    }

    const request = await this.serviceRequests.findById(serviceRequestId);
    if (!request || request.customerId !== customer.id) {
      throw new NotFoundError("ServiceRequest", serviceRequestId);
    }

    const quote = await this.quotes.findById(quoteId);
    if (!quote || quote.serviceRequestId !== serviceRequestId) {
      throw new NotFoundError("Quote", quoteId);
    }

    if (!isAcceptableQuoteStatus(quote.status)) {
      throw new ValidationError("This quote can no longer be accepted.");
    }

    if (!isAcceptableStatus(request.status)) {
      throw new ValidationError("This request can no longer accept a quote.");
    }

    const result = await this.quoteAcceptance.acceptQuote({ quoteId: quote.id, serviceRequestId: request.id });

    // Best-effort — mirrors ChatAppointmentNotifier/ChatJobNotifier's own
    // doc comment: a notification-creation failure must never undo or
    // fail the quote acceptance itself. `professionals` is optional (see
    // this class's own doc comment) — skipped entirely if not supplied.
    if (this.professionals) {
      try {
        const acceptedProfessional = await this.professionals.findById(quote.professionalProfileId);
        if (acceptedProfessional) {
          await this.notifications.notify({
            userId: acceptedProfessional.userId,
            type: "QUOTE_ACCEPTED",
            title: "Your quote was accepted",
            message: "The customer accepted your quote.",
            resourceType: "QUOTE",
            resourceId: quote.id,
            actionUrl: `/jobs/${result.job.id}`,
          });
        }

        // The atomic acceptQuote transaction also rejects every other
        // still-open quote on this ServiceRequest (see
        // QuoteAcceptanceRepository.acceptQuote's own doc comment, step 3)
        // — read the now-updated statuses back to notify each of those
        // professionals too, without needing the repository's write path
        // to return that list itself.
        const allQuotes = await this.quotes.findManyByServiceRequestId(request.id);
        const rejected = allQuotes.filter((q) => q.id !== quote.id && q.status === "REJECTED");
        for (const rejectedQuote of rejected) {
          try {
            const rejectedProfessional = await this.professionals.findById(rejectedQuote.professionalProfileId);
            if (rejectedProfessional) {
              await this.notifications.notify({
                userId: rejectedProfessional.userId,
                type: "QUOTE_REJECTED",
                title: "Your quote was not selected",
                message: "The customer accepted a different quote for this service request.",
                resourceType: "QUOTE",
                resourceId: rejectedQuote.id,
                actionUrl: `/requests/${request.id}`,
              });
            }
          } catch (error) {
            console.error("Failed to create quote-rejected notification", error);
          }
        }
      } catch (error) {
        console.error("Failed to create quote-accepted notification", error);
      }
    }

    return result;
  }
}
