import { amountsRoughlyEqual, type DiscrepancyCandidate } from "@/domain/services/reconciliation/types";

/**
 * Module 80 — Financial Reconciliation & Observability.
 *
 * Provider (Stripe) reconciliation — distinguishes local financial state
 * from provider financial state, per the module brief's explicit warning
 * that a local PAID/PAYOUT_EXECUTED status is never itself proof Stripe
 * agrees. This module never assumes a provider record exists just because
 * a local one does — `providerState.found === false` is its own reported
 * condition (`PROVIDER_STATE_UNKNOWN`), distinct from a genuine
 * local/provider mismatch.
 *
 * Deliberately provider-agnostic in shape (no Stripe SDK type appears
 * here) — see `application/ports/provider-financial-reconciliation.ts` for
 * the port this data comes from and `infrastructure/payments/stripe/`
 * for the one adapter allowed to know about Stripe.
 */
export interface LocalProviderReference {
  entityType: "PAYMENT" | "PAYOUT" | "REFUND";
  entityId: string;
  jobId: string | null;
  externalReference: string;
  localAmount: number;
  localCurrency: string;
  /** Whether the local record considers this settled (Payment CAPTURED,
   *  Payout PAID, Refund PROCESSED). */
  localSettled: boolean;
}

export interface ProviderState {
  found: boolean;
  settled: boolean;
  amount: number | null;
  currency: string | null;
}

export function checkProviderConsistency(
  local: LocalProviderReference,
  provider: ProviderState | null,
): DiscrepancyCandidate[] {
  const findings: DiscrepancyCandidate[] = [];
  const base = {
    entityType: local.entityType === "PAYMENT" ? ("PAYMENT" as const) : local.entityType === "PAYOUT" ? ("PAYOUT" as const) : ("REFUND" as const),
    entityId: local.entityId,
    jobId: local.jobId,
    paymentId: local.entityType === "PAYMENT" ? local.entityId : null,
    invoiceId: null,
    payoutId: local.entityType === "PAYOUT" ? local.entityId : null,
    refundId: local.entityType === "REFUND" ? local.entityId : null,
    creditNoteId: null,
  };

  if (!provider || provider === null) {
    findings.push({
      ...base,
      category: "PROVIDER_STATE_UNKNOWN",
      expectedValue: null,
      actualValue: null,
      currency: local.localCurrency,
      explanation: `Local ${local.entityType} ${local.entityId} references provider reference ${local.externalReference}, but the provider's own state could not be retrieved this run (network/credentials/adapter limitation) — this is NOT proof of a mismatch, only that it could not be verified.`,
    });
    return findings;
  }

  if (!provider.found) {
    findings.push({
      ...base,
      category: "PROVIDER_LOCAL_STATE_MISMATCH",
      expectedValue: null,
      actualValue: null,
      currency: local.localCurrency,
      explanation: `Local ${local.entityType} ${local.entityId} references provider reference ${local.externalReference}, but Stripe reports no such object exists.`,
    });
    return findings;
  }

  if (local.localSettled && !provider.settled) {
    findings.push({
      ...base,
      category: "PROVIDER_LOCAL_STATE_MISMATCH",
      expectedValue: null,
      actualValue: null,
      currency: local.localCurrency,
      explanation: `Local ${local.entityType} ${local.entityId} is recorded as settled, but Stripe's own state for ${local.externalReference} is not settled — a local "PAID"/"CAPTURED"/"PROCESSED" status is never itself proof of the provider's state.`,
    });
  }

  if (provider.amount !== null && !amountsRoughlyEqual(provider.amount, local.localAmount)) {
    findings.push({
      ...base,
      category: "PROVIDER_AMOUNT_MISMATCH",
      expectedValue: local.localAmount,
      actualValue: provider.amount,
      currency: provider.currency ?? local.localCurrency,
      explanation: `Local ${local.entityType} ${local.entityId} amount (${local.localAmount} ${local.localCurrency}) does not match Stripe's own amount for ${local.externalReference} (${provider.amount} ${provider.currency ?? "?"}).`,
    });
  }

  if (provider.currency && provider.currency !== local.localCurrency) {
    findings.push({
      ...base,
      category: "PROVIDER_AMOUNT_MISMATCH",
      expectedValue: null,
      actualValue: null,
      currency: provider.currency,
      explanation: `Local ${local.entityType} ${local.entityId} currency (${local.localCurrency}) does not match Stripe's own currency for ${local.externalReference} (${provider.currency}).`,
    });
  }

  return findings;
}
