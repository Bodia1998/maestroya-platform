import { DomainEvent } from "@/domain/events/domain-event";

/**
 * Module 153 — raised (best effort) after a provider-confirmed PLATFORM_ERROR lead-fee refund AND the successful
 * CONFIRMED -> REFUNDED purchase transition. Never raised for DUPLICATE_CHARGE (the purchase stays CONFIRMED) or for a
 * refund that is still pending/unknown. Carries the purchase id ONLY. There is no outbox: delivery is not guaranteed, a
 * publish failure never reverses the refund, and no subscriber or notification exists in M153.
 */
export class LeadPurchaseRefunded extends DomainEvent {
  static readonly eventName = "lead-purchase.refunded";

  constructor(readonly purchaseId: string) {
    super();
  }
}
