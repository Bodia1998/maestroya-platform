import { beforeEach, describe, expect, it, vi } from "vitest";

const logger = vi.hoisted(() => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }));
vi.mock("@/infrastructure/observability/logger", () => ({ logger }));

import { loadLeadRolloutConfig } from "@/infrastructure/config/lead-rollout-config";

beforeEach(() => vi.clearAllMocks());

describe("M159 — environment loader", () => {
  it("missing configuration is DISABLED/DEFAULT and logs nothing", () => {
    expect(loadLeadRolloutConfig({})).toEqual({ mode: "DISABLED", status: "DEFAULT" });
    expect(loadLeadRolloutConfig({ LEAD_V1_ROLLOUT_MODE: "" })).toEqual({ mode: "DISABLED", status: "DEFAULT" });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("the test environment itself is DISABLED (the process default must be the safe one)", () => {
    expect(loadLeadRolloutConfig().mode).toBe("DISABLED");
  });

  it.each(["DISABLED", "ENTRY_ONLY", "PURCHASE_ONLY", "ENABLED"])("accepts %s exactly", (mode) => {
    expect(loadLeadRolloutConfig({ LEAD_V1_ROLLOUT_MODE: mode })).toEqual({ mode, status: "CONFIGURED" });
  });

  it("an invalid value is DISABLED, warns, and NEVER logs the raw value", () => {
    const secretLooking = "enabled-by-mistake-s3cr3t";
    expect(loadLeadRolloutConfig({ LEAD_V1_ROLLOUT_MODE: secretLooking })).toEqual({ mode: "DISABLED", status: "MISCONFIGURED" });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(secretLooking);
  });

  it("reads the source on every call (no caching): the switch is a real rollout / rollback lever", () => {
    const source: Record<string, string | undefined> = {};
    expect(loadLeadRolloutConfig(source).mode).toBe("DISABLED");
    source.LEAD_V1_ROLLOUT_MODE = "ENABLED";
    expect(loadLeadRolloutConfig(source).mode).toBe("ENABLED");
    source.LEAD_V1_ROLLOUT_MODE = "DISABLED";
    expect(loadLeadRolloutConfig(source).mode).toBe("DISABLED");
  });

  it("an unreadable environment fails closed and never throws, even if the logger itself throws", () => {
    const hostile = new Proxy({}, { get: () => { throw new Error("boom"); } }) as Record<string, string | undefined>;
    logger.error.mockImplementation(() => { throw new Error("logger down"); });
    expect(loadLeadRolloutConfig(hostile)).toEqual({ mode: "DISABLED", status: "MISCONFIGURED" });
  });

  it("is independent of the Module 52 feature-flag switches and of the other lead switches", () => {
    const enabled = { LEAD_V1_ROLLOUT_MODE: "ENABLED" };
    expect(loadLeadRolloutConfig({ ...enabled, FEATURE_FLAGS_ENABLED: "false", FEATURE_FLAGS_CONFIG: "[]", LEAD_ABUSE_CONTROL_MODE: "OFF" }).mode).toBe("ENABLED");
    expect(loadLeadRolloutConfig({ FEATURE_FLAGS_ENABLED: "true", LEAD_ABUSE_CONTROL_MODE: "ENFORCE", LEAD_CONTACT_SHARING_BASIS: "CONSENT", LEAD_PRICING_CONFIG_VERSION: "lead-pricing-pilot-v1" }).mode).toBe("DISABLED");
  });
});
