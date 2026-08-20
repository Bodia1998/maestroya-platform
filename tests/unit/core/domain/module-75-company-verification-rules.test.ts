import { describe, expect, it } from "vitest";

import { canReceivePayouts } from "@/domain/services/company-verification-rules";

/**
 * Module 75 — Company Payout Eligibility: unit coverage for the one
 * addition this module makes to `company-verification-rules.ts` —
 * `canReceivePayouts`, the company mirror of `professional-verification-
 * rules.ts`'s own `canReceivePayouts` (see
 * `tests/unit/core/domain/professional-verification-rules.test.ts`'s own
 * "Module 59" describe block for the predicate this is modeled on).
 * `company-verification-rules.ts` itself is otherwise untouched by
 * Module 75 — no other exported function's behavior changes.
 */
describe("company-verification-rules (Module 75 — canReceivePayouts)", () => {
  it("is true only for APPROVED", () => {
    expect(canReceivePayouts("APPROVED")).toBe(true);
    expect(canReceivePayouts("DRAFT")).toBe(false);
    expect(canReceivePayouts("PENDING")).toBe(false);
    expect(canReceivePayouts("UNDER_REVIEW")).toBe(false);
    expect(canReceivePayouts("REJECTED")).toBe(false);
    expect(canReceivePayouts("RESUBMISSION_REQUIRED")).toBe(false);
    expect(canReceivePayouts("EXPIRED")).toBe(false);
  });
});
