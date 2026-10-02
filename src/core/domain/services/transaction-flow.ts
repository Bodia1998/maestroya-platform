import { DomainError } from "@/domain/errors/domain-error";

/**
 * Module 121 — Legacy Freeze & Flow Version Boundary.
 *
 * Which financial architecture a ServiceRequest belongs to. Persisted as
 * `ServiceRequest.flowVersion` (see prisma/schema.prisma) and defaulted to
 * LEGACY_QUOTE_PAYMENT, so every request that predates this module is
 * legacy by construction.
 *
 *  - LEGACY_QUOTE_PAYMENT: Quote -> customer Payment -> Commission ->
 *    PaymentRelease -> Payout (+ self-billing/invoice). Behavior unchanged.
 *  - LEAD_V1: lead marketplace. The professional pays MaestroYa a lead fee;
 *    the customer pays the professional directly. MaestroYa never receives
 *    or releases the customer's service payment, so NONE of the legacy
 *    financial use cases may run for it.
 *
 * `Commission` (legacy platform cut of a customer payment) is deliberately
 * NOT the future Lead Fee — different concept, do not reuse or rename it.
 */
export const TRANSACTION_FLOW_VERSIONS = ["LEGACY_QUOTE_PAYMENT", "LEAD_V1"] as const;
export type TransactionFlowVersion = (typeof TRANSACTION_FLOW_VERSIONS)[number];

export const DEFAULT_TRANSACTION_FLOW_VERSION: TransactionFlowVersion = "LEGACY_QUOTE_PAYMENT";

export function isLegacyQuotePaymentFlow(flow: TransactionFlowVersion): boolean {
  return flow === "LEGACY_QUOTE_PAYMENT";
}

/** Names of the legacy-only operations guarded by Module 121. Used as a
 *  structured log/diagnostic field, never shown to end users. */
export type LegacyFinancialOperation =
  | "quote.create"
  | "quote.accept"
  | "customer_payment.initiate"
  | "customer_payment.capture"
  | "commission.record"
  | "payment_release.evaluate"
  | "payment_release.admin_resolve"
  | "professional_payout.execute"
  | "invoice.professional_draft"
  | "invoice.customer_receipt_draft"
  | "affiliate.conversion_on_release";

/** Thrown when a non-legacy (LEAD_V1) request reaches a legacy-only
 *  financial operation. A distinct type (not ValidationError) so callers
 *  can never mistake it for a "not ready yet, retry later" condition. */
export class LegacyFlowBoundaryError extends DomainError {
  readonly code = "LEGACY_FLOW_BOUNDARY";

  constructor(
    readonly operation: LegacyFinancialOperation,
    readonly flowVersion: TransactionFlowVersion,
  ) {
    super(`Operation "${operation}" belongs to the legacy quote-payment flow and is not allowed for flow "${flowVersion}".`);
  }
}
