import { DomainEvent } from "@/domain/events/domain-event";

/**
 * Module 35 — Payment Domain Model Preparation.
 *
 * Raised by `Payment.capture()` (`domain/entities/payment.ts`) the moment
 * a payment's status becomes `CAPTURED`. This is the only domain event
 * this module introduces — see the module brief's instruction to evaluate,
 * not assume, whether the Payment domain should publish events at all.
 * The bar it clears: Module 22 — Commission & Financial's
 * `RecordCommissionForPaymentUseCase` already documents itself (see that
 * file's own doc comment) as "the use case a future Module 12 [Stripe]
 * payment-captured webhook handler is expected to call the moment a
 * Payment transitions to CAPTURED." That is a concrete, already-planned
 * consumer, not a speculative one — this event is the formalization of
 * that exact trigger point via the Module 34 `EventBus`, so Module 59's
 * webhook handler only needs to call `payment.capture()`, persist, then
 * `eventBus.publishAll(payment.pullDomainEvents())`, and a
 * `RecordCommissionForPaymentUseCase` subscriber (wired from
 * `application/use-cases/financial/compose.ts`, following the same
 * `eventBus.subscribe(...)` pattern documented in
 * `infrastructure/events/compose.ts`) takes it from there. No other
 * Payment transition (`authorize`, `fail`, `cancel`, `refund`) has an
 * equally concrete downstream consumer today, so none of them raise an
 * event yet — adding one speculatively would violate the module's "avoid
 * unnecessary events" instruction.
 */
export class PaymentCaptured extends DomainEvent {
  static readonly eventName = "payment.captured";

  constructor(
    readonly paymentId: string,
    readonly amount: number,
    readonly currency: string,
  ) {
    super();
  }
}
