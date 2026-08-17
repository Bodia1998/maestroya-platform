import "server-only";

import { stripe } from "@/infrastructure/payments/stripe/client";
import { StripeConnectGatewayAdapter } from "@/infrastructure/payments/stripe/stripe-connect-gateway";
import type { StripeConnectGateway } from "@/application/ports/stripe-connect-gateway";

/**
 * Module 71 — Stripe Connect.
 *
 * Composition root for the platform's single `StripeConnectGateway` —
 * same manual-composition convention as `infrastructure/payments/
 * compose.ts` (`PaymentGateway`). One real implementation, backed by the
 * existing shared `stripe` SDK client singleton
 * (`infrastructure/payments/stripe/client.ts`) — no second Stripe client
 * is created anywhere in this module.
 */
export const stripeConnectGateway: StripeConnectGateway = new StripeConnectGatewayAdapter(stripe);

export function makeStripeConnectGateway(): StripeConnectGateway {
  return stripeConnectGateway;
}
