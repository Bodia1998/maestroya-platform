import type { LeadFeeProviderDisputeState } from "@/domain/services/lead-fee-dispute";

/**
 * Module 155 — the ONLY abstraction the dispute-evidence use case may use to talk to the payment provider about a dispute.
 *
 * Deliberately separate from `LeadFeePaymentGateway` (Module 140/153), which stays unchanged: this port can read one dispute and
 * submit basic TEXT evidence for it. It has no accept/close-dispute, refund, transfer or payout operation, and no provider SDK
 * type appears here. Evidence submission is final at the provider (a dispute accepts one submission), so the caller guards it
 * with an explicit switch, a persisted claim and a deterministic idempotency key.
 */
export interface LeadFeeDisputeEvidenceRequest {
  providerDisputeId: string;
  /** Plain text evidence (1..1000 characters, free of obvious personal data by the caller). */
  evidenceText: string;
  /** Our dispute-record id, written into the provider's metadata for reconciliation (opaque, no personal data). */
  leadFeeDisputeId: string;
  /** Deterministic per dispute. */
  idempotencyKey: string;
}

export interface LeadFeeDisputeGateway {
  /** Reads one dispute as the provider holds it. Throws PaymentGatewayError. */
  retrieveDispute(providerDisputeId: string): Promise<LeadFeeProviderDisputeState>;
  /** Submits the evidence AND submits it for review (final). Throws PaymentGatewayError; a thrown error is NOT proof that nothing was submitted. */
  submitEvidence(request: LeadFeeDisputeEvidenceRequest): Promise<void>;
}
