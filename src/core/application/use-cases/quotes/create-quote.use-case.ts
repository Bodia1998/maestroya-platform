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

    return this.quotes.create({
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
  }
}
