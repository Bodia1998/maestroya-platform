import { NullNotificationCreator } from "@/application/ports/notification-creator";
import type { NotificationCreator } from "@/application/ports/notification-creator";
import { ConflictError, NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import type { ProfessionalDiscoveryRepository } from "@/domain/repositories/professional-discovery-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { QuoteRecord, QuoteRepository } from "@/domain/repositories/quote-repository";
import type { ServiceRequestDiscoveryRepository } from "@/domain/repositories/service-request-discovery-repository";
import { calculateQuoteTotal } from "@/domain/services/money";
import { isProfessionalEligibleForRequest } from "@/domain/services/quote-eligibility";
import type { CreateQuoteInput } from "@/application/dto/quote.dto";

/**
 * Creates a Quote for the *authenticated* professional, for a PUBLISHED
 * ServiceRequest they are eligible to respond to (see
 * domain/services/quote-eligibility.ts).
 *
 * Trust boundary — never accepts from the client:
 * - `professionalProfileId` / `submittedByUserId`: always the session's own
 *   ProfessionalProfile/userId, exactly like CreateServiceRequestUseCase
 *   never trusts a client-supplied customerId.
 * - `totalAmount` / each item's `amount`: always calculated from
 *   `items[].quantity * unitPrice` (see money.ts), never a client-supplied
 *   total even if one were sent.
 * - `status`: always the module's own initial status (see quote-state.ts),
 *   never client-settable.
 */
export class CreateQuoteUseCase {
  constructor(
    private readonly professionals: ProfessionalRepository,
    private readonly professionalDiscovery: ProfessionalDiscoveryRepository,
    private readonly requestDiscovery: ServiceRequestDiscoveryRepository,
    private readonly quotes: QuoteRepository,
    // Notifications module (Module 15): optional, defaults to a no-op —
    // see NullNotificationCreator's own doc comment.
    private readonly notifications: NotificationCreator = new NullNotificationCreator(),
  ) {}

  async execute(userId: string, input: CreateQuoteInput): Promise<QuoteRecord> {
    const professional = await this.professionals.findByUserId(userId);
    if (!professional || professional.status !== "ACTIVE") {
      throw new ValidationError("You must have an active professional profile to submit quotes.");
    }

    const candidate = await this.professionalDiscovery.findCandidateById(professional.id);
    if (!candidate) {
      throw new ValidationError("You must have an active professional profile to submit quotes.");
    }

    const request = await this.requestDiscovery.findPublishedById(input.serviceRequestId);
    if (!request) {
      throw new NotFoundError("ServiceRequest", input.serviceRequestId);
    }

    if (request.customerUserId === userId) {
      throw new ValidationError("You cannot submit a quote for your own service request.");
    }

    if (!isProfessionalEligibleForRequest(candidate, request)) {
      throw new ValidationError("You are not eligible to submit a quote for this service request.");
    }

    const existingActiveQuote = await this.quotes.findActiveByServiceRequestAndProfessional(
      request.id,
      professional.id,
    );
    if (existingActiveQuote) {
      throw new ConflictError("You already have an active quote for this service request.");
    }

    const totalAmount = calculateQuoteTotal(input.items);

    const quote = await this.quotes.create({
      serviceRequestId: request.id,
      professionalProfileId: professional.id,
      submittedByUserId: userId,
      totalAmount,
      currency: "EUR",
      validUntil: input.validUntil ?? null,
      notes: input.notes || null,
      items: input.items.map((item) => ({
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
      })),
    });

    // Best-effort — mirrors ChatAppointmentNotifier/ChatJobNotifier's own
    // doc comment: a notification-creation failure must never undo or fail
    // the quote submission itself.
    try {
      await this.notifications.notify({
        userId: request.customerUserId,
        type: "NEW_QUOTE",
        title: "New quote received",
        message: "A professional submitted a quote for your service request.",
        resourceType: "QUOTE",
        resourceId: quote.id,
        actionUrl: `/requests/${request.id}`,
      });
    } catch (error) {
      console.error("Failed to create new-quote notification", error);
    }

    return quote;
  }
}
