import { randomUUID } from "node:crypto";

import type { ReconciliationDiscrepancyRecord, ReconciliationRunRecord } from "@/domain/repositories/reconciliation-repository";

/**
 * Module 81 — Reconciliation Admin Dashboard & Operations: small record
 * builders for this module's own use-case tests (the admin overview/runs
 * list/discrepancies table use cases) — Module 80's own
 * `tests/unit/core/domain/reconciliation/fixtures.ts` builds
 * `JobFinancialContext`/check-input fixtures, not persisted
 * run/discrepancy *records*, so this is a new, narrowly-scoped file
 * rather than an addition to that one.
 */
export function makeRunRecord(overrides: Partial<ReconciliationRunRecord> = {}): ReconciliationRunRecord {
  return {
    id: randomUUID(),
    scope: "FULL",
    status: "COMPLETED",
    startedAt: new Date("2026-08-01T00:00:00.000Z"),
    completedAt: new Date("2026-08-01T00:01:00.000Z"),
    durationMs: 60000,
    recordsInspected: 10,
    discrepancyCount: 0,
    errorMessage: null,
    parametersHash: "abc123",
    triggeredByUserId: null,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    ...overrides,
  };
}

export function makeDiscrepancyRecord(overrides: Partial<ReconciliationDiscrepancyRecord> = {}): ReconciliationDiscrepancyRecord {
  return {
    id: randomUUID(),
    detectedByRunId: randomUUID(),
    lastSeenRunId: randomUUID(),
    entityType: "PAYMENT",
    entityId: randomUUID(),
    jobId: randomUUID(),
    paymentId: randomUUID(),
    invoiceId: null,
    payoutId: null,
    refundId: null,
    creditNoteId: null,
    category: "PAYMENT_AMOUNT_MISMATCH",
    severity: "ERROR",
    expectedValue: 100,
    actualValue: 90,
    differenceValue: -10,
    currency: "EUR",
    explanation: "Test discrepancy.",
    fingerprint: randomUUID(),
    resolutionStatus: "OPEN",
    resolution: null,
    detectedAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    ...overrides,
  };
}
