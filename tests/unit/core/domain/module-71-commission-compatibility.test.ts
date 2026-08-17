import { describe, expect, it } from "vitest";

import { COMMISSION_CALCULATION_SERVICE } from "@/domain/services/commission-calculation-service";

/**
 * Module 71 — Stripe Connect: this module deliberately introduces no new
 * commission math of its own — it reuses `CommissionCalculationService`
 * (Module 64) verbatim, per the module brief's "Stripe must NOT calculate
 * or define the MaestroYa commission" rule. This test pins the exact
 * worked example from the Module 71 brief so a future change to the
 * commission engine cannot silently break the number Stripe Connect
 * infrastructure is built to eventually move.
 */
describe("Module 71 — commission model compatibility (fixed business rule)", () => {
  it("computes the €1,200 full-presupuesto example exactly as specified", () => {
    const result = COMMISSION_CALCULATION_SERVICE.calculate({
      labour: 1000,
      materials: 200,
    });

    expect(result.total).toBe(1200);
    expect(result.commissionRateBps).toBe(1000); // 10.00%
    expect(result.commission).toBe(120); // MaestroYa commission
    expect(result.professionalPayout).toBe(1080); // Professional share
  });

  it("never lets Stripe (or any infrastructure code) redefine the rate — the default is always 10%", () => {
    const result = COMMISSION_CALCULATION_SERVICE.calculate({ labour: 500, materials: 0 });
    expect(result.commissionPercentage).toBe(10);
  });
});
