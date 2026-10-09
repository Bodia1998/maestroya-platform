import { describe, expect, it } from "vitest";

import type { LeadPurchaseRecord } from "@/domain/repositories/lead-purchase-repository";
import {
  LEAD_FEE_PAYMENT_SUCCEEDED,
  LeadFeeLedgerEntryInvalidError,
  buildLeadFeeRevenueLedgerEntry,
  isSameLeadFeePayment,
} from "@/domain/services/lead-fee-revenue-ledger";

import { SNAPSHOT_DATA } from "../../../../test-utils/lead-publication-fixtures";
import { pendingPurchaseFromPublication } from "../../../../test-utils/lead-purchase-fixtures";

/** Module 149 — pure ledger-entry rules: amounts come from the persisted snapshot only. */
const PUBLICATION = { ...SNAPSHOT_DATA, publishedAt: new Date("2026-10-01T00:00:00Z"), price: "100.00" };
const SOURCE = { providerEventId: "evt_1", providerEventCreatedAt: new Date("2026-10-09T10:00:00Z") };

function confirmed(over: Partial<LeadPurchaseRecord> = {}): LeadPurchaseRecord {
  return {
    ...pendingPurchaseFromPublication("p-1", "l-1", "pro-1", PUBLICATION),
    status: "CONFIRMED",
    paymentReference: "pi_1",
    confirmedAt: new Date("2026-10-09T10:00:01Z"),
    ...over,
  };
}

describe("M149 — buildLeadFeeRevenueLedgerEntry", () => {
  it("records net fee, IVA and total exactly as snapshotted, with source references and timestamps", () => {
    const entry = buildLeadFeeRevenueLedgerEntry(confirmed(), SOURCE);
    expect(entry).toMatchObject({
      entryType: LEAD_FEE_PAYMENT_SUCCEEDED,
      leadPurchaseId: "p-1",
      leadId: "l-1",
      professionalProfileId: "pro-1",
      paymentReference: "pi_1",
      providerEventId: "evt_1",
      providerEventCreatedAt: SOURCE.providerEventCreatedAt,
      netFeeAmount: "100.00",
      taxAmount: "21.00",
      totalCollectedAmount: "121.00",
      currency: "EUR",
      paymentConfirmedAt: new Date("2026-10-09T10:00:01Z"),
    });
    expect(entry.taxPolicyVersion).toBeTruthy();
  });

  it("keeps cent precision (no float drift) for awkward fees", () => {
    const p = pendingPurchaseFromPublication("p-1", "l-1", "pro-1", { ...PUBLICATION, price: "18.07" });
    const entry = buildLeadFeeRevenueLedgerEntry({ ...p, status: "CONFIRMED", paymentReference: "pi_x", confirmedAt: new Date() }, SOURCE);
    expect(entry.netFeeAmount).toBe("18.07");
    expect(entry.taxAmount).toBe("3.79");
    expect(entry.totalCollectedAmount).toBe("21.86");
  });

  it("never carries the estimated job value / service revenue: only the documented fields exist", () => {
    const entry = buildLeadFeeRevenueLedgerEntry(confirmed(), SOURCE);
    expect(Object.keys(entry).sort()).toEqual(
      [
        "currency", "entryType", "leadId", "leadPurchaseId", "netFeeAmount", "paymentConfirmedAt", "paymentReference",
        "pricingConfigVersion", "pricingRuleVersion", "professionalProfileId", "providerEventCreatedAt", "providerEventId",
        "taxAmount", "taxPolicyVersion", "totalCollectedAmount",
      ].sort(),
    );
    expect(JSON.stringify(entry)).not.toMatch(/estimatedJobValue|jobValue|quote/i);
  });

  it.each(["PENDING_PAYMENT", "FAILED", "CANCELLED", "REFUNDED", "REVOKED"] as const)("refuses a %s purchase (no successful-revenue entry)", (status) => {
    expect(() => buildLeadFeeRevenueLedgerEntry(confirmed({ status }), SOURCE)).toThrowError(LeadFeeLedgerEntryInvalidError);
  });

  it("refuses a purchase without payment reference, confirmation time, valid snapshot or source event", () => {
    expect(() => buildLeadFeeRevenueLedgerEntry(confirmed({ paymentReference: null }), SOURCE)).toThrow(LeadFeeLedgerEntryInvalidError);
    expect(() => buildLeadFeeRevenueLedgerEntry(confirmed({ confirmedAt: null }), SOURCE)).toThrow(LeadFeeLedgerEntryInvalidError);
    expect(() => buildLeadFeeRevenueLedgerEntry(confirmed(), { ...SOURCE, providerEventId: "" })).toThrow(LeadFeeLedgerEntryInvalidError);
    const base = confirmed();
    const legacy = { ...base, financialSnapshot: { ...base.financialSnapshot, taxAmount: null, totalAmount: null, taxPolicyVersion: null } };
    expect(() => buildLeadFeeRevenueLedgerEntry(legacy, SOURCE)).toThrow(LeadFeeLedgerEntryInvalidError);
    const inconsistent = { ...base, financialSnapshot: { ...base.financialSnapshot, totalAmount: "130.00" } };
    expect(() => buildLeadFeeRevenueLedgerEntry(inconsistent, SOURCE)).toThrow(LeadFeeLedgerEntryInvalidError);
  });

  it("isSameLeadFeePayment ignores the audit source event but not money / references", () => {
    const a = buildLeadFeeRevenueLedgerEntry(confirmed(), SOURCE);
    expect(isSameLeadFeePayment(a, { ...a, providerEventId: "evt_other" })).toBe(true);
    expect(isSameLeadFeePayment(a, { ...a, totalCollectedAmount: "120.00" })).toBe(false);
    expect(isSameLeadFeePayment(a, { ...a, paymentReference: "pi_other" })).toBe(false);
  });
});
