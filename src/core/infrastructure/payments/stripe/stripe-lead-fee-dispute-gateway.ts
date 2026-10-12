import "server-only";

import Stripe from "stripe";

import { PaymentGatewayError, type PaymentGatewayErrorCategory } from "@/domain/errors/domain-error";
import type { LeadFeeDisputeEvidenceRequest, LeadFeeDisputeGateway } from "@/application/ports/lead-fee-dispute-gateway";
import type { LeadFeeProviderDisputeState } from "@/domain/services/lead-fee-dispute";

/**
 * Module 155 — `LeadFeeDisputeGateway` backed by the Stripe Disputes API. The only file of this module that imports the Stripe SDK.
 *
 * It uses exactly two calls: `disputes.retrieve` (read) and `disputes.update` with TEXT evidence (`uncategorized_text`) and
 * `submit: true`. It never accepts or closes a dispute, never refunds, and never attaches a file or any customer / contact data;
 * the metadata carries only our opaque dispute-record id. Not verified against a Stripe test-mode rehearsal (see the module doc).
 */
export class StripeLeadFeeDisputeGatewayAdapter implements LeadFeeDisputeGateway {
  constructor(private readonly stripe: Stripe) {}

  async retrieveDispute(providerDisputeId: string): Promise<LeadFeeProviderDisputeState> {
    try {
      const dispute = await this.stripe.disputes.retrieve(providerDisputeId);
      return {
        providerDisputeId: dispute.id,
        paymentReference: typeof dispute.payment_intent === "string" ? dispute.payment_intent : (dispute.payment_intent?.id ?? null),
        rawStatus: dispute.status,
        amountMinorUnits: dispute.amount,
        currency: dispute.currency.toUpperCase(),
        evidenceDueBy: dispute.evidence_details?.due_by ? new Date(dispute.evidence_details.due_by * 1000) : null,
        pastDue: dispute.evidence_details?.past_due === true,
        evidenceSubmissionCount: dispute.evidence_details?.submission_count ?? 0,
      };
    } catch (error) {
      throw mapStripeError(error);
    }
  }

  async submitEvidence(request: LeadFeeDisputeEvidenceRequest): Promise<void> {
    try {
      await this.stripe.disputes.update(
        request.providerDisputeId,
        {
          evidence: { uncategorized_text: request.evidenceText },
          submit: true,
          metadata: { flow: "LEAD_V1", purpose: "lead_fee_dispute_evidence", leadFeeDisputeId: request.leadFeeDisputeId },
        },
        { idempotencyKey: request.idempotencyKey },
      );
    } catch (error) {
      throw mapStripeError(error);
    }
  }
}

function mapStripeError(error: unknown): PaymentGatewayError {
  if (error instanceof PaymentGatewayError) return error;
  if (error instanceof Stripe.errors.StripeError) {
    const category = classify(error);
    const retryable = category === "RATE_LIMITED" || category === "NETWORK" || category === "TEMPORARY";
    return new PaymentGatewayError(category, error.message || "Stripe lead-fee dispute request failed.", retryable, { cause: error });
  }
  return new PaymentGatewayError("UNKNOWN", error instanceof Error ? error.message : "Unknown payment gateway error.", false, { cause: error });
}

function classify(error: Stripe.errors.StripeError): PaymentGatewayErrorCategory {
  if (error instanceof Stripe.errors.StripeAuthenticationError) return "AUTHENTICATION";
  if (error instanceof Stripe.errors.StripeRateLimitError) return "RATE_LIMITED";
  if (error instanceof Stripe.errors.StripeConnectionError) return "NETWORK";
  if (error instanceof Stripe.errors.StripeAPIError) return "TEMPORARY";
  if (error instanceof Stripe.errors.StripeInvalidRequestError) return error.code === "resource_missing" ? "NOT_FOUND" : "INVALID_REQUEST";
  return "UNKNOWN";
}
