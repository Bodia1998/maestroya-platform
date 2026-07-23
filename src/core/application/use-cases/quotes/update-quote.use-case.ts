import { NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { QuoteRecord, QuoteRepository } from "@/domain/repositories/quote-repository";
import { calculateQuoteTotal } from "@/domain/services/money";
import { isEditableQuoteStatus } from "@/domain/services/quote-state";
import type { UpdateQuoteInput } from "@/application/dto/quote.dto";

/**
 * Updates the *authenticated* professional's own Quote — looked up by
 * quoteId, but ownership is always checked against the session's own
 * ProfessionalProfile, never trusted from the client. Only quotes in an
 * editable status (SENT/VIEWED — see quote-state.ts) can be edited; every
 * terminal status (ACCEPTED, REJECTED, EXPIRED, WITHDRAWN) rejects the
 * edit with a ValidationError, enforced here so no UI path can bypass it.
 *
 * `serviceRequestId`, `professionalProfileId`, and `submittedByUserId` can
 * never be changed by this use case — UpdateQuoteFields' type doesn't even
 * have fields for them (see quote-repository.ts). Items are always fully
 * resupplied and the total always recalculated from them (see money.ts),
 * never a client-supplied total.
 */
export class UpdateQuoteUseCase {
  constructor(
    private readonly professionals: ProfessionalRepository,
    private readonly quotes: QuoteRepository,
  ) {}

  async execute(userId: string, quoteId: string, input: UpdateQuoteInput): Promise<QuoteRecord> {
    const professional = await this.professionals.findByUserId(userId);
    if (!professional || professional.status !== "ACTIVE") {
      throw new ValidationError("You must have an active professional profile to manage quotes.");
    }

    const existing = await this.quotes.findById(quoteId);
    if (!existing || existing.professionalProfileId !== professional.id) {
      throw new NotFoundError("Quote", quoteId);
    }

    if (!isEditableQuoteStatus(existing.status)) {
      throw new ValidationError("This quote can no longer be edited.");
    }

    const totalAmount = calculateQuoteTotal(input.items);

    return this.quotes.update(existing.id, {
      totalAmount,
      currency: existing.currency,
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
