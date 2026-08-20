import "server-only";

import Stripe from "stripe";

import { PaymentGatewayError, type PaymentGatewayErrorCategory } from "@/domain/errors/domain-error";
import type {
  PaymentAuthorizationRequest,
  PaymentAuthorizationResult,
  PaymentGateway,
} from "@/application/ports/payment-gateway";

/**
 * Module 73 — Real Customer Payment Capture.
 *
 * `PaymentGateway` implementation backed by Stripe PaymentIntents — the
 * only file in this module that imports the Stripe SDK or knows about
 * `Stripe.PaymentIntent`'s shape, mirroring `StripeConnectGatewayAdapter`'s
 * own "only file that imports the Stripe SDK" convention
 * (`infrastructure/payments/stripe/stripe-connect-gateway.ts`). No Stripe
 * SDK type ever crosses back out of this class — every method returns (or
 * throws) only this port's own provider-agnostic shapes.
 *
 * ## Separate charges and transfers — no professional payout here
 * Every PaymentIntent this adapter creates is charged directly to
 * MaestroYa's own platform Stripe account (no `on_behalf_of`, no
 * `transfer_data` — see `stripe-connect-gateway.ts`'s own "separate
 * charges and transfers" comment on why the connected account never
 * itself processes a charge). Capturing a PaymentIntent here moves funds
 * into the *platform's* Stripe balance, nothing more — actually paying a
 * professional out of that balance is a `stripe.transfers.create()` call
 * this class deliberately never makes; that is Module 76's job.
 *
 * ## Manual capture
 * Every PaymentIntent is created with `capture_method: "manual"` — see
 * `authorize()`'s own comment for why. `capture()` is a thin call to
 * `paymentIntents.capture`, invoked only once, by
 * `ProcessCustomerPaymentWebhookUseCase` in response to Stripe's own
 * `payment_intent.amount_capturable_updated` event (i.e. once the
 * customer has already completed card confirmation and authorization
 * genuinely succeeded) — never eagerly, never speculatively.
 *
 * ## Refunds are out of scope
 * `refund()` intentionally throws rather than calling
 * `stripe.refunds.create` — see that method's own doc comment. Module 77
 * (Refund & Dispute Financial Execution) is where a real refund policy,
 * and the actual Stripe call, belongs.
 *
 * ## Never logs sensitive data
 * No card number, CVC, or full PaymentIntent payload is ever logged by
 * this class — only opaque ids (`PaymentIntent.id`) ever leave it, via
 * `PaymentAuthorizationResult.externalReference`.
 */
export class StripePaymentGatewayAdapter implements PaymentGateway {
  constructor(private readonly stripe: Stripe) {}

  async authorize(request: PaymentAuthorizationRequest): Promise<PaymentAuthorizationResult> {
    try {
      const amountMinorUnits = toStripeMinorUnits(request.amount, request.currency);

      const intent = await this.stripe.paymentIntents.create(
        {
          amount: amountMinorUnits,
          currency: request.currency.toLowerCase(),
          // Module 73's core architectural requirement: funds are
          // authorized/reserved now, but MUST NOT move into MaestroYa's
          // available balance (and, transitively, can never be
          // transferred to a professional — Module 76) until this
          // platform explicitly calls `capture()`. `capture_method:
          // "manual"` is what makes that an explicit, controlled step
          // rather than something Stripe does automatically the moment
          // the customer confirms their card.
          capture_method: "manual",
          automatic_payment_methods: { enabled: true },
          metadata: {
            paymentId: request.paymentId,
            payerId: request.payerId,
            ...request.metadata,
          },
        },
        request.idempotencyKey ? { idempotencyKey: request.idempotencyKey } : undefined,
      );

      return { externalReference: intent.id, clientSecret: intent.client_secret };
    } catch (error) {
      throw mapStripeError(error);
    }
  }

  async capture(externalReference: string): Promise<void> {
    try {
      await this.stripe.paymentIntents.capture(externalReference);
    } catch (error) {
      throw mapStripeError(error);
    }
  }

  async cancel(externalReference: string): Promise<void> {
    try {
      await this.stripe.paymentIntents.cancel(externalReference);
    } catch (error) {
      throw mapStripeError(error);
    }
  }

  /**
   * Module 73 explicitly scopes real refund execution out — see the
   * module brief's "Do not prematurely implement: refunds" instruction
   * and this class's own doc comment. Calling `stripe.refunds.create`
   * here today, ahead of Module 77's eligibility/dispute policy, would let
   * money start moving back out of the platform with no business rule
   * governing when that's allowed. Throws the same loud,
   * impossible-to-miss-in-testing failure `NullPaymentGateway` uses for
   * "this capability doesn't exist yet" — never a silent no-op.
   */
  async refund(_externalReference: string, _amount: number): Promise<void> {
    throw new PaymentGatewayError(
      "NOT_IMPLEMENTED",
      "Refunds are not implemented by Module 73 — Module 77 (Refund & Dispute Financial Execution) owns the real refund flow.",
      false,
    );
  }
}

/**
 * Converts a plain decimal `number` (this codebase's money convention —
 * see `domain/services/money.ts`) into the integer minor-unit amount
 * Stripe's API requires (e.g. `12.5` EUR -> `1250` cents). Never passes a
 * floating-point amount to Stripe — see the module brief's explicit "Add
 * tests around rounding and Stripe amount conversion" requirement.
 *
 * Every currency this platform currently supports (`EUR` — see
 * `Payment.create`'s own default) uses exactly 2 minor-unit decimal
 * places, matching the schema's `Decimal(10, 2)` column, so a flat `* 100`
 * is correct today. `Math.round` (not truncation) guards against
 * representing e.g. `10.005` (already an invalid amount under a 2-decimal
 * schema, but defensively rounded rather than floored/truncated, which
 * would silently undercharge) as `1000` instead of `1001`/`1000`
 * ambiguously.
 */
export function toStripeMinorUnits(amount: number, currency: string): number {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new PaymentGatewayError(
      "INVALID_REQUEST",
      `Cannot convert a non-finite or negative amount (${amount}) to Stripe minor units.`,
      false,
    );
  }
  if (currency.toUpperCase() !== "EUR") {
    // Every zero-decimal currency Stripe supports (JPY, KRW, ...) would
    // need a different conversion — this platform operates in Spain/EUR
    // only today (see stripe-connect-gateway.ts's own "MaestroYa currently
    // operates in Spain only" comment), so rather than silently applying
    // the wrong multiplier for a currency this platform has never actually
    // used, this is a loud failure.
    throw new PaymentGatewayError(
      "INVALID_REQUEST",
      `Unsupported currency "${currency}" — StripePaymentGatewayAdapter only supports EUR today.`,
      false,
    );
  }
  return Math.round(amount * 100);
}

/**
 * Maps any error a Stripe SDK call can throw onto a `PaymentGatewayError`
 * category — mirrors `stripe-connect-gateway.ts`'s own `mapStripeError`
 * exactly, with one addition (`CARD_DECLINED`) for the failure mode a
 * customer-payment adapter actually needs to distinguish that a
 * Connect-account adapter never sees.
 */
function mapStripeError(error: unknown): PaymentGatewayError {
  if (error instanceof Stripe.errors.StripeError) {
    const message = error.message || "Stripe payment request failed.";
    const category = classifyStripeError(error);
    const retryable = category === "RATE_LIMITED" || category === "NETWORK" || category === "TEMPORARY";
    return new PaymentGatewayError(category, message, retryable, { cause: error });
  }
  return new PaymentGatewayError(
    "UNKNOWN",
    error instanceof Error ? error.message : "Unknown payment gateway error.",
    false,
    { cause: error },
  );
}

function classifyStripeError(error: Stripe.errors.StripeError): PaymentGatewayErrorCategory {
  if (error instanceof Stripe.errors.StripeCardError) return "CARD_DECLINED";
  if (error instanceof Stripe.errors.StripeAuthenticationError) return "AUTHENTICATION";
  if (error instanceof Stripe.errors.StripeRateLimitError) return "RATE_LIMITED";
  if (error instanceof Stripe.errors.StripeConnectionError) return "NETWORK";
  if (error instanceof Stripe.errors.StripeAPIError) return "TEMPORARY";
  if (error instanceof Stripe.errors.StripeInvalidRequestError) {
    return error.code === "resource_missing" ? "NOT_FOUND" : "INVALID_REQUEST";
  }
  return "UNKNOWN";
}
