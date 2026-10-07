import { describe, expect, it } from "vitest";

import { canProfessionalAccessLeadContact, type LeadContactAuthorizationFacts } from "@/domain/services/lead-contact-access-policy";
import {
  ACTIVE_LEAD_PURCHASE_STATUSES,
  INITIAL_LEAD_PURCHASE_STATUS,
  InvalidLeadPurchaseError,
  LEAD_PURCHASE_STATUSES,
  assertValidLeadPurchaseAmount,
  isActiveLeadPurchaseStatus,
  isContactAuthorizationCandidate,
  isLeadPurchaseStatus,
  toLeadContactGrantState,
} from "@/domain/services/lead-purchase";

describe("Module 123 — LeadPurchase domain rules", () => {
  describe("status representation", () => {
    it("represents the six lifecycle states and starts at PENDING_PAYMENT", () => {
      expect([...LEAD_PURCHASE_STATUSES]).toEqual(["PENDING_PAYMENT", "CONFIRMED", "FAILED", "CANCELLED", "REFUNDED", "REVOKED"]);
      expect(INITIAL_LEAD_PURCHASE_STATUS).toBe("PENDING_PAYMENT");
    });

    it("validates statuses", () => {
      for (const s of LEAD_PURCHASE_STATUSES) expect(isLeadPurchaseStatus(s)).toBe(true);
      for (const bad of ["PENDING", "paid", "", null, undefined, 3]) expect(isLeadPurchaseStatus(bad)).toBe(false);
    });

    it("only PENDING_PAYMENT and CONFIRMED are 'active' (duplicate-guard scope)", () => {
      expect([...ACTIVE_LEAD_PURCHASE_STATUSES]).toEqual(["PENDING_PAYMENT", "CONFIRMED"]);
      for (const s of LEAD_PURCHASE_STATUSES) {
        expect(isActiveLeadPurchaseStatus(s)).toBe(s === "PENDING_PAYMENT" || s === "CONFIRMED");
      }
    });
  });

  describe("price / currency validation (EUR, <= 2 decimals, non-negative)", () => {
    it.each([0, 0.01, 4.5, 12.34, 99999999.99])("accepts %s EUR", (price) => {
      expect(() => assertValidLeadPurchaseAmount(price, "EUR")).not.toThrow();
    });

    it.each([-0.01, -5, Number.NaN, Number.POSITIVE_INFINITY, 1.005, 10.999, 100000000])("rejects price %s", (price) => {
      expect(() => assertValidLeadPurchaseAmount(price, "EUR")).toThrow(InvalidLeadPurchaseError);
    });

    it.each(["USD", "eur", "", "EURO"])("rejects currency %j", (currency) => {
      expect(() => assertValidLeadPurchaseAmount(5, currency)).toThrow(InvalidLeadPurchaseError);
    });
  });

  describe("Module 122 boundary: purchase existence never authorizes contact", () => {
    const facts = (state: ReturnType<typeof toLeadContactGrantState>, flow: "LEAD_V1" | "LEGACY_QUOTE_PAYMENT" = "LEAD_V1"): LeadContactAuthorizationFacts => ({
      leadExists: true,
      flowVersion: flow,
      grant: { state, professionalProfileId: "pro-1" },
      blocked: false,
      contactOwnershipConsistent: true,
    });

    it("maps only CONFIRMED to a CONFIRMED grant; everything else is non-confirmed", () => {
      expect(toLeadContactGrantState("CONFIRMED")).toBe("CONFIRMED");
      expect(toLeadContactGrantState("PENDING_PAYMENT")).toBe("PENDING");
      expect(toLeadContactGrantState("REVOKED")).toBe("REVOKED");
      for (const s of ["FAILED", "CANCELLED", "REFUNDED", "SOMETHING_NEW", ""]) expect(toLeadContactGrantState(s)).toBe("INVALID");
    });

    it("is a candidate only when CONFIRMED", () => {
      for (const s of LEAD_PURCHASE_STATUSES) expect(isContactAuthorizationCandidate(s)).toBe(s === "CONFIRMED");
    });

    it.each(LEAD_PURCHASE_STATUSES.filter((s) => s !== "CONFIRMED"))("%s purchase is denied by the Module 122 policy", (status) => {
      const decision = canProfessionalAccessLeadContact(facts(toLeadContactGrantState(status)), "pro-1");
      expect(decision.allowed).toBe(false);
    });

    it("PENDING_PAYMENT does not authorize contact (explicit)", () => {
      expect(canProfessionalAccessLeadContact(facts(toLeadContactGrantState("PENDING_PAYMENT")), "pro-1")).toEqual({
        allowed: false,
        reason: "GRANT_NOT_CONFIRMED",
      });
    });

    it("CONFIRMED is only a candidate: the policy still decides (wrong flow / other professional deny)", () => {
      expect(canProfessionalAccessLeadContact(facts("CONFIRMED"), "pro-1")).toEqual({ allowed: true });
      expect(canProfessionalAccessLeadContact(facts("CONFIRMED", "LEGACY_QUOTE_PAYMENT"), "pro-1")).toEqual({ allowed: false, reason: "WRONG_FLOW" });
      expect(canProfessionalAccessLeadContact(facts("CONFIRMED"), "pro-2")).toEqual({
        allowed: false,
        reason: "GRANT_BELONGS_TO_OTHER_PROFESSIONAL",
      });
    });
  });
});
