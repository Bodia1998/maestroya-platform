import { describe, expect, it } from "vitest";

import {
  LEAD_FEE_PAYMENT_FLOW_MARKER,
  validateLeadFeePaymentFacts,
  type LeadFeeProviderPaymentFacts,
} from "@/domain/services/lead-fee-payment-confirmation";

import { SNAPSHOT_DATA } from "../../../../test-utils/lead-publication-fixtures";
import { pendingPurchaseFromPublication } from "../../../../test-utils/lead-purchase-fixtures";

const purchase = { ...pendingPurchaseFromPublication("p1", "l1", "pro1", { ...SNAPSHOT_DATA, publishedAt: new Date(), price: "100.00" }), paymentReference: "pi_1" };
const ok: LeadFeeProviderPaymentFacts = { paymentReference: "pi_1", amountMinorUnits: 12100, currency: "EUR", metadataPurchaseId: "p1", metadataLeadId: "l1" };

describe("M141 domain — validateLeadFeePaymentFacts", () => {
  it("marker is LEAD_V1", () => expect(LEAD_FEE_PAYMENT_FLOW_MARKER).toBe("LEAD_V1"));
  it("accepts exact facts (EUR 121.00 -> 12100 cents)", () => expect(validateLeadFeePaymentFacts(purchase, ok)).toBeNull());
  it("accepts absent metadata (not required, only cross-checked)", () =>
    expect(validateLeadFeePaymentFacts(purchase, { ...ok, metadataPurchaseId: null, metadataLeadId: null })).toBeNull());
  it("rejects a missing / empty reference", () => {
    expect(validateLeadFeePaymentFacts(purchase, { ...ok, paymentReference: "" })).toBe("REFERENCE_MISSING");
    expect(validateLeadFeePaymentFacts(purchase, { ...ok, paymentReference: undefined })).toBe("REFERENCE_MISSING");
  });
  it("rejects a different reference and a purchase without one", () => {
    expect(validateLeadFeePaymentFacts(purchase, { ...ok, paymentReference: "pi_2" })).toBe("REFERENCE_MISMATCH");
    expect(validateLeadFeePaymentFacts({ ...purchase, paymentReference: null }, ok)).toBe("REFERENCE_MISMATCH");
  });
  it("never compares money as floating point (121.00 euros is not 12100 cents)", () => {
    expect(validateLeadFeePaymentFacts(purchase, { ...ok, amountMinorUnits: 121 })).toBe("AMOUNT_MISMATCH");
    expect(validateLeadFeePaymentFacts(purchase, { ...ok, amountMinorUnits: 12099.999999 })).toBe("AMOUNT_MALFORMED");
  });
});
