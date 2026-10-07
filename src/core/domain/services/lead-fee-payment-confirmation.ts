import type { LeadPurchaseRecord } from "@/domain/repositories/lead-purchase-repository";
import { LeadFeePaymentNotInitiableError, leadFeePaymentTermsFromSnapshot } from "@/domain/services/lead-fee-payment";

/**
 * Module 141 — LEAD_V1 lead-fee payment CONFIRMATION: pure domain rules.
 *
 * Decides whether an (already signature-authenticated) provider "payment succeeded" fact
 * matches the IMMUTABLE financial state of the purchase it correlates to. Nothing is
 * recomputed (no pricing, no IVA): the only reference is the persisted M135/M136 snapshot,
 * compared in exact integer minor units. Knows nothing about Stripe.
 */

/** Marker M140 writes into the PaymentIntent metadata (`metadata.flow`). */
export const LEAD_FEE_PAYMENT_FLOW_MARKER = "LEAD_V1";

/** What the provider reported about a payment, reduced to the facts confirmation needs. */
export interface LeadFeeProviderPaymentFacts {
  paymentReference: unknown;
  amountMinorUnits: unknown;
  currency: unknown;
  /** Opaque ids the provider echoes from M140's metadata (cross-check only, never identity). */
  metadataPurchaseId: string | null;
  metadataLeadId: string | null;
}

export type LeadFeeConfirmationRejection =
  | "REFERENCE_MISSING"
  | "REFERENCE_MISMATCH"
  | "PURCHASE_METADATA_MISMATCH"
  | "NOT_LEAD_V1"
  | "SNAPSHOT_INVALID"
  | "AMOUNT_MALFORMED"
  | "AMOUNT_MISMATCH"
  | "CURRENCY_MISMATCH"
  | "STATUS_NOT_CONFIRMABLE"
  | "LEAD_NOT_CONFIRMABLE";

/**
 * Validates provider facts against the purchase (reference, metadata cross-check, snapshot,
 * amount, currency). Returns the rejection reason, or `null` when everything matches.
 * Status is deliberately NOT judged here (PENDING_PAYMENT vs already CONFIRMED is the
 * use case's idempotency decision), and the Lead-flow check is done by the caller, which
 * owns the Lead lookup.
 */
export function validateLeadFeePaymentFacts(
  purchase: LeadPurchaseRecord,
  facts: LeadFeeProviderPaymentFacts,
): LeadFeeConfirmationRejection | null {
  if (typeof facts.paymentReference !== "string" || facts.paymentReference === "") return "REFERENCE_MISSING";
  // The write-once persisted reference is the authority; it must be exactly the provider's payment.
  if (purchase.paymentReference === null || purchase.paymentReference !== facts.paymentReference) return "REFERENCE_MISMATCH";

  if (facts.metadataPurchaseId !== null && facts.metadataPurchaseId !== purchase.id) return "PURCHASE_METADATA_MISMATCH";
  if (facts.metadataLeadId !== null && facts.metadataLeadId !== purchase.leadId) return "PURCHASE_METADATA_MISMATCH";

  let totalMinorUnits: number;
  let currency: string;
  try {
    const terms = leadFeePaymentTermsFromSnapshot(purchase);
    totalMinorUnits = terms.totalMinorUnits;
    currency = terms.currency;
  } catch (error) {
    if (error instanceof LeadFeePaymentNotInitiableError) return "SNAPSHOT_INVALID";
    throw error;
  }

  // Exact integer minor units only: a float / string / NaN / negative / unsafe value is malformed.
  if (typeof facts.amountMinorUnits !== "number" || !Number.isSafeInteger(facts.amountMinorUnits) || facts.amountMinorUnits <= 0) {
    return "AMOUNT_MALFORMED";
  }
  if (facts.amountMinorUnits !== totalMinorUnits) return "AMOUNT_MISMATCH";

  if (typeof facts.currency !== "string" || facts.currency.trim().toUpperCase() !== currency) return "CURRENCY_MISMATCH";

  return null;
}
