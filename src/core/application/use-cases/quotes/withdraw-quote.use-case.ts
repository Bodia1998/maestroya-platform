import { NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { QuoteRepository } from "@/domain/repositories/quote-repository";
import { WITHDRAWN_QUOTE_STATUS, isWithdrawableQuoteStatus } from "@/domain/services/quote-state";

/**
 * Withdraws the *authenticated* professional's own Quote
 * (status -> WITHDRAWN). Ownership checked against the session's own
 * ProfessionalProfile, never a client-supplied professionalId. Only quotes
 * in a withdrawable status (SENT/VIEWED) can be withdrawn — an already-
 * WITHDRAWN (or any other terminal-status) quote rejects with a
 * ValidationError rather than silently no-op'ing, same pattern as
 * CancelServiceRequestUseCase.
 */
export class WithdrawQuoteUseCase {
  constructor(
    private readonly professionals: ProfessionalRepository,
    private readonly quotes: QuoteRepository,
  ) {}

  async execute(userId: string, quoteId: string): Promise<void> {
    const professional = await this.professionals.findByUserId(userId);
    if (!professional) {
      throw new NotFoundError("Quote", quoteId);
    }

    const existing = await this.quotes.findById(quoteId);
    if (!existing || existing.professionalProfileId !== professional.id) {
      throw new NotFoundError("Quote", quoteId);
    }

    if (!isWithdrawableQuoteStatus(existing.status)) {
      throw new ValidationError("This quote can no longer be withdrawn.");
    }

    await this.quotes.updateStatus(existing.id, WITHDRAWN_QUOTE_STATUS);
  }
}
