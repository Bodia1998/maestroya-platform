import type {
  DiscrepancyCandidate,
  DiscrepancySeverityValue,
} from "@/domain/services/reconciliation/types";

/**
 * Module 80 — Financial Reconciliation & Observability.
 *
 * The single, deterministic rule for "how bad is this discrepancy" — a
 * pure function of `category` (and, for a handful of amount-bearing
 * categories, the magnitude of `differenceValue`), never an ad hoc
 * literal chosen per call site. Every check module returns
 * `DiscrepancyCandidate`s with no severity attached; this is the one
 * place severity is decided, so the mapping can never diverge between
 * checks and can be tested exhaustively on its own.
 *
 * ## The rules (see the module brief's own worked examples)
 * - Non-financial metadata anomalies (numbering gaps, missing document
 *   hash, provider state simply unknown/not yet queryable) -> WARNING.
 * - A financial figure not matching its authoritative recomputation
 *   (commission, tax, invoice, refund/credit-note amount) -> ERROR.
 * - Anything that means money already moved (or could move) beyond what
 *   is owed — a payout exceeding the payable amount, a refund exceeding
 *   the refundable amount, a duplicate payout/refund/payment, a
 *   provider/local amount mismatch — -> CRITICAL.
 * - A missing required relationship (payment with no job, invoice
 *   referencing an invalid job) -> ERROR, escalated to CRITICAL only
 *   when it co-occurs with money having already moved (the specific
 *   category already encodes this — see e.g.
 *   `PAYMENT_SUCCESSFUL_WITHOUT_RELATIONSHIP`).
 */
const CRITICAL_CATEGORIES = new Set([
  "PAYOUT_EXCEEDS_PAYABLE_AMOUNT",
  "DUPLICATE_PAYOUT",
  "DUPLICATE_PAYMENT",
  "DUPLICATE_REFUND",
  "REFUND_EXCEEDS_REFUNDABLE_AMOUNT",
  "PAYMENT_SUCCESSFUL_WITHOUT_RELATIONSHIP",
  "PROVIDER_AMOUNT_MISMATCH",
  "PROVIDER_LOCAL_STATE_MISMATCH",
  "CREDIT_NOTE_EXCEEDS_REMAINING_CREDITABLE_AMOUNT",
  "DUPLICATE_CREDIT_NOTE",
]);

const WARNING_CATEGORIES = new Set([
  "INVOICE_NUMBERING_ANOMALY",
  "CREDIT_NOTE_NUMBERING_ANOMALY",
  "INVOICE_MISSING_IMMUTABLE_METADATA",
  "PROVIDER_STATE_UNKNOWN",
]);

const INFO_CATEGORIES = new Set<string>([]);

/** Amount-bearing categories where a very small (sub-cent-rounding-noise)
 *  difference is downgraded one level rather than treated with the same
 *  severity as a large mismatch — see the module brief's "small
 *  non-financial metadata mismatch -> WARNING" example, extended here to
 *  "financially negligible" amount mismatches (< 0.05 currency units,
 *  i.e. never more than a few cents of rounding drift). A difference at
 *  or above that floor is never downgraded — this only ever softens
 *  ERROR to WARNING, never CRITICAL to anything less. */
const NEGLIGIBLE_DIFFERENCE_THRESHOLD = 0.05;

export function determineDiscrepancySeverity(
  candidate: Pick<DiscrepancyCandidate, "category" | "expectedValue" | "actualValue">,
): DiscrepancySeverityValue {
  if (CRITICAL_CATEGORIES.has(candidate.category)) return "CRITICAL";
  if (INFO_CATEGORIES.has(candidate.category)) return "INFO";
  if (WARNING_CATEGORIES.has(candidate.category)) return "WARNING";

  // Default: every remaining category is a financial-figure mismatch
  // against an authoritative recomputation -> ERROR, unless the
  // magnitude is negligible.
  if (candidate.expectedValue !== null && candidate.actualValue !== null) {
    const diff = Math.abs(candidate.actualValue - candidate.expectedValue);
    if (diff > 0 && diff < NEGLIGIBLE_DIFFERENCE_THRESHOLD) return "WARNING";
  }
  return "ERROR";
}
