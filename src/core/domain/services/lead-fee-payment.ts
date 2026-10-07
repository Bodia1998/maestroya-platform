import { DomainError } from "@/domain/errors/domain-error";
import type { LeadPurchaseRecord } from "@/domain/repositories/lead-purchase-repository";
import { formatScaledDecimal, parseScaledDecimal } from "@/domain/services/fixed-point-decimal";
import { LEAD_PURCHASE_CURRENCY } from "@/domain/services/lead-purchase";

/**
 * Module 140 — LEAD_V1 lead-fee payment initiation: pure domain rules.
 *
 * The professional pays MaestroYa the lead fee + IVA. The payable amount is NEVER
 * computed here: it is the persisted, immutable M135/M136 snapshot
 * (`LeadPurchase.totalAmount`, `currency`), validated and converted — exactly — to
 * the provider's minor units with fixed-point `bigint` arithmetic (no JS float, no
 * pricing engine, no tax engine, no rate). Knows nothing about any provider SDK and
 * nothing about the customer's job payment (which MaestroYa never collects).
 */

export type LeadFeePaymentRejection =
  | "INPUT"
  | "NOT_FOUND"
  | "NOT_ELIGIBLE"
  | "LEGACY"
  | "STATUS"
  | "SNAPSHOT_INVALID"
  | "PROVIDER_CANCELED"
  | "PROVIDER_MISMATCH";

/**
 * Every "you may not pay this" outcome carries the SAME generic message (no existence /
 * ownership / state probing); `reason` is for logs and tests only.
 */
export class LeadFeePaymentNotInitiableError extends DomainError {
  readonly code = "LEAD_FEE_PAYMENT_NOT_INITIABLE";

  constructor(readonly reason: LeadFeePaymentRejection) {
    super("This lead purchase cannot be paid.");
  }
}

/** Provider failure (or an unusable provider answer). Safe message: no provider detail, no secrets. */
export class LeadFeePaymentUnavailableError extends DomainError {
  readonly code = "LEAD_FEE_PAYMENT_UNAVAILABLE";

  constructor(readonly reason: LeadFeePaymentRejection | "PROVIDER_ERROR" = "PROVIDER_ERROR") {
    super("Payment could not be started. Please try again later.");
  }
}

export interface LeadFeePaymentTerms {
  /** Exact total from the snapshot, 2 decimals (for the response). */
  totalAmount: string;
  /** The same total as an exact integer number of cents — what the provider receives. */
  totalMinorUnits: number;
  currency: string;
}

/** Deterministic provider idempotency key: one logical purchase -> one logical payment. */
export function leadFeePaymentIdempotencyKey(purchaseId: string): string {
  return `lead-fee-payment-intent:${purchaseId}`;
}

/**
 * The payment terms of a purchase, read ONLY from its persisted financial snapshot.
 * Throws LeadFeePaymentNotInitiableError for: any status other than PENDING_PAYMENT;
 * a legacy purchase (no M135/M136 snapshot — nothing is invented for it); a snapshot
 * that is malformed or inconsistent (currency not EUR, unparsable money, non-positive
 * total, total != fee + tax). Malformed data is rejected, never repaired.
 */
export function leadFeePaymentTermsFromPurchase(purchase: LeadPurchaseRecord): LeadFeePaymentTerms {
  if (purchase.status !== "PENDING_PAYMENT") throw new LeadFeePaymentNotInitiableError("STATUS");
  return leadFeePaymentTermsFromSnapshot(purchase);
}

/**
 * Module 141 — the same snapshot validation WITHOUT the status rule, so the payment-confirmation
 * webhook can verify the immutable terms of an already-CONFIRMED purchase (idempotent redelivery)
 * exactly as M140 verified them at initiation. Pure, no pricing/tax recalculation.
 */
export function leadFeePaymentTermsFromSnapshot(purchase: LeadPurchaseRecord): LeadFeePaymentTerms {
  const snapshot = purchase.financialSnapshot;
  if (
    snapshot.totalAmount === null ||
    snapshot.taxAmount === null ||
    snapshot.taxPolicyVersion === null ||
    snapshot.leadPublishedAt === null
  ) {
    throw new LeadFeePaymentNotInitiableError("LEGACY");
  }

  if (snapshot.currency !== LEAD_PURCHASE_CURRENCY || purchase.currency !== snapshot.currency) {
    throw new LeadFeePaymentNotInitiableError("SNAPSHOT_INVALID");
  }

  const fee = parseScaledDecimal(snapshot.feeAmount, 2);
  const tax = parseScaledDecimal(snapshot.taxAmount, 2);
  const total = parseScaledDecimal(snapshot.totalAmount, 2);
  if (fee === null || tax === null || total === null || fee <= 0n || total <= 0n || total !== fee + tax) {
    throw new LeadFeePaymentNotInitiableError("SNAPSHOT_INVALID");
  }

  const totalMinorUnits = Number(total);
  if (!Number.isSafeInteger(totalMinorUnits)) throw new LeadFeePaymentNotInitiableError("SNAPSHOT_INVALID");

  return { totalAmount: formatScaledDecimal(total, 2, 2), totalMinorUnits, currency: snapshot.currency };
}
