import { describe, expect, it } from "vitest";

import { ROLES } from "@/infrastructure/auth/rbac";
import {
  LEAD_FEE_DISPUTE_ALLOWED_ACTOR_ROLES,
  LEAD_FEE_DISPUTE_EVIDENCE_ENV,
  LEAD_FEE_DISPUTE_EVIDENCE_TRANSITIONS,
  LEAD_FEE_DISPUTE_STATUSES,
  LEAD_FEE_DISPUTE_TRANSITIONS,
  canTransitionLeadFeeDispute,
  decideLeadFeeDisputePurchaseEffect,
  decideLeadFeeDisputesPurchaseEffect,
  decimalToMinorUnits,
  leadFeeDisputeEvidenceIdempotencyKey,
  mapProviderDisputeStatus,
  minorUnitsToDecimal,
  purchaseStatusAfterEffect,
  summarizePlatformRefundState,
  resolveLeadFeeDisputeEvidenceConfig,
  validateLeadFeeDisputeAgainstPurchase,
  type LeadFeeProviderDisputeFacts,
} from "@/domain/services/lead-fee-dispute";
import { LEAD_PURCHASE_STATUSES, canTransitionLeadPurchase, type LeadPurchaseStatus } from "@/domain/services/lead-purchase";

describe("M155 — provider status mapping (fail closed, nothing guessed)", () => {
  it.each([
    ["charge.dispute.created", "needs_response", "NEEDS_RESPONSE"],
    ["charge.dispute.created", "warning_needs_response", "NEEDS_RESPONSE"],
    ["charge.dispute.updated", "under_review", "UNDER_REVIEW"],
    ["charge.dispute.updated", "warning_under_review", "UNDER_REVIEW"],
    ["charge.dispute.updated", "needs_response", "NEEDS_RESPONSE"],
    ["charge.dispute.closed", "won", "WON"],
    ["charge.dispute.closed", "lost", "LOST"],
    ["charge.dispute.closed", "warning_closed", "WARNING_CLOSED"],
  ] as const)("%s + %s -> %s", (type, raw, expected) => {
    expect(mapProviderDisputeStatus(type, raw)).toBe(expected);
  });

  it.each([
    ["charge.dispute.created", "won"],
    ["charge.dispute.created", "lost"],
    ["charge.dispute.updated", "lost"],
    ["charge.dispute.closed", "needs_response"],
    ["charge.dispute.closed", "under_review"],
    ["charge.dispute.closed", "charge_refunded"],
    ["charge.dispute.created", "prevented"],
    ["charge.dispute.created", ""],
    ["charge.dispute.created", "LOST"],
  ] as const)("rejects %s + %j (returns null)", (type, raw) => {
    expect(mapProviderDisputeStatus(type, raw)).toBeNull();
  });
});

describe("M155 — dispute state machine (forward-only, terminal states absorbing)", () => {
  it("allows exactly the documented transitions", () => {
    const all: string[] = [];
    for (const a of LEAD_FEE_DISPUTE_STATUSES) for (const b of LEAD_FEE_DISPUTE_STATUSES) if (canTransitionLeadFeeDispute(a, b)) all.push(`${a}>${b}`);
    expect(all).toEqual([
      "NEEDS_RESPONSE>UNDER_REVIEW",
      "NEEDS_RESPONSE>WON",
      "NEEDS_RESPONSE>LOST",
      "NEEDS_RESPONSE>WARNING_CLOSED",
      "UNDER_REVIEW>WON",
      "UNDER_REVIEW>LOST",
      "UNDER_REVIEW>WARNING_CLOSED",
    ]);
  });

  it("terminal statuses never move and nothing moves back to NEEDS_RESPONSE", () => {
    for (const t of ["WON", "LOST", "WARNING_CLOSED"] as const) expect(LEAD_FEE_DISPUTE_TRANSITIONS[t]).toEqual([]);
    for (const a of LEAD_FEE_DISPUTE_STATUSES) expect(canTransitionLeadFeeDispute(a, "NEEDS_RESPONSE")).toBe(false);
  });

  it("evidence status machine: NOT_SUBMITTED -> PENDING -> SUBMITTED, with a retry back only from PENDING", () => {
    expect(LEAD_FEE_DISPUTE_EVIDENCE_TRANSITIONS).toEqual({
      NOT_SUBMITTED: ["SUBMISSION_PENDING"],
      SUBMISSION_PENDING: ["SUBMITTED", "NOT_SUBMITTED"],
      SUBMITTED: [],
    });
  });
});

describe("M155 — purchase effect of a dispute (pure, order-independent)", () => {
  const effect = (d: Parameters<typeof decideLeadFeeDisputePurchaseEffect>[0], p: LeadPurchaseStatus) => decideLeadFeeDisputePurchaseEffect(d, p);

  it("open dispute suspends only a CONFIRMED purchase", () => {
    for (const d of ["NEEDS_RESPONSE", "UNDER_REVIEW"] as const)
      for (const p of LEAD_PURCHASE_STATUSES) expect(effect(d, p), `${d}/${p}`).toBe(p === "CONFIRMED" ? "SUSPEND" : "NONE");
  });

  it("WON / WARNING_CLOSED restore only a DISPUTED purchase", () => {
    for (const d of ["WON", "WARNING_CLOSED"] as const)
      for (const p of LEAD_PURCHASE_STATUSES) expect(effect(d, p), `${d}/${p}`).toBe(p === "DISPUTED" ? "RESTORE" : "NONE");
  });

  it("LOST revokes CONFIRMED or DISPUTED and leaves every other status alone (never REFUNDED)", () => {
    for (const p of LEAD_PURCHASE_STATUSES) expect(effect("LOST", p), p).toBe(p === "CONFIRMED" || p === "DISPUTED" ? "REVOKE" : "NONE");
    expect(purchaseStatusAfterEffect("REVOKE", "DISPUTED")).toBe("REVOKED");
    expect(purchaseStatusAfterEffect("REVOKE", "CONFIRMED")).not.toBe("REFUNDED");
  });

  it("every effect the domain can produce is a legal purchase transition", () => {
    for (const d of LEAD_FEE_DISPUTE_STATUSES)
      for (const p of LEAD_PURCHASE_STATUSES) {
        const after = purchaseStatusAfterEffect(effect(d, p), p);
        if (after !== p) expect(canTransitionLeadPurchase(p, after), `${d}/${p}->${after}`).toBe(true);
      }
  });

  it("aggregate over several disputes: LOST > open > restore; none requires nothing; order does not matter", () => {
    expect(decideLeadFeeDisputesPurchaseEffect("CONFIRMED", [])).toBe("NONE");
    expect(decideLeadFeeDisputesPurchaseEffect("CONFIRMED", ["WON", "NEEDS_RESPONSE"])).toBe("SUSPEND");
    expect(decideLeadFeeDisputesPurchaseEffect("DISPUTED", ["WON", "UNDER_REVIEW"])).toBe("NONE");
    expect(decideLeadFeeDisputesPurchaseEffect("DISPUTED", ["WON", "WARNING_CLOSED"])).toBe("RESTORE");
    expect(decideLeadFeeDisputesPurchaseEffect("DISPUTED", ["UNDER_REVIEW", "LOST", "WON"])).toBe("REVOKE");
    expect(decideLeadFeeDisputesPurchaseEffect("CONFIRMED", ["LOST", "WON"])).toBe("REVOKE");
    const set = ["LOST", "WON", "NEEDS_RESPONSE"] as const;
    for (const p of LEAD_PURCHASE_STATUSES) expect(decideLeadFeeDisputesPurchaseEffect(p, set)).toBe(decideLeadFeeDisputesPurchaseEffect(p, [...set].reverse()));
  });
});

describe("M155 — exact decimal money", () => {
  it.each([
    ["0.01", 1],
    ["12.34", 1234],
    ["121.00", 12100],
    ["121", 12100],
    ["121.5", 12150],
    ["99999999.99", 9999999999],
  ])("decimalToMinorUnits(%s) = %d", (s, n) => expect(decimalToMinorUnits(s)).toBe(n));

  it.each(["", "-1.00", "1.234", "abc", "1,00", "123456789.00", "1e3", ".5"])("rejects %j", (s) => expect(decimalToMinorUnits(s)).toBeNull());

  it("round-trips without floating point error", () => {
    for (const n of [1, 10, 99, 100, 101, 1999, 12100, 9999999999]) expect(decimalToMinorUnits(minorUnitsToDecimal(n))).toBe(n);
    expect(minorUnitsToDecimal(5)).toBe("0.05");
  });
});

describe("M155 — dispute validated against the persisted purchase", () => {
  const purchase = { status: "CONFIRMED" as const, paymentReference: "pi_1", currency: "EUR", totalAmount: "121.00" };
  const dispute = (o: Partial<LeadFeeProviderDisputeFacts> = {}): LeadFeeProviderDisputeFacts => ({
    providerDisputeId: "dp_1",
    paymentReference: "pi_1",
    providerChargeId: "ch_1",
    amountMinorUnits: 12100,
    currency: "eur",
    reason: "fraudulent",
    evidenceDueBy: null,
    ...o,
  });

  it("accepts a full and a partial dispute", () => {
    expect(validateLeadFeeDisputeAgainstPurchase(dispute(), purchase)).toBeNull();
    expect(validateLeadFeeDisputeAgainstPurchase(dispute({ amountMinorUnits: 1 }), purchase)).toBeNull();
  });

  it.each([
    [{ paymentReference: null }, "PAYMENT_REFERENCE_MISSING"],
    [{ paymentReference: "pi_other" }, "PAYMENT_REFERENCE_MISSING"],
    [{ providerChargeId: null }, "CHARGE_MISSING"],
    [{ currency: "usd" }, "CURRENCY_MISMATCH"],
    [{ amountMinorUnits: null }, "AMOUNT_INVALID"],
    [{ amountMinorUnits: 0 }, "AMOUNT_INVALID"],
    [{ amountMinorUnits: -5 }, "AMOUNT_INVALID"],
    [{ amountMinorUnits: 12.5 }, "AMOUNT_INVALID"],
    [{ amountMinorUnits: 12101 }, "AMOUNT_EXCEEDS_PAYMENT"],
  ] as const)("rejects %j as %s", (o, reason) => {
    expect(validateLeadFeeDisputeAgainstPurchase(dispute(o as Partial<LeadFeeProviderDisputeFacts>), purchase)).toBe(reason);
  });

  it("rejects a purchase without a usable snapshot total or reference", () => {
    expect(validateLeadFeeDisputeAgainstPurchase(dispute(), { ...purchase, totalAmount: null })).toBe("SNAPSHOT_INVALID");
    expect(validateLeadFeeDisputeAgainstPurchase(dispute(), { ...purchase, totalAmount: "0.00" })).toBe("SNAPSHOT_INVALID");
    expect(validateLeadFeeDisputeAgainstPurchase(dispute(), { ...purchase, paymentReference: null })).toBe("PAYMENT_REFERENCE_MISSING");
    expect(validateLeadFeeDisputeAgainstPurchase(dispute(), { ...purchase, currency: "USD" })).toBe("CURRENCY_MISMATCH");
  });
});

describe("M155 — evidence switch, key and roles", () => {
  it("submission is OFF unless the variable is exactly 'true'; any other non-empty value is INVALID (blocks)", () => {
    expect(resolveLeadFeeDisputeEvidenceConfig({})).toEqual({ status: "VALID", submissionEnabled: false });
    expect(resolveLeadFeeDisputeEvidenceConfig({ [LEAD_FEE_DISPUTE_EVIDENCE_ENV]: "" })).toEqual({ status: "VALID", submissionEnabled: false });
    expect(resolveLeadFeeDisputeEvidenceConfig({ [LEAD_FEE_DISPUTE_EVIDENCE_ENV]: "false" })).toEqual({ status: "VALID", submissionEnabled: false });
    expect(resolveLeadFeeDisputeEvidenceConfig({ [LEAD_FEE_DISPUTE_EVIDENCE_ENV]: "true" })).toEqual({ status: "VALID", submissionEnabled: true });
    for (const bad of ["TRUE", "1", "yes", "enabled"]) expect(resolveLeadFeeDisputeEvidenceConfig({ [LEAD_FEE_DISPUTE_EVIDENCE_ENV]: bad })).toEqual({ status: "INVALID" });
  });

  it("does not touch the M153 refund switch name", () => {
    expect(LEAD_FEE_DISPUTE_EVIDENCE_ENV).toBe("LEAD_FEE_DISPUTE_EVIDENCE_SUBMISSION_ENABLED");
  });

  it("the idempotency key is deterministic per dispute", () => {
    expect(leadFeeDisputeEvidenceIdempotencyKey("d1")).toBe("lead-fee-dispute-evidence:d1");
    expect(leadFeeDisputeEvidenceIdempotencyKey("d1")).toBe(leadFeeDisputeEvidenceIdempotencyKey("d1"));
    expect(leadFeeDisputeEvidenceIdempotencyKey("d1")).not.toBe(leadFeeDisputeEvidenceIdempotencyKey("d2"));
  });

  it("the local actor-role constant is pinned to the real RBAC roles", () => {
    expect([...LEAD_FEE_DISPUTE_ALLOWED_ACTOR_ROLES]).toEqual([ROLES.ADMIN, ROLES.SUPER_ADMIN]);
  });
});

describe("M155 H1 — refund-aware restore decision", () => {
  it("summarizes only explicitly known refund statuses; FAILED is irrelevant, anything else fails safe", () => {
    expect(summarizePlatformRefundState([])).toBe("NONE");
    expect(summarizePlatformRefundState(["FAILED"])).toBe("NONE");
    expect(summarizePlatformRefundState(["FAILED", "FAILED"])).toBe("NONE");
    for (const s of ["REQUESTED", "PROVIDER_PENDING", "UNKNOWN"]) expect(summarizePlatformRefundState(["FAILED", s])).toBe("IN_FLIGHT");
    expect(summarizePlatformRefundState(["UNKNOWN", "SUCCEEDED"])).toBe("SUCCEEDED");
    expect(summarizePlatformRefundState(["FAILED", "SUCCEEDED"])).toBe("SUCCEEDED");
    expect(summarizePlatformRefundState(["SOMETHING_NEW"])).toBe("UNRECOGNIZED");
    expect(summarizePlatformRefundState(["FAILED", "SOMETHING_NEW"])).toBe("UNRECOGNIZED");
    expect(summarizePlatformRefundState(["REQUESTED", "SOMETHING_NEW"])).toBe("IN_FLIGHT");
  });

  it("won / warning-closed: no relevant refund restores; SUCCEEDED converges to REFUNDED; in-flight / unrecognised keep DISPUTED", () => {
    for (const d of ["WON", "WARNING_CLOSED"] as const) {
      expect(decideLeadFeeDisputesPurchaseEffect("DISPUTED", [d], "NONE")).toBe("RESTORE");
      expect(decideLeadFeeDisputesPurchaseEffect("DISPUTED", [d], "SUCCEEDED")).toBe("REFUND");
      expect(decideLeadFeeDisputesPurchaseEffect("DISPUTED", [d], "IN_FLIGHT")).toBe("NONE");
      expect(decideLeadFeeDisputesPurchaseEffect("DISPUTED", [d], "UNRECOGNIZED")).toBe("NONE");
    }
    // default argument keeps the pre-H1 behavior for callers that know of no refund
    expect(decideLeadFeeDisputesPurchaseEffect("DISPUTED", ["WON"])).toBe("RESTORE");
  });

  it("the refund state never changes the other outcomes, and no refund state ever produces CONFIRMED from a refund", () => {
    for (const r of ["NONE", "IN_FLIGHT", "SUCCEEDED", "UNRECOGNIZED"] as const) {
      expect(decideLeadFeeDisputesPurchaseEffect("CONFIRMED", ["NEEDS_RESPONSE"], r)).toBe("SUSPEND");
      expect(decideLeadFeeDisputesPurchaseEffect("DISPUTED", ["UNDER_REVIEW"], r)).toBe("NONE");
      expect(decideLeadFeeDisputesPurchaseEffect("DISPUTED", ["LOST"], r)).toBe("REVOKE");
      expect(decideLeadFeeDisputesPurchaseEffect("CONFIRMED", ["WON"], r)).toBe("NONE");
      for (const p of LEAD_PURCHASE_STATUSES) {
        const effect = decideLeadFeeDisputesPurchaseEffect(p, ["WON"], r);
        if (r !== "NONE") expect(effect, `${p}/${r}`).not.toBe("RESTORE");
        const after = purchaseStatusAfterEffect(effect, p);
        if (after !== p) expect(canTransitionLeadPurchase(p, after)).toBe(true);
      }
    }
    expect(purchaseStatusAfterEffect("REFUND", "DISPUTED")).toBe("REFUNDED");
  });
});
