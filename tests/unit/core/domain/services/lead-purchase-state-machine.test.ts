import { describe, expect, it } from "vitest";

import { canProfessionalAccessLeadContact } from "@/domain/services/lead-contact-access-policy";
import {
  InvalidLeadPurchaseTransitionError,
  LEAD_PURCHASE_STATUSES,
  LEAD_PURCHASE_TRANSITIONS,
  assertLeadPurchaseTransition,
  canTransitionLeadPurchase,
  hasBuyerCapacity,
  isProfessionalEligibleToPurchaseLeads,
  isTerminalLeadPurchaseStatus,
  leadPurchaseTransitionTimestamp,
  toLeadContactGrantState,
  type LeadPurchaseStatus,
} from "@/domain/services/lead-purchase";

const ALLOWED: Array<[LeadPurchaseStatus, LeadPurchaseStatus]> = [
  ["PENDING_PAYMENT", "CONFIRMED"],
  ["PENDING_PAYMENT", "FAILED"],
  ["PENDING_PAYMENT", "CANCELLED"],
  ["CONFIRMED", "REFUNDED"],
  ["CONFIRMED", "REVOKED"],
];

describe("Module 126 — LeadPurchase state machine", () => {
  it.each(ALLOWED)("allows %s -> %s", (from, to) => {
    expect(canTransitionLeadPurchase(from, to)).toBe(true);
    expect(() => assertLeadPurchaseTransition(from, to)).not.toThrow();
  });

  it("allows EXACTLY the five documented transitions and nothing else", () => {
    const all: Array<[string, string]> = [];
    for (const a of LEAD_PURCHASE_STATUSES) for (const b of LEAD_PURCHASE_STATUSES) if (canTransitionLeadPurchase(a, b)) all.push([a, b]);
    expect(all).toEqual(ALLOWED);
  });

  it.each([
    ["FAILED", "CONFIRMED"],
    ["CANCELLED", "CONFIRMED"],
    ["REFUNDED", "CONFIRMED"],
    ["REVOKED", "CONFIRMED"],
    ["CONFIRMED", "PENDING_PAYMENT"],
    ["CONFIRMED", "FAILED"],
    ["CONFIRMED", "CANCELLED"],
    ["PENDING_PAYMENT", "REFUNDED"],
    ["PENDING_PAYMENT", "REVOKED"],
    ["PENDING_PAYMENT", "PENDING_PAYMENT"],
    ["CONFIRMED", "CONFIRMED"],
    ["REFUNDED", "REVOKED"],
  ] as Array<[LeadPurchaseStatus, LeadPurchaseStatus]>)("rejects %s -> %s", (from, to) => {
    expect(canTransitionLeadPurchase(from, to)).toBe(false);
    expect(() => assertLeadPurchaseTransition(from, to)).toThrow(InvalidLeadPurchaseTransitionError);
  });

  it("terminal states have no outgoing transitions and can never reach CONFIRMED", () => {
    for (const s of ["FAILED", "CANCELLED", "REFUNDED", "REVOKED"] as const) {
      expect(isTerminalLeadPurchaseStatus(s)).toBe(true);
      expect(LEAD_PURCHASE_TRANSITIONS[s]).toEqual([]);
    }
    expect(isTerminalLeadPurchaseStatus("PENDING_PAYMENT")).toBe(false);
    expect(isTerminalLeadPurchaseStatus("CONFIRMED")).toBe(false);
  });

  it("unknown statuses never transition", () => {
    expect(canTransitionLeadPurchase("bogus" as never, "CONFIRMED")).toBe(false);
  });

  it("stamps the matching timestamp only", () => {
    expect(leadPurchaseTransitionTimestamp("CONFIRMED")).toBe("confirmedAt");
    expect(leadPurchaseTransitionTimestamp("REFUNDED")).toBe("refundedAt");
    expect(leadPurchaseTransitionTimestamp("REVOKED")).toBe("revokedAt");
    expect(leadPurchaseTransitionTimestamp("FAILED")).toBe("failedAt");
    expect(leadPurchaseTransitionTimestamp("CANCELLED")).toBe("cancelledAt");
    expect(leadPurchaseTransitionTimestamp("PENDING_PAYMENT")).toBeNull();
  });
});

describe("Module 126 — only CONFIRMED grants contact (Module 122 policy, unchanged)", () => {
  const decide = (status: LeadPurchaseStatus) =>
    canProfessionalAccessLeadContact(
      { leadExists: true, flowVersion: "LEAD_V1", blocked: false, grant: { state: toLeadContactGrantState(status), professionalProfileId: "pro-1" } },
      "pro-1",
    );

  it.each(["PENDING_PAYMENT", "FAILED", "CANCELLED", "REFUNDED", "REVOKED"] as const)("%s -> no contact", (status) => {
    expect(decide(status)).toMatchObject({ allowed: false });
  });

  it("CONFIRMED -> allowed by the policy; still denied for another professional or a legacy flow", () => {
    expect(decide("CONFIRMED")).toEqual({ allowed: true });
    expect(
      canProfessionalAccessLeadContact(
        { leadExists: true, flowVersion: "LEAD_V1", blocked: false, grant: { state: "CONFIRMED", professionalProfileId: "pro-2" } },
        "pro-1",
      ),
    ).toMatchObject({ allowed: false });
    expect(
      canProfessionalAccessLeadContact(
        { leadExists: true, flowVersion: "LEGACY_QUOTE_PAYMENT", blocked: false, grant: { state: "CONFIRMED", professionalProfileId: "pro-1" } },
        "pro-1",
      ),
    ).toMatchObject({ allowed: false });
  });
});

describe("Module 126 — purchase rules", () => {
  it("maxBuyers: null is not enforced; otherwise active count must be below the limit", () => {
    expect(hasBuyerCapacity(null, 1000)).toBe(true);
    expect(hasBuyerCapacity(2, 0)).toBe(true);
    expect(hasBuyerCapacity(2, 1)).toBe(true);
    expect(hasBuyerCapacity(2, 2)).toBe(false);
    expect(hasBuyerCapacity(1, 1)).toBe(false);
  });

  it("only ACTIVE + VERIFIED professionals may buy leads", () => {
    expect(isProfessionalEligibleToPurchaseLeads({ status: "ACTIVE", verificationStatus: "VERIFIED" })).toBe(true);
    for (const v of ["UNVERIFIED", "PENDING", "REJECTED"]) {
      expect(isProfessionalEligibleToPurchaseLeads({ status: "ACTIVE", verificationStatus: v })).toBe(false);
    }
    for (const s of ["INACTIVE", "SUSPENDED"]) {
      expect(isProfessionalEligibleToPurchaseLeads({ status: s, verificationStatus: "VERIFIED" })).toBe(false);
    }
  });
});

describe("Module 137 — authoritative LEAD_V1 lifecycle policy", () => {
  const TERMINAL = ["CONFIRMED", "FAILED", "CANCELLED"] as const;

  it("PENDING_PAYMENT is the only entry point to CONFIRMED / FAILED / CANCELLED", () => {
    for (const to of TERMINAL) {
      for (const from of LEAD_PURCHASE_STATUSES) {
        expect(canTransitionLeadPurchase(from, to)).toBe(from === "PENDING_PAYMENT");
      }
    }
  });

  it.each([
    ["CONFIRMED", "PENDING_PAYMENT"],
    ["CONFIRMED", "FAILED"],
    ["CONFIRMED", "CANCELLED"],
    ["CONFIRMED", "CONFIRMED"],
    ["FAILED", "PENDING_PAYMENT"],
    ["FAILED", "CONFIRMED"],
    ["FAILED", "CANCELLED"],
    ["FAILED", "FAILED"],
    ["CANCELLED", "PENDING_PAYMENT"],
    ["CANCELLED", "CONFIRMED"],
    ["CANCELLED", "FAILED"],
    ["CANCELLED", "CANCELLED"],
  ] as Array<[LeadPurchaseStatus, LeadPurchaseStatus]>)("rejects %s -> %s (incl. same-state repeats)", (from, to) => {
    expect(() => assertLeadPurchaseTransition(from, to)).toThrow(InvalidLeadPurchaseTransitionError);
  });

  it("nothing can return to PENDING_PAYMENT", () => {
    for (const from of LEAD_PURCHASE_STATUSES) expect(canTransitionLeadPurchase(from, "PENDING_PAYMENT")).toBe(false);
  });

  it("the transition error carries a stable code, the states and a message", () => {
    try {
      assertLeadPurchaseTransition("FAILED", "CONFIRMED");
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidLeadPurchaseTransitionError);
      expect(e).toMatchObject({ code: "INVALID_LEAD_PURCHASE_TRANSITION", from: "FAILED", to: "CONFIRMED" });
      expect((e as Error).message).toBe('A lead purchase cannot move from "FAILED" to "CONFIRMED".');
    }
  });

  it("each lifecycle target stamps its own distinct timestamp column", () => {
    expect(leadPurchaseTransitionTimestamp("CONFIRMED")).toBe("confirmedAt");
    expect(leadPurchaseTransitionTimestamp("FAILED")).toBe("failedAt");
    expect(leadPurchaseTransitionTimestamp("CANCELLED")).toBe("cancelledAt");
  });
});
