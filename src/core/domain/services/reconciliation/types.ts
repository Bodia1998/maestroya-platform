import type {
  DiscrepancyCategoryValue,
  DiscrepancyEntityTypeValue,
  DiscrepancySeverityValue,
} from "@/domain/repositories/reconciliation-repository";

import { roundToCents } from "@/domain/services/money";

/**
 * Module 80 — Financial Reconciliation & Observability.
 *
 * The shape every pure check function in `domain/services/reconciliation/*`
 * produces. A `DiscrepancyCandidate` is NOT yet persisted — it carries no
 * run id, id, fingerprint, or resolution state; the application-layer use
 * case (`StartReconciliationRunUseCase`) is what stamps a candidate with a
 * fingerprint (`fingerprint.ts`) and hands it to the repository's
 * `createOrTouch`. Keeping checks pure (no I/O, no fingerprinting, no
 * severity literals hardcoded ad hoc) is what makes every check
 * independently unit-testable with plain in-memory fixtures.
 */
export interface DiscrepancyCandidate {
  entityType: DiscrepancyEntityTypeValue;
  entityId: string | null;
  jobId: string | null;
  paymentId: string | null;
  invoiceId: string | null;
  payoutId: string | null;
  refundId: string | null;
  creditNoteId: string | null;
  category: DiscrepancyCategoryValue;
  expectedValue: number | null;
  actualValue: number | null;
  currency: string | null;
  explanation: string;
}

/** `differenceValue` is always derived (`actual - expected`, rounded to
 *  cents) — never independently supplied by a check, so it can never
 *  drift from the two numbers it's computed from. */
export function withDifference(candidate: DiscrepancyCandidate): DiscrepancyCandidate & { differenceValue: number | null } {
  const differenceValue =
    candidate.expectedValue !== null && candidate.actualValue !== null
      ? roundToCents(candidate.actualValue - candidate.expectedValue)
      : null;
  return { ...candidate, differenceValue };
}

export function amountsRoughlyEqual(a: number, b: number, toleranceCents = 0.01): boolean {
  return Math.abs(a - b) < toleranceCents;
}

export type { DiscrepancyCategoryValue, DiscrepancyEntityTypeValue, DiscrepancySeverityValue };
