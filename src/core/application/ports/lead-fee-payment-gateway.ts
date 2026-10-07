/**
 * Module 140 — LEAD_V1 lead-fee payment port.
 *
 * The ONLY abstraction the lead-fee payment use case may use to talk to a payment
 * provider. It models "the professional pays MaestroYa a lead fee": a direct,
 * platform-account payment. It deliberately has NO capture / refund / transfer /
 * application-fee / payout operations and no connected-account notion, and it is
 * separate from the legacy customer-job `PaymentGateway`. No provider SDK type appears
 * here. Creating a payment attempt is NOT payment success: confirmation is Module 141's,
 * driven by a verified provider webhook, never by these calls' results.
 */
export type LeadFeeProviderPaymentStatus =
  | "REQUIRES_PAYMENT_METHOD"
  | "REQUIRES_ACTION"
  | "PROCESSING"
  | "SUCCEEDED"
  | "CANCELED";

export interface LeadFeePaymentRequest {
  leadPurchaseId: string;
  leadId: string;
  /** Exact integer minor units (cents) of the persisted LeadPurchase.totalAmount. */
  amountMinorUnits: number;
  /** ISO currency of the persisted snapshot (EUR). */
  currency: string;
  /** Deterministic per purchase: retried creates converge on the same provider payment. */
  idempotencyKey: string;
}

export interface LeadFeeProviderPayment {
  /** Provider's id of the payment attempt (opaque; persisted for M141 reconciliation). */
  reference: string;
  /** Client-side confirmation token the frontend needs to complete payment. Never logged or persisted. */
  clientSecret: string | null;
  status: LeadFeeProviderPaymentStatus;
  /** What the provider actually holds, so callers can verify it equals what they asked for. */
  amountMinorUnits: number;
  currency: string;
}

export interface LeadFeePaymentGateway {
  /** Creates (idempotently, per `idempotencyKey`) the lead-fee payment attempt. Throws PaymentGatewayError. */
  createPayment(request: LeadFeePaymentRequest): Promise<LeadFeeProviderPayment>;
  /** Reads an existing attempt. Throws PaymentGatewayError. */
  retrievePayment(reference: string): Promise<LeadFeeProviderPayment>;
  /** Best-effort cancel of an unpaid attempt that must not be used. Throws PaymentGatewayError. */
  cancelPayment(reference: string): Promise<void>;
}
