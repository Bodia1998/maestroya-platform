import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { QuoteItemRecord, QuoteRepository, QuoteStatusValue } from "@/domain/repositories/quote-repository";
import type { ServiceRequestRepository } from "@/domain/repositories/service-request-repository";

export interface ProfessionalQuoteSummary {
  id: string;
  serviceRequestId: string;
  serviceRequestTitle: string;
  serviceRequestCategoryName: string;
  status: QuoteStatusValue;
  totalAmount: number;
  currency: string;
  itemCount: number;
  validUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProfessionalQuoteDetail extends ProfessionalQuoteSummary {
  notes: string | null;
  items: QuoteItemRecord[];
}

/**
 * Lists the *authenticated* professional's own submitted quotes, optionally
 * filtered by status. `userId` must come from the server-side session —
 * there is no professionalId parameter to trust or distrust, which is
 * itself the guarantee, same as GetCustomerServiceRequestsUseCase.
 *
 * Never exposes customer-private information (name, contact details,
 * exact address) — only the ServiceRequest's own title/category, which the
 * professional already has legitimate access to for any request they've
 * quoted.
 */
export class GetProfessionalQuotesUseCase {
  constructor(
    private readonly professionals: ProfessionalRepository,
    private readonly quotes: QuoteRepository,
    private readonly serviceRequests: ServiceRequestRepository,
  ) {}

  async execute(userId: string, status?: QuoteStatusValue): Promise<ProfessionalQuoteSummary[]> {
    const professional = await this.professionals.findByUserId(userId);
    if (!professional) return [];

    const quotes = await this.quotes.findManyByProfessionalId(professional.id, status);

    const summaries: ProfessionalQuoteSummary[] = [];
    for (const quote of quotes) {
      const request = await this.serviceRequests.findById(quote.serviceRequestId);
      summaries.push({
        id: quote.id,
        serviceRequestId: quote.serviceRequestId,
        serviceRequestTitle: request?.title ?? "Service request",
        serviceRequestCategoryName: request?.categoryName ?? "Unknown",
        status: quote.status,
        totalAmount: quote.totalAmount,
        currency: quote.currency,
        itemCount: quote.items.length,
        validUntil: quote.validUntil,
        createdAt: quote.createdAt,
        updatedAt: quote.updatedAt,
      });
    }
    return summaries;
  }
}
