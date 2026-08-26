import { NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { QuoteRecord, QuoteRepository } from "@/domain/repositories/quote-repository";
import { calculateQuoteTotal } from "@/domain/services/money";
import { isEditableQuoteStatus } from "@/domain/services/quote-state";
import {
  assertNoPricedMaterialsWhenCustomerPurchased,
  assertValidMaterialsList,
} from "@/domain/services/materials-procurement-rules";
import { DEFAULT_MATERIALS_STRATEGY } from "@/domain/value-objects/materials-strategy";
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

    // Module 63 — Materials Procurement Workflow: an edit always resupplies
    // the complete materials strategy/list, same as it does for `items` —
    // see UpdateQuoteFields' own doc comment. Falls back to the existing
    // Quote's own strategy when the caller doesn't specify one, so a
    // client that hasn't been updated to send materials fields yet can't
    // accidentally downgrade a CUSTOMER_PURCHASED quote back to
    // PROFESSIONAL_SUPPLIED.
    const materialsStrategy = input.materialsStrategy ?? existing.materialsStrategy ?? DEFAULT_MATERIALS_STRATEGY;
    const materials = (input.materials ?? existing.materials).map((material) => ({
      name: material.name,
      brand: material.brand || null,
      model: material.model || null,
      quantity: material.quantity,
      notes: material.notes || null,
    }));
    assertValidMaterialsList(materialsStrategy, materials);
    // Module 78 audit finding: reject a priced MATERIALS QuoteItem on a
    // CUSTOMER_PURCHASED quote before persisting the edit — covers both
    // "add a priced MATERIALS item to an already-CUSTOMER_PURCHASED quote"
    // and "switch an existing PROFESSIONAL_SUPPLIED quote's strategy to
    // CUSTOMER_PURCHASED while keeping its priced MATERIALS items," since
    // an update always resupplies the complete items array (see this
    // class's own doc comment) — there is no partial-item mutation path
    // that could bypass this check. See materials-procurement-rules.ts's
    // own doc comment on this function.
    assertNoPricedMaterialsWhenCustomerPurchased(materialsStrategy, input.items);

    return this.quotes.update(existing.id, {
      totalAmount,
      currency: existing.currency,
      validUntil: input.validUntil ?? null,
      notes: input.notes || null,
      items: input.items.map((item) => ({
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        // Module 22 — Commission & Financial: defaults to LABOR when the
        // caller doesn't specify — see quote.dto.ts's own comment.
        category: item.category ?? "LABOR",
      })),
      materialsStrategy,
      materials: materialsStrategy === "CUSTOMER_PURCHASED" ? materials : [],
    });
  }
}
