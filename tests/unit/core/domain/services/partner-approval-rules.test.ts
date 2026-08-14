import { describe, expect, it } from "vitest";

import { InvalidPartnerTransitionError } from "@/domain/errors/domain-error";
import {
  assertValidPartnerStatusTransition,
  canTransitionPartnerStatus,
  isPartnerActiveForAffiliateActivity,
} from "@/domain/services/partner-approval-rules";

describe("Module 61 — partner-approval-rules", () => {
  it("allows PENDING -> APPROVED and PENDING -> REJECTED", () => {
    expect(canTransitionPartnerStatus("PENDING", "APPROVED")).toBe(true);
    expect(canTransitionPartnerStatus("PENDING", "REJECTED")).toBe(true);
  });

  it("allows APPROVED -> SUSPENDED and APPROVED -> BANNED", () => {
    expect(canTransitionPartnerStatus("APPROVED", "SUSPENDED")).toBe(true);
    expect(canTransitionPartnerStatus("APPROVED", "BANNED")).toBe(true);
  });

  it("allows SUSPENDED -> APPROVED (reinstatement) and SUSPENDED -> BANNED", () => {
    expect(canTransitionPartnerStatus("SUSPENDED", "APPROVED")).toBe(true);
    expect(canTransitionPartnerStatus("SUSPENDED", "BANNED")).toBe(true);
  });

  it("treats REJECTED and BANNED as terminal", () => {
    expect(canTransitionPartnerStatus("REJECTED", "APPROVED")).toBe(false);
    expect(canTransitionPartnerStatus("REJECTED", "PENDING")).toBe(false);
    expect(canTransitionPartnerStatus("BANNED", "APPROVED")).toBe(false);
    expect(canTransitionPartnerStatus("BANNED", "SUSPENDED")).toBe(false);
  });

  it("rejects PENDING -> SUSPENDED (must be approved first)", () => {
    expect(canTransitionPartnerStatus("PENDING", "SUSPENDED")).toBe(false);
  });

  it("throws InvalidPartnerTransitionError for a disallowed transition", () => {
    expect(() => assertValidPartnerStatusTransition("REJECTED", "APPROVED")).toThrow(InvalidPartnerTransitionError);
  });

  it("does not throw for an allowed transition", () => {
    expect(() => assertValidPartnerStatusTransition("PENDING", "APPROVED")).not.toThrow();
  });

  it("only APPROVED partners are active for affiliate activity", () => {
    expect(isPartnerActiveForAffiliateActivity("APPROVED")).toBe(true);
    expect(isPartnerActiveForAffiliateActivity("PENDING")).toBe(false);
    expect(isPartnerActiveForAffiliateActivity("REJECTED")).toBe(false);
    expect(isPartnerActiveForAffiliateActivity("SUSPENDED")).toBe(false);
    expect(isPartnerActiveForAffiliateActivity("BANNED")).toBe(false);
  });
});
