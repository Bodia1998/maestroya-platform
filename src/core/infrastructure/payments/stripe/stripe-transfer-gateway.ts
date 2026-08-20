import "server-only";

import Stripe from "stripe";

import { StripeTransferError, type StripeTransferErrorCategory } from "@/domain/errors/domain-error";
import type {
  CreateTransferRequest,
  CreateTransferResult,
  ReverseTransferRequest,
  ReverseTransferResult,
  StripeTransferGateway,
} from "@/application/ports/stripe-transfer-gateway";
import { toStripeMinorUnits } from "@/infrastructure/payments/stripe/stripe-payment-gateway";

/**
 * Module 76 — Professional Payout Execution.
 *
 * `StripeTransferGateway` implementation backed by
 * `stripe.transfers.create` — the only file in this module that imports
 * the Stripe SDK or knows about `Stripe.Transfer`'s shape, mirroring
 * `StripeConnectGatewayAdapter`/`StripePaymentGatewayAdapter`'s own "only
 * file that imports the Stripe SDK" convention.
 *
 * ## Separate charges and transfers
 * This is the second half of the "separate charges and transfers" model
 * `StripeConnectGatewayAdapter`'s own doc comment describes and
 * `StripePaymentGatewayAdapter`'s own doc comment explicitly defers to
 * this module: the customer's card was already charged directly to the
 * platform's Stripe account (Module 73, no `on_behalf_of`/`transfer_data`
 * involved). This class is what actually moves the professional's share
 * of that already-captured balance to their own connected account, via a
 * plain `destination` transfer — never a destination charge, never a
 * second charge against the customer.
 *
 * ## Amount conversion
 * Reuses `toStripeMinorUnits` (`stripe-payment-gateway.ts`) unchanged —
 * the exact same EUR-only, `Math.round`-based, non-finite/negative-guarded
 * conversion `StripePaymentGatewayAdapter.authorize` already uses for the
 * inbound charge, so a captured payment amount and its outbound transfer
 * amount can never be converted to minor units by two different
 * (potentially diverging) implementations.
 *
 * ## Never logs sensitive data
 * Only opaque ids (`Transfer.id`, the destination `acct_...` id) ever
 * leave this class — no raw Stripe payload is ever logged here.
 */
export class StripeTransferGatewayAdapter implements StripeTransferGateway {
  constructor(private readonly stripe: Stripe) {}

  async createTransfer(request: CreateTransferRequest): Promise<CreateTransferResult> {
    try {
      const amountMinorUnits = toStripeMinorUnits(request.amount, request.currency);

      const transfer = await this.stripe.transfers.create(
        {
          amount: amountMinorUnits,
          currency: request.currency.toLowerCase(),
          destination: request.destinationStripeAccountId,
          metadata: {
            payoutId: request.metadata.payoutId,
            jobId: request.metadata.jobId,
          },
        },
        { idempotencyKey: request.idempotencyKey },
      );

      return { stripeTransferId: transfer.id };
    } catch (error) {
      throw mapStripeError(error);
    }
  }

  /**
   * Module 77 — Refund & Dispute Financial Execution: reverses a
   * previously created Transfer via `stripe.transfers.createReversal` —
   * the one new method this module adds to this class, reusing the exact
   * same shared `stripe` client and `mapStripeError`/`toStripeMinorUnits`
   * helpers `createTransfer` above already uses. No second Stripe
   * transfer/reversal implementation exists anywhere in this codebase.
   */
  async reverseTransfer(request: ReverseTransferRequest): Promise<ReverseTransferResult> {
    try {
      const amountMinorUnits = toStripeMinorUnits(request.amount, request.currency);

      const reversal = await this.stripe.transfers.createReversal(
        request.stripeTransferId,
        {
          amount: amountMinorUnits,
          metadata: { payoutId: request.metadata.payoutId },
        },
        { idempotencyKey: request.idempotencyKey },
      );

      return { stripeReversalId: reversal.id };
    } catch (error) {
      throw mapStripeError(error);
    }
  }
}

/**
 * Maps any error a Stripe SDK call can throw onto a `StripeTransferError`
 * category — the one place in this module that ever inspects a Stripe SDK
 * error type. Mirrors `stripe-connect-gateway.ts`/`stripe-payment-
 * gateway.ts`'s own `mapStripeError` exactly, with the two additions
 * (`INSUFFICIENT_BALANCE`, `INVALID_DESTINATION`) a Transfer specifically
 * needs — see `StripeTransferErrorCategory`'s own doc comment.
 */
function mapStripeError(error: unknown): StripeTransferError {
  if (error instanceof Stripe.errors.StripeError) {
    const message = error.message || "Stripe transfer request failed.";
    const category = classifyStripeError(error);
    const retryable = category === "RATE_LIMITED" || category === "NETWORK" || category === "TEMPORARY";
    return new StripeTransferError(category, message, retryable, { cause: error });
  }
  return new StripeTransferError(
    "UNKNOWN",
    error instanceof Error ? error.message : "Unknown Stripe transfer error.",
    false,
    { cause: error },
  );
}

function classifyStripeError(error: Stripe.errors.StripeError): StripeTransferErrorCategory {
  // Stripe's own code for "the platform's available balance cannot cover
  // this transfer" — https://docs.stripe.com/error-codes#balance-insufficient.
  // Always a `StripeInvalidRequestError` at the HTTP layer, so this check
  // must run before the generic `StripeInvalidRequestError` branch below.
  if (error.code === "balance_insufficient") return "INSUFFICIENT_BALANCE";

  if (error instanceof Stripe.errors.StripeAuthenticationError) return "AUTHENTICATION";
  if (error instanceof Stripe.errors.StripePermissionError) return "ACCOUNT_RESTRICTED";
  if (error instanceof Stripe.errors.StripeRateLimitError) return "RATE_LIMITED";
  if (error instanceof Stripe.errors.StripeConnectionError) return "NETWORK";
  if (error instanceof Stripe.errors.StripeAPIError) return "TEMPORARY";
  if (error instanceof Stripe.errors.StripeInvalidRequestError) {
    // A `destination` that doesn't exist, was deauthorized, or otherwise
    // cannot currently receive transfers surfaces as `resource_missing`
    // (unknown account) or a parameter-invalid error naming `destination`
    // — both mean "this transfer's destination is not usable right now,"
    // distinct from a generic malformed request.
    if (error.code === "resource_missing" || error.param === "destination") {
      return "INVALID_DESTINATION";
    }
    return "INVALID_REQUEST";
  }
  return "UNKNOWN";
}
