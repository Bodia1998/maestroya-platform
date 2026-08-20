import "server-only";

import { env } from "@/infrastructure/config/env";
import { stripe } from "@/infrastructure/payments/stripe/client";
import { StripeConnectGatewayAdapter } from "@/infrastructure/payments/stripe/stripe-connect-gateway";
import { StripeConnectWebhookVerifierAdapter } from "@/infrastructure/payments/stripe/stripe-connect-webhook-verifier";
import { StripeTransferGatewayAdapter } from "@/infrastructure/payments/stripe/stripe-transfer-gateway";
import type { StripeConnectGateway } from "@/application/ports/stripe-connect-gateway";
import type { StripeConnectWebhookVerifier } from "@/application/ports/stripe-connect-webhook-verifier";
import type { StripeTransferGateway } from "@/application/ports/stripe-transfer-gateway";

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

/**
 * Module 72 — Stripe Webhooks.
 *
 * Composition root for the platform's single `StripeConnectWebhookVerifier`
 * — same shared-client, one-real-implementation convention as
 * `stripeConnectGateway` above. Uses the existing, already-required
 * `STRIPE_WEBHOOK_SECRET` (`infrastructure/config/env.ts`) — no new
 * environment variable.
 */
export const stripeConnectWebhookVerifier: StripeConnectWebhookVerifier = new StripeConnectWebhookVerifierAdapter(
  stripe,
  env.STRIPE_WEBHOOK_SECRET,
);

export function makeStripeConnectWebhookVerifier(): StripeConnectWebhookVerifier {
  return stripeConnectWebhookVerifier;
}

/**
 * Module 76 — Professional Payout Execution.
 *
 * Composition root for the platform's single `StripeTransferGateway` —
 * same shared-client, one-real-implementation convention as
 * `stripeConnectGateway`/`paymentGateway` above/elsewhere. No new
 * environment variable — uses the same `stripe` SDK client singleton
 * already configured with `STRIPE_SECRET_KEY`.
 */
export const stripeTransferGateway: StripeTransferGateway = new StripeTransferGatewayAdapter(stripe);

export function makeStripeTransferGateway(): StripeTransferGateway {
  return stripeTransferGateway;
}
