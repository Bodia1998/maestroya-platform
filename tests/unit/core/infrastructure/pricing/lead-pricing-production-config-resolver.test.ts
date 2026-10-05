import { describe, expect, it } from "vitest";

import { LeadPricingConfigurationError } from "@/domain/services/lead-pricing-production-config";
import { LEAD_PRICING_PILOT_CONFIG_V1 } from "@/infrastructure/pricing/lead-pricing-pilot-config.v1";
import {
  LEAD_PRICING_PRODUCTION_CONFIGS,
  LEAD_PRICING_PRODUCTION_CONFIG_ENV,
  loadLeadPricingProductionConfigOrThrow,
  resolveLeadPricingProductionConfig,
} from "@/infrastructure/pricing/lead-pricing-production-config-resolver";
import { LEAD_PRICING_TEST_CONFIG } from "../../../../test-utils/pricing/lead-pricing-test-config";

describe("production config resolver (environment selector)", () => {
  it("selects the released pilot snapshot by version", () => {
    const r = resolveLeadPricingProductionConfig("lead-pricing-pilot-v1");
    expect(r.status).toBe("VALID");
    if (r.status === "VALID") expect(r.config.profile).toBe("PILOT_PRODUCTION");
  });

  it("trims the selector", () => {
    expect(resolveLeadPricingProductionConfig("  lead-pricing-pilot-v1 \n").status).toBe("VALID");
  });

  it.each([undefined, null, "", "   "])("selector %j is INCOMPLETE and names the missing variable (no default)", (selector) => {
    const r = resolveLeadPricingProductionConfig(selector);
    expect(r.status).toBe("INCOMPLETE");
    if (r.status !== "VALID") expect(r.issues[0]).toMatchObject({ path: LEAD_PRICING_PRODUCTION_CONFIG_ENV, code: "MISSING" });
    if (r.status !== "VALID") expect(r.issues[0]?.message).toContain("lead-pricing-pilot-v1");
  });

  it("an unknown version is INVALID and lists the known versions", () => {
    const r = resolveLeadPricingProductionConfig("lead-pricing-pilot-v9");
    expect(r.status).toBe("INVALID");
    if (r.status !== "VALID") expect(r.issues[0]?.message).toContain("known versions: lead-pricing-pilot-v1");
  });

  it("does not resolve prototype keys", () => {
    expect(resolveLeadPricingProductionConfig("constructor").status).toBe("INVALID");
    expect(resolveLeadPricingProductionConfig("__proto__").status).toBe("INVALID");
  });

  it("a registry entry whose configVersion differs from its key is INVALID", () => {
    expect(resolveLeadPricingProductionConfig("alias", { alias: LEAD_PRICING_PILOT_CONFIG_V1 }).status).toBe("INVALID");
  });

  it("a registry entry that is broken is INVALID with the offending path", () => {
    const broken = JSON.parse(JSON.stringify(LEAD_PRICING_PILOT_CONFIG_V1));
    broken.leadPricing.rateBySlug.pintura = "-0.1";
    const r = resolveLeadPricingProductionConfig(broken.configVersion, { [broken.configVersion]: broken });
    expect(r.status).toBe("INVALID");
    if (r.status !== "VALID") expect(r.issues.map((i) => i.path)).toContain("leadPricing.rateBySlug.pintura");
  });

  it("a TEST_ONLY snapshot is rejected even if it is (wrongly) registered and selected", () => {
    const r = resolveLeadPricingProductionConfig(LEAD_PRICING_TEST_CONFIG.configVersion, { [LEAD_PRICING_TEST_CONFIG.configVersion]: LEAD_PRICING_TEST_CONFIG });
    expect(r.status).toBe("TEST_ONLY");
  });

  it("the real registry holds only valid PILOT_PRODUCTION snapshots, keyed by their own version", () => {
    const entries = Object.entries(LEAD_PRICING_PRODUCTION_CONFIGS);
    expect(entries.length).toBeGreaterThan(0);
    for (const [key, config] of entries) {
      expect(config.profile).toBe("PILOT_PRODUCTION");
      expect(config.configVersion).toBe(key);
      expect(resolveLeadPricingProductionConfig(key).status).toBe("VALID");
    }
    expect(Object.values(LEAD_PRICING_PRODUCTION_CONFIGS)).not.toContain(LEAD_PRICING_TEST_CONFIG);
  });
});

describe("loadLeadPricingProductionConfigOrThrow (fail closed)", () => {
  it("returns the frozen validated snapshot", () => {
    const config = loadLeadPricingProductionConfigOrThrow("lead-pricing-pilot-v1");
    expect(config.configVersion).toBe("lead-pricing-pilot-v1");
    expect(Object.isFrozen(config)).toBe(true);
  });

  it.each([
    [undefined, "INCOMPLETE"],
    ["", "INCOMPLETE"],
    ["nope", "INVALID"],
  ] as const)("selector %j throws LeadPricingConfigurationError(%s) with an operator-readable message", (selector, status) => {
    try {
      loadLeadPricingProductionConfigOrThrow(selector);
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(LeadPricingConfigurationError);
      expect((error as LeadPricingConfigurationError).status).toBe(status);
      expect((error as Error).message).toContain(LEAD_PRICING_PRODUCTION_CONFIG_ENV);
    }
  });

  it("throws TEST_ONLY for a test snapshot", () => {
    expect(() => loadLeadPricingProductionConfigOrThrow("x", { x: { ...LEAD_PRICING_TEST_CONFIG, configVersion: "x" } })).toThrow(/TEST_ONLY/);
  });
});
