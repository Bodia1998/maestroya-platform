import type { LeadPurchaseDTO } from "@/application/dto/lead-purchase.dto";
import { toLeadPurchaseDto } from "@/application/dto/lead-purchase.dto";
import { NotFoundError } from "@/domain/errors/domain-error";
import type { LeadPurchaseRepository } from "@/domain/repositories/lead-purchase-repository";
import {
  InvalidLeadPurchaseTransitionError,
  NON_CONFIRMING_TARGET_STATUSES,
  assertLeadPurchaseTransition,
  type LeadPurchaseStatus,
} from "@/domain/services/lead-purchase";

/**
 * Module 126 — TRUSTED, INTERNAL non-confirming transitions:
 * PENDING_PAYMENT -> FAILED | CANCELLED and CONFIRMED -> REFUNDED | REVOKED.
 *
 * Like ConfirmLeadPurchaseUseCase it takes no session and is not exposed to
 * the browser. CONFIRMED is NOT a valid target here (confirmation has its own
 * use case that re-validates the Lead). Idempotent: repeating the transition
 * that already happened returns the purchase unchanged; any other terminal
 * move is rejected. Moving out of CONFIRMED immediately removes contact
 * access (Module 122 grants only on CONFIRMED). No refund/payout is executed
 * here — this records state only.
 */
export class TransitionLeadPurchaseUseCase {
  constructor(
    private readonly purchases: LeadPurchaseRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(purchaseId: string, target: LeadPurchaseStatus): Promise<LeadPurchaseDTO> {
    if (!(NON_CONFIRMING_TARGET_STATUSES as readonly string[]).includes(target)) {
      throw new InvalidLeadPurchaseTransitionError("ANY", String(target));
    }
    const purchase = await this.purchases.findById(purchaseId);
    if (!purchase) throw new NotFoundError("LeadPurchase", String(purchaseId));

    if (purchase.status === target) return toLeadPurchaseDto(purchase);
    assertLeadPurchaseTransition(purchase.status, target);

    const updated = await this.purchases.transition(purchaseId, purchase.status, target, this.now());
    if (updated) return toLeadPurchaseDto(updated);

    const current = await this.purchases.findById(purchaseId);
    if (!current) throw new NotFoundError("LeadPurchase", purchaseId);
    if (current.status === target) return toLeadPurchaseDto(current);
    throw new InvalidLeadPurchaseTransitionError(current.status, target);
  }
}
