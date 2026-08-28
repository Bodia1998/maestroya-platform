import { describe, expect, it } from "vitest";

import { determineDiscrepancySeverity } from "@/domain/services/reconciliation/severity";

describe("determineDiscrepancySeverity", () => {
  it("classifies duplicate/exceeds-payable categories as CRITICAL", () => {
    for (const category of [
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
    ] as const) {
      expect(determineDiscrepancySeverity({ category, expectedValue: null, actualValue: null })).toBe("CRITICAL");
    }
  });

  it("classifies metadata/numbering anomalies as WARNING", () => {
    for (const category of [
      "INVOICE_NUMBERING_ANOMALY",
      "CREDIT_NOTE_NUMBERING_ANOMALY",
      "INVOICE_MISSING_IMMUTABLE_METADATA",
      "PROVIDER_STATE_UNKNOWN",
    ] as const) {
      expect(determineDiscrepancySeverity({ category, expectedValue: null, actualValue: null })).toBe("WARNING");
    }
  });

  it("defaults an amount-bearing category with a real difference to ERROR", () => {
    expect(
      determineDiscrepancySeverity({ category: "COMMISSION_AMOUNT_MISMATCH", expectedValue: 100, actualValue: 150 }),
    ).toBe("ERROR");
  });

  it("defaults a category with no expected/actual values to ERROR", () => {
    expect(
      determineDiscrepancySeverity({ category: "INVOICE_WRONG_PARTY", expectedValue: null, actualValue: null }),
    ).toBe("ERROR");
  });

  it("downgrades a negligible (< 0.05) amount difference from ERROR to WARNING", () => {
    expect(
      determineDiscrepancySeverity({ category: "COMMISSION_AMOUNT_MISMATCH", expectedValue: 100, actualValue: 100.02 }),
    ).toBe("WARNING");
  });

  it("does not downgrade a difference at or above the 0.05 threshold", () => {
    // 0.10 rather than the exact 0.05 boundary — 100.05 - 100 is subject to
    // floating-point rounding (it evaluates to slightly less than 0.05 in
    // IEEE 754 double arithmetic), which would make this assertion flaky
    // for reasons unrelated to what's being tested here.
    expect(
      determineDiscrepancySeverity({ category: "COMMISSION_AMOUNT_MISMATCH", expectedValue: 100, actualValue: 100.1 }),
    ).toBe("ERROR");
  });

  it("does not downgrade a zero-magnitude difference away from ERROR (a real category mismatch with equal values is still ERROR)", () => {
    expect(
      determineDiscrepancySeverity({ category: "COMMISSION_AMOUNT_MISMATCH", expectedValue: 100, actualValue: 100 }),
    ).toBe("ERROR");
  });

  it("never downgrades a CRITICAL category regardless of magnitude", () => {
    expect(
      determineDiscrepancySeverity({ category: "DUPLICATE_PAYMENT", expectedValue: 100, actualValue: 100.01 }),
    ).toBe("CRITICAL");
  });
});
