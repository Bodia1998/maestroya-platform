import { NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import type { ConversationRecord, ConversationRepository } from "@/domain/repositories/conversation-repository";
import type { CustomerProfileRepository } from "@/domain/repositories/customer-profile-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { QuoteRepository } from "@/domain/repositories/quote-repository";
import type { ServiceRequestRepository } from "@/domain/repositories/service-request-repository";

/**
 * Chat module: the central "start or resume talking to the other side of a
 * job" use case.
 *
 * Business rules (Phase 3 of the module spec):
 *  - A Conversation is always scoped to one ServiceRequest and exactly two
 *    participants: the request's own customer and one professional.
 *  - The relationship must already exist before a Conversation can be
 *    opened: the professional must have submitted at least one Quote on
 *    this ServiceRequest (any status — SENT, VIEWED, ACCEPTED, REJECTED, or
 *    WITHDRAWN all count, since "the professional and customer have started
 *    talking about this job" doesn't un-happen when a quote is later
 *    withdrawn or rejected). This directly answers "can a customer message a
 *    professional before accepting a quote" (yes, as soon as *a* quote
 *    exists) and "before *any* quote is submitted" (no — there is nothing to
 *    discuss yet, and allowing it would let a customer message an
 *    uninterested/non-matching professional with no relationship to the
 *    request at all).
 *  - Symmetrically, a professional can only message the customer once they
 *    themselves have submitted a quote — the existing quote-submission
 *    eligibility rules (see quote-eligibility.ts) are the only gate; this
 *    use case does not duplicate them, it just requires a Quote row to
 *    exist.
 *  - Opening a conversation that already exists for this exact
 *    (ServiceRequest, customer, professional) triple returns the existing
 *    one rather than creating a duplicate thread.
 *
 * Authorization: `userId` always comes from the server-side session. Every
 * ownership/relationship check is re-derived from that session — a
 * `serviceRequestId`/`professionalProfileId` pairing supplied by the client
 * is never trusted as proof of a relationship, exactly like
 * AcceptQuoteUseCase's convention. A ServiceRequest the caller has no
 * relationship to surfaces as NotFoundError, never leaking whether it exists
 * at all.
 */
export class OpenConversationUseCase {
  constructor(
    private readonly customerProfiles: CustomerProfileRepository,
    private readonly professionals: ProfessionalRepository,
    private readonly serviceRequests: ServiceRequestRepository,
    private readonly quotes: QuoteRepository,
    private readonly conversations: ConversationRepository,
  ) {}

  async execute(
    userId: string,
    serviceRequestId: string,
    professionalProfileId?: string,
  ): Promise<ConversationRecord> {
    const request = await this.serviceRequests.findById(serviceRequestId);
    if (!request) {
      throw new NotFoundError("ServiceRequest", serviceRequestId);
    }

    const [customer, professional] = await Promise.all([
      this.customerProfiles.findByUserId(userId),
      this.professionals.findByUserId(userId),
    ]);

    let counterpartyUserId: string;

    if (customer && customer.id === request.customerId) {
      // Caller is this ServiceRequest's own customer — they must specify
      // which professional (of possibly several who've quoted) to talk to.
      if (!professionalProfileId) {
        throw new ValidationError("Choose which professional to message.");
      }

      const quotesOnRequest = await this.quotes.findManyByServiceRequestId(serviceRequestId);
      const matchingQuote = quotesOnRequest.find((q) => q.professionalProfileId === professionalProfileId);
      if (!matchingQuote) {
        // No relationship yet — this professional has never quoted this
        // request, so there is nothing to open a conversation about.
        throw new NotFoundError("Professional", professionalProfileId);
      }

      const professionalRecord = await this.professionals.findById(professionalProfileId);
      if (!professionalRecord) {
        throw new NotFoundError("Professional", professionalProfileId);
      }

      counterpartyUserId = professionalRecord.userId;
    } else if (professional) {
      // Caller must be the professional who quoted this exact request.
      const ownQuote = await this.quotes.findByServiceRequestAndProfessional(serviceRequestId, professional.id);
      if (!ownQuote) {
        throw new NotFoundError("ServiceRequest", serviceRequestId);
      }

      const requestCustomer = await this.customerProfiles.findById(request.customerId);
      if (!requestCustomer) {
        throw new NotFoundError("ServiceRequest", serviceRequestId);
      }

      counterpartyUserId = requestCustomer.userId;
    } else {
      // Signed in, but neither this request's customer nor a quoting
      // professional — no relationship to this ServiceRequest at all.
      throw new NotFoundError("ServiceRequest", serviceRequestId);
    }

    const existing = await this.conversations.findByServiceRequestAndParticipants(
      serviceRequestId,
      userId,
      counterpartyUserId,
    );
    if (existing) {
      return existing;
    }

    return this.conversations.create(serviceRequestId, [userId, counterpartyUserId]);
  }
}
