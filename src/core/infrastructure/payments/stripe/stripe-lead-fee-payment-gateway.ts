import "server-only";

import Stripe from "stripe";

import { PaymentGatewayError, type PaymentGatewayErrorCategory } from "@/domain/errors/domain-error";
import type {
  LeadFeePaymentGateway,
  LeadFeePaymentRequest,
  LeadFeeProviderPayment,
  LeadFeeProviderPaymentFacts,
  LeadFeeProviderPaymentStatus,
  LeadFeeProviderRefund,
  LeadFeeProviderRefundStatus,
  LeadFeeRefundRequest,
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
 *
 * Module 153 adds ONLY `refunds.create` / `refunds.list` and the read of a payment's latest charge. Every refund
 * is a full refund of one payment, carries only opaque ids in its metadata, and is never created with
 * `reverse_transfer` / `refund_application_fee` (there is no transfer or fee to reverse).
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

  async retrievePaymentFacts(reference: string): Promise<LeadFeeProviderPaymentFacts> {
    try {
      const intent = await this.stripe.paymentIntents.retrieve(reference, { expand: ["latest_charge"] });
      const charge = intent.latest_charge;
      // A payment whose charge is not expanded (or absent) cannot be verified: fail closed instead of guessing "no refund".
      if (charge === null || typeof charge === "string") {
        throw new PaymentGatewayError("UNKNOWN", "The payment has no readable charge.", false);
      }
      return {
        reference: intent.id,
        status: mapStatus(intent.status),
        amountMinorUnits: intent.amount,
        amountReceivedMinorUnits: intent.amount_received,
        amountRefundedMinorUnits: charge.amount_refunded,
        refunded: charge.refunded,
        disputed: charge.disputed,
        currency: intent.currency.toUpperCase(),
        purchaseId: typeof intent.metadata?.leadPurchaseId === "string" ? intent.metadata.leadPurchaseId : null,
      };
    } catch (error) {
      throw mapStripeError(error);
    }
  }

  async listRefunds(paymentReference: string): Promise<LeadFeeProviderRefund[]> {
    try {
      const all: LeadFeeProviderRefund[] = [];
      let startingAfter: string | undefined;
      for (let page = 0; page < MAX_REFUND_PAGES; page += 1) {
        const result = await this.stripe.refunds.list({ payment_intent: paymentReference, limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}) });
        for (const refund of result.data) all.push(toRefund(refund, paymentReference));
        if (!result.has_more) return all;
        startingAfter = result.data[result.data.length - 1]?.id;
        if (!startingAfter) break;
      }
      // More refunds than we are willing to page through: the listing is incomplete, so it cannot be trusted.
      throw new PaymentGatewayError("UNKNOWN", "The refund listing could not be read completely.", false);
    } catch (error) {
      throw mapStripeError(error);
    }
  }

  async createRefund(request: LeadFeeRefundRequest): Promise<LeadFeeProviderRefund> {
    try {
      assertMinorUnits(request.amountMinorUnits);
      const refund = await this.stripe.refunds.create(
        {
          payment_intent: request.paymentReference,
          amount: request.amountMinorUnits,
          metadata: {
            flow: "LEAD_V1",
            purpose: "lead_fee_refund",
            leadFeeRefundId: request.refundRecordId,
            leadPurchaseId: request.leadPurchaseId,
          },
        },
        { idempotencyKey: request.idempotencyKey },
      );
      return toRefund(refund, request.paymentReference);
    } catch (error) {
      throw mapStripeError(error);
    }
  }
}

const MAX_REFUND_PAGES = 10;

function toRefund(refund: Stripe.Refund, paymentReference: string): LeadFeeProviderRefund {
  const recordId = refund.metadata?.leadFeeRefundId;
  return {
    reference: refund.id,
    paymentReference,
    status: mapRefundStatus(refund.status),
    amountMinorUnits: refund.amount,
    currency: refund.currency.toUpperCase(),
    refundRecordId: typeof recordId === "string" && recordId !== "" ? recordId : null,
  };
}

/** Unknown / missing statuses are reported as UNRECOGNIZED so the executor fails closed instead of guessing. */
function mapRefundStatus(status: string | null): LeadFeeProviderRefundStatus {
  switch (status) {
    case "succeeded":
      return "SUCCEEDED";
    case "pending":
    case "requires_action":
      return "PENDING";
    case "failed":
      return "FAILED";
    case "canceled":
      return "CANCELED";
    default:
      return "UNRECOGNIZED";
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
