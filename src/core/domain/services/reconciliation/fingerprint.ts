import { createHash } from "node:crypto";

import type { DiscrepancyCandidate } from "@/domain/services/reconciliation/types";

/**
 * Module 80 — Financial Reconciliation & Observability.
 *
 * Deterministic identity of "this exact financial condition" — the same
 * category, on the same entities, is always the same fingerprint,
 * regardless of which run detected it or when. This is what lets
 * `ReconciliationDiscrepancyRepository.createOrTouch` recognize "this is
 * the same still-open problem as last run" rather than inserting a new
 * row every single run (see that repository's own idempotency doc
 * comment).
 *
 * Deliberately excludes `expectedValue`/`actualValue`/`explanation`: two
 * runs of the same broken condition can compute slightly different
 * "expected" figures if, say, a live commission-rate PlatformSetting
 * changed between runs, but it is still the *same* underlying
 * discrepancy (the same invoice, the same category) and must still
 * dedupe to the same open row — the row's `actualValue`/`expectedValue`
 * simply reflect whichever run last touched it via `lastSeenRunId`.
 */
export function computeDiscrepancyFingerprint(candidate: DiscrepancyCandidate): string {
  const parts = [
    candidate.category,
    candidate.entityType,
    candidate.entityId ?? "",
    candidate.jobId ?? "",
    candidate.paymentId ?? "",
    candidate.invoiceId ?? "",
    candidate.payoutId ?? "",
    candidate.refundId ?? "",
    candidate.creditNoteId ?? "",
  ];
  return createHash("sha256").update(parts.join("|")).digest("hex");
}
