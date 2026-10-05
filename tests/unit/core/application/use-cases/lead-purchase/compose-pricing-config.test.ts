import { beforeEach, describe, expect, it, vi } from "vitest";

const envState = vi.hoisted(() => ({ LEAD_PRICING_CONFIG_VERSION: undefined as string | undefined }));
vi.mock("@/infrastructure/config/env", () => ({ env: envState }));
// No database is touched: composition only constructs repositories.
vi.mock("@/infrastructure/database/prisma/client", () => ({ prisma: {} }));

import { ConfiguredLeadPurchasePriceProvider } from "@/application/services/lead-pricing/configured-lead-purchase-price-provider";
import { makeInitiateLeadPurchaseUseCase, makeLeadPurchasePriceProvider } from "@/application/use-cases/lead-purchase/compose";
import { LeadPricingConfigurationError } from "@/domain/services/lead-pricing-production-config";
import { LEAD_PRICING_TEST_CONFIG } from "../../../../../test-utils/pricing/lead-pricing-test-config";

describe("Module 132 — lead purchase composition production contract", () => {
  beforeEach(() => {
    envState.LEAD_PRICING_CONFIG_VERSION = undefined;
  });

  it("composes with a valid, selected production configuration", () => {
    envState.LEAD_PRICING_CONFIG_VERSION = "lead-pricing-pilot-v1";
    expect(makeLeadPurchasePriceProvider()).toBeInstanceOf(ConfiguredLeadPurchasePriceProvider);
    expect(() => makeInitiateLeadPurchaseUseCase()).not.toThrow();
  });

  it("fails closed when the version is not configured (INCOMPLETE) — no default, no test fallback", () => {
    expect(() => makeLeadPurchasePriceProvider()).toThrow(LeadPricingConfigurationError);
    expect(() => makeInitiateLeadPurchaseUseCase()).toThrow(/LEAD_PRICING_CONFIG_VERSION/);
    try {
      makeLeadPurchasePriceProvider();
    } catch (error) {
      expect((error as LeadPricingConfigurationError).status).toBe("INCOMPLETE");
    }
  });

  it("fails closed for an unknown version (INVALID)", () => {
    envState.LEAD_PRICING_CONFIG_VERSION = "lead-pricing-test-fixture";
    try {
      makeLeadPurchasePriceProvider();
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(LeadPricingConfigurationError);
      expect((error as LeadPricingConfigurationError).status).toBe("INVALID");
    }
  });

  it("selecting a test fixture's name in the environment never activates it", () => {
    envState.LEAD_PRICING_CONFIG_VERSION = LEAD_PRICING_TEST_CONFIG.configVersion;
    expect(() => makeLeadPurchasePriceProvider()).toThrow(LeadPricingConfigurationError);
  });

  it("an explicitly injected configuration is used and the environment is not consulted", () => {
    envState.LEAD_PRICING_CONFIG_VERSION = undefined;
    expect(makeLeadPurchasePriceProvider(LEAD_PRICING_TEST_CONFIG)).toBeInstanceOf(ConfiguredLeadPurchasePriceProvider);
  });
});
