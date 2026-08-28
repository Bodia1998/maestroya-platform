import { describe, expect, it } from "vitest";

import { checkCommissionConsistency } from "@/domain/services/reconciliation/commission-checks";
import { makeCommission, makeCommissionBreakdown, makeContext } from "./fixtures";

describe("checkCommissionConsistency", () => {
  it("reports nothing when Commission matches the authoritative recomputation", () => {
    expect(checkCommissionConsistency(makeContext())).toEqual([]);
  });

  it("flags a commission amount that does not match the authoritative recomputation", () => {
    const context = makeContext({ commission: makeCommission({ amount: 50 }) });
    const findings = checkCommissionConsistency(context);
    expect(findings.some((f) => f.category === "COMMISSION_AMOUNT_MISMATCH")).toBe(true);
  });

  it("flags a commission rate that does not match the current authoritative rate", () => {
    const context = makeContext({ commission: makeCommission({ rateBps: 750 }) });
    const findings = checkCommissionConsistency(context);
    expect(findings.some((f) => f.category === "COMMISSION_RATE_MISMATCH")).toBe(true);
  });

  it("flags an inconsistent professional net earning", () => {
    const context = makeContext({
      commissionBreakdown: makeCommissionBreakdown({ professionalPayout: 800 }),
    });
    const findings = checkCommissionConsistency(context);
    expect(findings.some((f) => f.category === "COMMISSION_PROFESSIONAL_NET_MISMATCH")).toBe(true);
  });

  it("does nothing when no Commission has been recorded yet", () => {
    expect(checkCommissionConsistency(makeContext({ commission: null }))).toEqual([]);
  });
});
