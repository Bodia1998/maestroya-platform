import { NullPaymentGateway } from "@/infrastructure/payments/null-payment-gateway";
import type { PaymentGateway } from "@/application/ports/payment-gateway";

/**
 * Module 35 — Payment Domain Model Preparation.
 *
 * Composition root for the platform's single `PaymentGateway` — same
 * manual-composition convention as every other `compose.ts` in this
 * codebase (no DI container; see `infrastructure/events/compose.ts` for
 * the pattern this mirrors, and `application/use-cases/auth/compose.ts`
 * for the original convention).
 *
 * `new NullPaymentGateway()` is called exactly once, right here. When
 * Module 59 (Stripe Connect) lands, this is the *only* file that changes:
 * swap the line below for `new StripeConnectPaymentGateway(stripe)`. Every
 * use case that depends on `PaymentGateway` keeps importing
 * `paymentGateway`/`makePaymentGateway` from here and needs no changes,
 * because both classes implement the same `PaymentGateway` port — this is
 * the "no existing code should need to change" requirement from the
 * module brief, satisfied structurally rather than by convention alone.
 */
export const paymentGateway: PaymentGateway = new NullPaymentGateway();

export function makePaymentGateway(): PaymentGateway {
  return paymentGateway;
}
