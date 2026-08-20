import { ValidationError } from "@/domain/errors/domain-error";
import type { PaymentCaptured } from "@/domain/events/payment-captured";
import type { EventHandler } from "@/application/ports/event-bus";
import type { RecordCommissionForPaymentUseCase } from "@/application/use-cases/financial/record-commission-for-payment.use-case";
import { logger } from "@/infrastructure/observability/logger";

/**
 * Module 73 — Real Customer Payment Capture: the concrete subscriber
 * `PaymentCaptured`'s own doc comment (`domain/events/payment-captured.ts`)
 * already documents as the planned consumer — "a
 * `RecordCommissionForPaymentUseCase` subscriber (wired from
 * `application/use-cases/financial/compose.ts`... following the same
 * `eventBus.subscribe(...)` pattern...) takes it from there." Registered
 * from this module's own `compose.ts` instead (not
 * `financial/compose.ts`) only because Module 73 is what actually wires
 * `PaymentCaptured`'s publisher (the webhook use case) — keeping publisher
 * and the event's first subscriber registration in sibling modules that
 * both depend on `financial`'s already-exported
 * `makeRecordCommissionForPaymentUseCase()` reuses that module entirely,
 * rather than either duplicating it or reversing the dependency direction.
 *
 * ## Module 66 gate is expected, not a failure
 * `RecordCommissionForPaymentUseCase` itself refuses to record a
 * commission until Module 66's payment-release decision reaches
 * `RELEASE_APPROVED` (job completion confirmed) — see that use case's own
 * doc comment. At the moment a payment is first captured, that decision
 * almost never exists yet (the job has usually not even started). This
 * subscriber treats exactly that one `ValidationError` message shape as
 * the expected, routine "not yet, try again once the job completes" case
 * — logged at `info`, not rethrown — so it never pollutes
 * `EventDispatchError` reporting (Sentry, on-call noise) with what is
 * completely normal, expected behavior on every single captured payment.
 * `RecordCommissionForPaymentUseCase` is called again, for the same
 * `paymentId`, once the release decision actually is approved (Module 66's
 * own completion flow — see that module's docs); this subscriber's job is
 * only to cover the case where release already happened to be approved
 * *before* capture (unusual, but not impossible) or a future flow where
 * capture and approval race. Any other error is a genuine failure and is
 * rethrown, to be caught and reported by `SynchronousEventBus`/
 * `publishDomainEvent`'s own `EventDispatchError` handling.
 */
export class RecordCommissionOnPaymentCapturedSubscriber implements EventHandler<PaymentCaptured> {
  constructor(private readonly recordCommission: RecordCommissionForPaymentUseCase) {}

  async handle(event: PaymentCaptured): Promise<void> {
    try {
      await this.recordCommission.execute(event.paymentId);
    } catch (error) {
      if (error instanceof ValidationError) {
        logger.info("payment_captured.commission_deferred", {
          paymentId: event.paymentId,
          reason: error.message,
        });
        return;
      }
      throw error;
    }
  }
}
