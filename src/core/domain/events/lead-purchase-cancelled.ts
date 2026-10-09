import { DomainEvent } from "@/domain/events/domain-event";

/**
 * Module 145 — LEAD_V1 lead notifications.
 *
 * Raised by the Module 141 webhook use case after a verified
 * `payment_intent.canceled` moved a PENDING_PAYMENT purchase to CANCELLED
 * (M137 lifecycle). `payment_intent.payment_failed` deliberately does NOT raise
 * it: that provider event is non-terminal (the same PaymentIntent can still
 * succeed) and leaves the purchase untouched.
 *
 * Carries the purchase id ONLY; the subscriber re-reads the purchase and
 * requires status CANCELLED.
 */
export class LeadPurchaseCancelled extends DomainEvent {
  static readonly eventName = "lead-purchase.cancelled";

  constructor(readonly purchaseId: string) {
    super();
  }
}
