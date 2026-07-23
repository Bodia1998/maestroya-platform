import { NotFoundError } from "@/domain/errors/domain-error";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { QuoteRecord, QuoteRepository } from "@/domain/repositories/quote-repository";

/**
 * Fetches a single Quote, but *only* through its owning professional's own
 * session. `userId` must come from the server-side session, never a
 * client-supplied professionalId. A quote that exists but belongs to a
 * different professional is surfaced as the exact same NotFoundError as a
 * quote id that doesn't exist at all — mirrors GetServiceRequestUseCase's
 * "not yours vs. doesn't exist" guarantee.
 */
export class GetProfessionalQuoteUseCase {
  constructor(
    private readonly professionals: ProfessionalRepository,
    private readonly quotes: QuoteRepository,
  ) {}

  async execute(userId: string, quoteId: string): Promise<QuoteRecord> {
    const professional = await this.professionals.findByUserId(userId);
    if (!professional) {
      throw new NotFoundError("Quote", quoteId);
    }

    const quote = await this.quotes.findById(quoteId);
    if (!quote || quote.professionalProfileId !== professional.id) {
      throw new NotFoundError("Quote", quoteId);
    }

    return quote;
  }
}
