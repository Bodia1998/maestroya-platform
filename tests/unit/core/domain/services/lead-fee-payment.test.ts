import { describe, expect, it } from "vitest";

import type { LeadPurchaseRecord } from "@/domain/repositories/lead-purchase-repository";
import {
  LeadFeePaymentNotInitiableError,
  leadFeePaymentIdempotencyKey,
  leadFeePaymentTermsFromPurchase,
} from "@/domain/services/lead-fee-payment";
import { LEAD_PURCHASE_STATUSES } from "@/domain/services/lead-purchase";

import { SNAPSHOT_DATA } from "../../../../test-utils/lead-publication-fixtures";
import { pendingPurchaseFromPublication } from "../../../../test-utils/lead-purchase-fixtures";

const purchase = (price = "100.00"): LeadPurchaseRecord => pendingPurchaseFromPublication("p1", "l1", "pro1", { ...SNAPSHOT_DATA, publishedAt: new Date("2026-10-01T00:00:00Z"), price });
const withSnapshot = (patch: Partial<LeadPurchaseRecord["financialSnapshot"]>, top: Partial<LeadPurchaseRecord> = {}): LeadPurchaseRecord => {
  const base = purchase();
  return { ...base, ...top, financialSnapshot: { ...base.financialSnapshot, ...patch } };
};
const reasonOf = (p: LeadPurchaseRecord) => {
  try {
    leadFeePaymentTermsFromPurchase(p);
  } catch (e) {
    expect(e).toBeInstanceOf(LeadFeePaymentNotInitiableError);
    return (e as LeadFeePaymentNotInitiableError).reason;
  }
  return null;
};

describe("M140 — leadFeePaymentTermsFromPurchase (amount authority)", () => {
  it("100.00 + 21.00 IVA = 121.00 EUR -> exactly 12100 minor units (never 10000)", () => {
    expect(leadFeePaymentTermsFromPurchase(purchase("100.00"))).toEqual({ totalAmount: "121.00", totalMinorUnits: 12100, currency: "EUR" });
  });

  it("converts the persisted total exactly, including a half-cent-rounded IVA (18.05 -> 21.84 -> 2184)", () => {
    expect(leadFeePaymentTermsFromPurchase(purchase("18.05"))).toMatchObject({ totalAmount: "21.84", totalMinorUnits: 2184 });
  });

  it("uses the stored total, not fee x rate: a (hypothetical) stored total is what is read", () => {
    const p = withSnapshot({ feeAmount: "10.00", taxAmount: "2.10", totalAmount: "12.10" });
    expect(leadFeePaymentTermsFromPurchase(p).totalMinorUnits).toBe(1210);
  });

  it.each(LEAD_PURCHASE_STATUSES.filter((s) => s !== "PENDING_PAYMENT"))("rejects %s", (status) => {
    expect(reasonOf({ ...purchase(), status })).toBe("STATUS");
  });

  it("rejects a legacy purchase (no tax / snapshot) without inventing tax", () => {
    expect(reasonOf(withSnapshot({ taxAmount: null, totalAmount: null, taxPolicyVersion: null }))).toBe("LEGACY");
    expect(reasonOf(withSnapshot({ pricingConfigVersion: null, pricingRuleVersion: null, leadPublishedAt: null }))).toBe("LEGACY");
  });

  it.each([
    ["currency not EUR", { currency: "USD" }],
    ["total != fee + tax", { totalAmount: "120.99" }],
    ["zero total", { feeAmount: "0.00", taxAmount: "0.00", totalAmount: "0.00" }],
    ["malformed fee", { feeAmount: "1e2" }],
    ["malformed total", { totalAmount: "121.0.0" }],
    ["negative total", { totalAmount: "-121.00" }],
    ["too many decimals", { totalAmount: "121.001" }],
    ["blank total", { totalAmount: "" }],
  ] as const)("rejects an invalid snapshot: %s", (_name, patch) => {
    expect(reasonOf(withSnapshot(patch))).toBe("SNAPSHOT_INVALID");
  });

  it("rejects when the record currency disagrees with the snapshot currency", () => {
    expect(reasonOf(withSnapshot({}, { currency: "USD" }))).toBe("SNAPSHOT_INVALID");
  });

  it("the idempotency key is deterministic per purchase", () => {
    expect(leadFeePaymentIdempotencyKey("abc")).toBe(leadFeePaymentIdempotencyKey("abc"));
    expect(leadFeePaymentIdempotencyKey("abc")).not.toBe(leadFeePaymentIdempotencyKey("abd"));
  });
});
