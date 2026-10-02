import { describe, expect, it } from "vitest";

import { DomainError } from "@/domain/errors/domain-error";
import {
  INITIAL_LEAD_STATUS,
  InvalidLeadFlowError,
  InvalidLeadMaxBuyersError,
  LEAD_FLOW_VERSION,
  LEAD_STATUSES,
  assertLeadEligibleFlow,
  isLeadStatus,
  normalizeLeadMaxBuyers,
} from "@/domain/services/lead";
import { TRANSACTION_FLOW_VERSIONS } from "@/domain/services/transaction-flow";

describe("Module 123 — Lead domain rules", () => {
  it("represents exactly the minimal lifecycle states, starting at DRAFT", () => {
    expect([...LEAD_STATUSES]).toEqual(["DRAFT", "PUBLISHED", "CLOSED", "EXPIRED", "CANCELLED"]);
    expect(INITIAL_LEAD_STATUS).toBe("DRAFT");
  });

  it("accepts valid statuses and rejects everything else", () => {
    for (const s of LEAD_STATUSES) expect(isLeadStatus(s)).toBe(true);
    for (const bad of ["draft", "ACTIVE", "", null, undefined, 1, {}]) expect(isLeadStatus(bad)).toBe(false);
  });

  it("Lead -> LEAD_V1 invariant: LEAD_V1 is accepted", () => {
    expect(LEAD_FLOW_VERSION).toBe("LEAD_V1");
    expect(() => assertLeadEligibleFlow("LEAD_V1")).not.toThrow();
  });

  it("Lead -> LEAD_V1 invariant: LEGACY_QUOTE_PAYMENT and anything unknown are rejected", () => {
    const rejected = TRANSACTION_FLOW_VERSIONS.filter((f) => f !== "LEAD_V1");
    expect(rejected).toContain("LEGACY_QUOTE_PAYMENT");
    for (const flow of [...rejected, "", "lead_v1", null, undefined]) {
      const run = () => assertLeadEligibleFlow(flow as string);
      expect(run).toThrow(InvalidLeadFlowError);
      try {
        run();
      } catch (error) {
        expect(error).toBeInstanceOf(DomainError);
      }
    }
  });

  describe("maxBuyers (configurable access rule, no policy chosen)", () => {
    it("null / undefined mean 'not configured' (neither unlimited nor exclusive)", () => {
      expect(normalizeLeadMaxBuyers(null)).toBeNull();
      expect(normalizeLeadMaxBuyers(undefined)).toBeNull();
    });

    it("accepts positive integers without favouring a policy (1 = exclusive, N = shared)", () => {
      expect(normalizeLeadMaxBuyers(1)).toBe(1);
      expect(normalizeLeadMaxBuyers(3)).toBe(3);
    });

    it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("rejects %s", (bad) => {
      expect(() => normalizeLeadMaxBuyers(bad)).toThrow(InvalidLeadMaxBuyersError);
    });
  });
});
