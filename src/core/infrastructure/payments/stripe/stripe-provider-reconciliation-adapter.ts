import "server-only";

import type Stripe from "stripe";

import type { ProviderFinancialReconciliationPort } from "@/application/ports/provider-financial-reconciliation";
import type { ProviderState } from "@/domain/services/reconciliation/provider-checks";
import { logger } from "@/infrastructure/observability/logger";

/**
 * Module 80 — Financial Reconciliation & Observability.
 *
 * `ProviderFinancialReconciliationPort` implementation backed by the
 * Stripe SDK — the only file in this module that imports `Stripe` or
 * knows about `PaymentIntent`/`Transfer`/`Refund` shapes, mirroring every
 * other `Stripe*Adapter` in this codebase's "only file that imports the
 * Stripe SDK" convention. No Stripe SDK type or raw response payload ever
 * leaves this class — only the normalized, minimal `ProviderState` shape
 * (found/settled/amount/currency), and only opaque ids and rounded
 * amounts are ever logged (never a full payload — see the spec's
 * explicit "never log full payment-provider payloads" rule).
 *
 * Read-only: every method here is a `.retrieve()` call. Nothing in this
 * class ever creates, captures, refunds, or reverses anything at Stripe —
 * this module is an auditor, never an executor.
 *
 * A retrieval failure (network error, the id genuinely not found, an
 * expired/rotated API key) returns `null` — "could not be verified this
 * run" — rather than throwing, so a single unreachable provider call
 * never aborts the whole reconciliation run; the caller
 * (`StartReconciliationRunUseCase`) surfaces this as its own
 * `PROVIDER_STATE_UNKNOWN` finding, never a silent false "matches."
 */
export class StripeProviderReconciliationAdapter implements ProviderFinancialReconciliationPort {
  constructor(private readonly stripe: Stripe) {}

  async retrievePaymentState(stripePaymentIntentId: string): Promise<ProviderState | null> {
    try {
      const intent = await this.stripe.paymentIntents.retrieve(stripePaymentIntentId);
      return {
        found: true,
        settled: intent.status === "succeeded",
        amount: intent.amount / 100,
        currency: intent.currency.toUpperCase(),
      };
    } catch (error) {
      this.logRetrievalFailure("payment_intent", stripePaymentIntentId, error);
      return null;
    }
  }

  async retrieveTransferState(stripeTransferId: string): Promise<ProviderState | null> {
    try {
      const transfer = await this.stripe.transfers.retrieve(stripeTransferId);
      const reversed = Boolean((transfer as { reversed?: boolean }).reversed);
      return {
        found: true,
        // A Transfer object has no explicit "status" field in the Stripe
        // API — existence of the object with a non-negative amount is
        // itself the settlement signal; `reversed` distinguishes a
        // clawed-back transfer.
        settled: !reversed,
        amount: transfer.amount / 100,
        currency: transfer.currency.toUpperCase(),
      };
    } catch (error) {
      this.logRetrievalFailure("transfer", stripeTransferId, error);
      return null;
    }
  }

  async retrieveRefundState(stripeRefundId: string): Promise<ProviderState | null> {
    try {
      const refund = await this.stripe.refunds.retrieve(stripeRefundId);
      return {
        found: true,
        settled: refund.status === "succeeded",
        amount: refund.amount / 100,
        currency: refund.currency.toUpperCase(),
      };
    } catch (error) {
      this.logRetrievalFailure("refund", stripeRefundId, error);
      return null;
    }
  }

  private logRetrievalFailure(kind: string, id: string, error: unknown): void {
    logger.warn("reconciliation.provider_retrieval_failed", {
      kind,
      id,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
