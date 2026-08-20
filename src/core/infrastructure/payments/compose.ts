import { stripe } from "@/infrastructure/payments/stripe/client";
import { StripePaymentGatewayAdapter } from "@/infrastructure/payments/stripe/stripe-payment-gateway";
import type { PaymentGateway } from "@/application/ports/payment-gateway";

/**
 * Module 35 — Payment Domain Model Preparation / Module 73 — Real Customer
 * Payment Capture.
 *
 * Composition root for the platform's single `PaymentGateway` — same
 * manual-composition convention as every other `compose.ts` in this
 * codebase (no DI container; see `infrastructure/events/compose.ts` for
 * the pattern this mirrors, and `application/use-cases/auth/compose.ts`
 * for the original convention).
 *
 * As predicted by this file's original Module 35 doc comment, Module 73 is
 * the *only* file that changes to go from `NullPaymentGateway` to a real
 * implementation: `new StripePaymentGatewayAdapter(stripe)`, backed by the
 * same shared `stripe` SDK client singleton
 * (`infrastructure/payments/stripe/client.ts`) `stripeConnectGateway`
 * already uses — no second Stripe client is created anywhere. Every use
 * case that depends on `PaymentGateway` keeps importing
 * `paymentGateway`/`makePaymentGateway` from here and needed no changes,
 * because both classes implement the same `PaymentGateway` port.
 */
export const paymentGateway: PaymentGateway = new StripePaymentGatewayAdapter(stripe);

export function makePaymentGateway(): PaymentGateway {
  return paymentGateway;
}
