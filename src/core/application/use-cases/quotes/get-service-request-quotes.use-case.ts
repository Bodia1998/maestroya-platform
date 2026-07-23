import { NotFoundError } from "@/domain/errors/domain-error";
import type { CustomerProfileRepository } from "@/domain/repositories/customer-profile-repository";
import type { VerificationStatusValue } from "@/domain/repositories/professional-repository";
import type { ProfessionalDiscoveryRepository } from "@/domain/repositories/professional-discovery-repository";
import type { QuoteItemRecord, QuoteRepository, QuoteStatusValue } from "@/domain/repositories/quote-repository";
import type { ServiceRequestRepository } from "@/domain/repositories/service-request-repository";

export interface CustomerQuoteView {
  id: string;
  status: QuoteStatusValue;
  totalAmount: number;
  currency: string;
  notes: string | null;
  validUntil: Date | null;
  items: QuoteItemRecord[];
  createdAt: Date;
  updatedAt: Date;
  professional: {
    id: string;
    displayName: string;
    profileImageUrl: string | null;
    verificationStatus: VerificationStatusValue;
  };
}

/**
 * Lists the Quotes submitted for a ServiceRequest — but only for the
 * *authenticated* customer's own request. `userId` must come from the
 * server-side session; ownership is always checked against the session's
 * own CustomerProfile, never a client-supplied customerId. A request that
 * exists but belongs to a different customer surfaces as the exact same
 * NotFoundError as a request id that doesn't exist at all — same
 * "not yours vs. doesn't exist" guarantee as GetServiceRequestUseCase, so a
 * customer can never probe for another customer's received quotes.
 *
 * Never exposes the professional's private email, phone, tax id, or exact
 * address — `professional` here is built entirely from
 * ProfessionalDiscoveryRepository.findPublicProfileById, the exact same
 * safe, marketplace-facing shape Professional Discovery already uses, not a
 * second copy of "which fields are safe to expose."
 */
export class GetServiceRequestQuotesUseCase {
  constructor(
    private readonly customerProfiles: CustomerProfileRepository,
    private readonly serviceRequests: ServiceRequestRepository,
    private readonly quotes: QuoteRepository,
    private readonly professionalDiscovery: ProfessionalDiscoveryRepository,
  ) {}

  async execute(userId: string, requestId: string): Promise<CustomerQuoteView[]> {
    const customer = await this.customerProfiles.findByUserId(userId);
    if (!customer) {
      throw new NotFoundError("ServiceRequest", requestId);
    }

    const request = await this.serviceRequests.findById(requestId);
    if (!request || request.customerId !== customer.id) {
      throw new NotFoundError("ServiceRequest", requestId);
    }

    const quotes = await this.quotes.findManyByServiceRequestId(requestId);

    const views: CustomerQuoteView[] = [];
    for (const quote of quotes) {
      const publicProfile = await this.professionalDiscovery.findPublicProfileById(
        quote.professionalProfileId,
      );

      views.push({
        id: quote.id,
        status: quote.status,
        totalAmount: quote.totalAmount,
        currency: quote.currency,
        notes: quote.notes,
        validUntil: quote.validUntil,
        items: quote.items,
        createdAt: quote.createdAt,
        updatedAt: quote.updatedAt,
        professional: publicProfile
          ? {
              id: publicProfile.id,
              displayName: publicProfile.displayName,
              profileImageUrl: publicProfile.profileImageUrl,
              verificationStatus: publicProfile.verificationStatus,
            }
          : {
              id: quote.professionalProfileId,
              displayName: "Professional",
              profileImageUrl: null,
              verificationStatus: "UNVERIFIED",
            },
      });
    }

    return views;
  }
}

export type ServiceRequestQuotesResult = CustomerQuoteView[];
