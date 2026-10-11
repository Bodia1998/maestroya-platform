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
 *
 * Module 153 extends it additively with the MINIMUM refund capabilities (full refund of one
 * payment, read of a payment's refund-relevant facts, listing a payment's refunds). It still has
 * no capture / transfer / application-fee / payout operation and no connected-account notion.
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

/** Module 153 — provider-side state of one refund, reduced to what the executor needs. */
export type LeadFeeProviderRefundStatus = "SUCCEEDED" | "PENDING" | "FAILED" | "CANCELED" | "UNRECOGNIZED";

export interface LeadFeeRefundRequest {
  /** Our refund-record id: written into the provider refund's metadata so an unknown outcome can be reconciled by listing. */
  refundRecordId: string;
  leadPurchaseId: string;
  /** The provider payment to refund in full. */
  paymentReference: string;
  /** Exact integer minor units (cents): the whole charged amount. */
  amountMinorUnits: number;
  currency: string;
  /** Deterministic per (payment, attempt). Never replayed while an attempt is unresolved. */
  idempotencyKey: string;
}

export interface LeadFeeProviderRefund {
  /** Provider's id of the refund. */
  reference: string;
  paymentReference: string;
  status: LeadFeeProviderRefundStatus;
  amountMinorUnits: number;
  currency: string;
  /** Our refund-record id as found in the provider refund's metadata; null when absent (e.g. a refund made outside this system). */
  refundRecordId: string | null;
}

/** Module 153 — the refund-relevant facts of a payment, as the provider reports them. */
export interface LeadFeeProviderPaymentFacts {
  reference: string;
  status: LeadFeeProviderPaymentStatus;
  amountMinorUnits: number;
  /** Amount actually received (charged). */
  amountReceivedMinorUnits: number;
  /** Sum already refunded on the charge, in minor units. */
  amountRefundedMinorUnits: number;
  refunded: boolean;
  disputed: boolean;
  currency: string;
  /** The purchase id recorded in the payment's metadata at creation; null when absent. */
  purchaseId: string | null;
}

export interface LeadFeePaymentGateway {
  /** Creates (idempotently, per `idempotencyKey`) the lead-fee payment attempt. Throws PaymentGatewayError. */
  createPayment(request: LeadFeePaymentRequest): Promise<LeadFeeProviderPayment>;
  /** Reads an existing attempt. Throws PaymentGatewayError. */
  retrievePayment(reference: string): Promise<LeadFeeProviderPayment>;
  /** Best-effort cancel of an unpaid attempt that must not be used. Throws PaymentGatewayError. */
  cancelPayment(reference: string): Promise<void>;
  /** Module 153: refund-relevant facts of a payment (charge amount / refunded / disputed). Throws PaymentGatewayError. */
  retrievePaymentFacts(reference: string): Promise<LeadFeeProviderPaymentFacts>;
  /** Module 153: ALL refunds the provider holds for a payment (any origin). Throws PaymentGatewayError if it cannot be established completely. */
  listRefunds(paymentReference: string): Promise<LeadFeeProviderRefund[]>;
  /** Module 153: requests a FULL refund (once per idempotency key). Throws PaymentGatewayError; a thrown error is NOT proof that no refund exists. */
  createRefund(request: LeadFeeRefundRequest): Promise<LeadFeeProviderRefund>;
}
