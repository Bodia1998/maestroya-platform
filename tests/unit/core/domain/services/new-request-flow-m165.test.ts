import { describe, expect, it } from "vitest";

import { DomainError } from "@/domain/errors/domain-error";
import { LegacyRequestCreationRedirectedError, NEW_REQUEST_FLOW_REASONS, selectNewRequestFlow } from "@/domain/services/new-request-flow";
import { DEFAULT_TRANSACTION_FLOW_VERSION } from "@/domain/services/transaction-flow";

describe("M165 - selectNewRequestFlow (pure rule)", () => {
  it("selects LEAD_V1 only when the ENTRY area is open AND the category is eligible", () => {
    expect(selectNewRequestFlow({ entryOpen: true, categoryEligible: true })).toEqual({ flow: "LEAD_V1", reason: "LEAD_V1_DEFAULT" });
  });

  it("area closed => the pre-M165 default, whatever the category says", () => {
    expect(selectNewRequestFlow({ entryOpen: false, categoryEligible: true })).toEqual({ flow: "LEGACY_QUOTE_PAYMENT", reason: "ENTRY_CLOSED" });
    expect(selectNewRequestFlow({ entryOpen: false, categoryEligible: false })).toEqual({ flow: "LEGACY_QUOTE_PAYMENT", reason: "ENTRY_CLOSED" });
  });

  it("category not eligible => legacy", () => {
    expect(selectNewRequestFlow({ entryOpen: true, categoryEligible: false })).toEqual({ flow: "LEGACY_QUOTE_PAYMENT", reason: "CATEGORY_NOT_ELIGIBLE" });
  });

  it("the fallback IS the platform default flow (the pre-M165 behaviour), so 'off' changes nothing", () => {
    expect(DEFAULT_TRANSACTION_FLOW_VERSION).toBe("LEGACY_QUOTE_PAYMENT");
    expect(selectNewRequestFlow({ entryOpen: false, categoryEligible: false }).flow).toBe(DEFAULT_TRANSACTION_FLOW_VERSION);
  });

  it.each([undefined, null, 0, 1, "", "true", "ENABLED", "yes", [], {}, NaN])("a non-boolean-true fact (%j) never selects LEAD_V1", (value) => {
    expect(selectNewRequestFlow({ entryOpen: value, categoryEligible: true }).flow).toBe("LEGACY_QUOTE_PAYMENT");
    expect(selectNewRequestFlow({ entryOpen: true, categoryEligible: value }).flow).toBe("LEGACY_QUOTE_PAYMENT");
  });

  it("is deterministic and only ever returns a documented reason", () => {
    for (const entryOpen of [true, false]) {
      for (const categoryEligible of [true, false]) {
        const a = selectNewRequestFlow({ entryOpen, categoryEligible });
        expect(selectNewRequestFlow({ entryOpen, categoryEligible })).toEqual(a);
        expect(NEW_REQUEST_FLOW_REASONS).toContain(a.reason);
      }
    }
  });
});

describe("M165 - LegacyRequestCreationRedirectedError", () => {
  it("is a DomainError with its own stable code and a message that names neither the mode nor the pilot configuration", () => {
    const e = new LegacyRequestCreationRedirectedError();
    expect(e).toBeInstanceOf(DomainError);
    expect(e.code).toBe("LEGACY_REQUEST_CREATION_REDIRECTED");
    expect(e.message).not.toMatch(/ENTRY|ENABLED|DISABLED|rollout|pilot|LEAD_V1|legacy/i);
  });
});
