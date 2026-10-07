import "server-only";

import Stripe from "stripe";

import { PaymentGatewayError, type PaymentGatewayErrorCategory } from "@/domain/errors/domain-error";
import type {
  LeadFeePaymentGateway,
  LeadFeePaymentRequest,
  LeadFeeProviderPayment,
  LeadFeeProviderPaymentStatus,
} from "@/application/ports/lead-fee-payment-gateway";

/**
 * Module 140 — `LeadFeePaymentGateway` backed by Stripe PaymentIntents.
 *
 * The only file of this module that imports the Stripe SDK; no Stripe type leaves it.
 *
 * Semantics: the PaymentIntent is the professional's payment of a MaestroYa lead fee
 * (+ IVA), charged to MaestroYa's own platform account with AUTOMATIC capture. It is NOT the
 * customer's job payment, so it deliberately has no `capture_method: "manual"`,
 * no `transfer_data` / `on_behalf_of` / `application_fee_amount` / connected account, and
 * no customer or professional personal data in its metadata (only opaque purchase/lead ids).
 * A PaymentIntent (not Checkout) is used because M141's webhook confirms by
 * `payment_intent.*` events and the frontend continues with the client secret.
 * Creating one is not payment success.
 */
export class StripeLeadFeePaymentGatewayAdapter implements LeadFeePaymentGateway {
  constructor(private readonly stripe: Stripe) {}

  async createPayment(request: LeadFeePaymentRequest): Promise<LeadFeeProviderPayment> {
    try {
      assertMinorUnits(request.amountMinorUnits);
      const intent = await this.stripe.paymentIntents.create(
        {
          amount: request.amountMinorUnits,
          currency: request.currency.toLowerCase(),
          automatic_payment_methods: { enabled: true },
          metadata: {
            flow: "LEAD_V1",
            purpose: "lead_fee",
            leadPurchaseId: request.leadPurchaseId,
            leadId: request.leadId,
          },
        },
        { idempotencyKey: request.idempotencyKey },
      );
      return toPayment(intent);
    } catch (error) {
      throw mapStripeError(error);
    }
  }

  async retrievePayment(reference: string): Promise<LeadFeeProviderPayment> {
    try {
      return toPayment(await this.stripe.paymentIntents.retrieve(reference));
    } catch (error) {
      throw mapStripeError(error);
    }
  }

  async cancelPayment(reference: string): Promise<void> {
    try {
      await this.stripe.paymentIntents.cancel(reference);
    } catch (error) {
      throw mapStripeError(error);
    }
  }
}

function assertMinorUnits(amount: number): void {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new PaymentGatewayError("INVALID_REQUEST", "Lead-fee amount must be a positive integer in minor units.", false);
  }
}

function toPayment(intent: Stripe.PaymentIntent): LeadFeeProviderPayment {
  return {
    reference: intent.id,
    clientSecret: intent.client_secret,
    status: mapStatus(intent.status),
    amountMinorUnits: intent.amount,
    currency: intent.currency.toUpperCase(),
  };
}

function mapStatus(status: Stripe.PaymentIntent.Status): LeadFeeProviderPaymentStatus {
  switch (status) {
    case "requires_payment_method":
      return "REQUIRES_PAYMENT_METHOD";
    case "requires_confirmation":
    case "requires_action":
      return "REQUIRES_ACTION";
    case "succeeded":
      return "SUCCEEDED";
    case "canceled":
      return "CANCELED";
    default:
      return "PROCESSING"; // processing, requires_capture
  }
}

function mapStripeError(error: unknown): PaymentGatewayError {
  if (error instanceof PaymentGatewayError) return error;
  if (error instanceof Stripe.errors.StripeError) {
    const category = classify(error);
    const retryable = category === "RATE_LIMITED" || category === "NETWORK" || category === "TEMPORARY";
    return new PaymentGatewayError(category, error.message || "Stripe lead-fee payment request failed.", retryable, { cause: error });
  }
  return new PaymentGatewayError("UNKNOWN", error instanceof Error ? error.message : "Unknown payment gateway error.", false, {
    cause: error,
  });
}

function classify(error: Stripe.errors.StripeError): PaymentGatewayErrorCategory {
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
