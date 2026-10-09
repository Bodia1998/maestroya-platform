import { DomainEvent } from "@/domain/events/domain-event";

/**
 * Module 145 — LEAD_V1 lead notifications.
 *
 * Raised by the Module 141 lead-fee payment webhook use case only after the
 * signature-verified `payment_intent.succeeded` has been validated against the
 * immutable snapshot and the purchase is CONFIRMED (freshly, or observed
 * already-confirmed on a redelivery). It is NOT raised by the checkout page, by
 * payment initiation, by a client-side Stripe result or by frontend polling.
 *
 * Carries the purchase id ONLY (a server-side value from the persisted,
 * write-once `paymentReference` correlation). It is never rendered into a
 * notification; the subscriber re-reads the purchase and requires status
 * CONFIRMED before notifying anybody.
 */
export class LeadPurchaseConfirmed extends DomainEvent {
  static readonly eventName = "lead-purchase.confirmed";

  constructor(readonly purchaseId: string) {
    super();
  }
}
