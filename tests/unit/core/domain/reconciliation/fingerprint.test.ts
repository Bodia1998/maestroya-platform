import { describe, expect, it } from "vitest";

import { computeDiscrepancyFingerprint } from "@/domain/services/reconciliation/fingerprint";
import type { DiscrepancyCandidate } from "@/domain/services/reconciliation/types";

function makeCandidate(overrides: Partial<DiscrepancyCandidate> = {}): DiscrepancyCandidate {
  return {
    entityType: "PAYMENT",
    entityId: "payment-1",
    jobId: "job-1",
    paymentId: "payment-1",
    invoiceId: null,
    payoutId: null,
    refundId: null,
    creditNoteId: null,
    category: "PAYMENT_AMOUNT_MISMATCH",
    expectedValue: 1000,
    actualValue: 900,
    currency: "EUR",
    explanation: "some explanation",
    ...overrides,
  };
}

describe("computeDiscrepancyFingerprint", () => {
  it("is deterministic for the same candidate identity", () => {
    const a = computeDiscrepancyFingerprint(makeCandidate());
    const b = computeDiscrepancyFingerprint(makeCandidate());
    expect(a).toBe(b);
  });

  it("is a 64-character hex sha256 digest", () => {
    const fp = computeDiscrepancyFingerprint(makeCandidate());
    expect(fp).toMatch(/^[a-f0-9]{64}$/);
  });

  it("changes when the category changes", () => {
    const a = computeDiscrepancyFingerprint(makeCandidate({ category: "PAYMENT_AMOUNT_MISMATCH" }));
    const b = computeDiscrepancyFingerprint(makeCandidate({ category: "PAYMENT_CURRENCY_MISMATCH" }));
    expect(a).not.toBe(b);
  });

  it("changes when the entity id changes", () => {
    const a = computeDiscrepancyFingerprint(makeCandidate({ entityId: "payment-1" }));
    const b = computeDiscrepancyFingerprint(makeCandidate({ entityId: "payment-2" }));
    expect(a).not.toBe(b);
  });

  it("changes when the job id changes", () => {
    const a = computeDiscrepancyFingerprint(makeCandidate({ jobId: "job-1" }));
    const b = computeDiscrepancyFingerprint(makeCandidate({ jobId: "job-2" }));
    expect(a).not.toBe(b);
  });

  it("does NOT change when expectedValue/actualValue/explanation differ (same underlying condition re-detected)", () => {
    const a = computeDiscrepancyFingerprint(
      makeCandidate({ expectedValue: 1000, actualValue: 900, explanation: "run 1" }),
    );
    const b = computeDiscrepancyFingerprint(
      makeCandidate({ expectedValue: 1000, actualValue: 850, explanation: "run 2, rate changed since" }),
    );
    expect(a).toBe(b);
  });

  it("differs across entity types even with otherwise-identical fields", () => {
    const a = computeDiscrepancyFingerprint(makeCandidate({ entityType: "PAYMENT" }));
    const b = computeDiscrepancyFingerprint(makeCandidate({ entityType: "PAYOUT" }));
    expect(a).not.toBe(b);
  });
});
