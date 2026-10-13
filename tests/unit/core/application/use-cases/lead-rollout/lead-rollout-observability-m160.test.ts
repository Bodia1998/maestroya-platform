import { beforeEach, describe, expect, it, vi } from "vitest";

const logger = vi.hoisted(() => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }));
vi.mock("@/infrastructure/observability/logger", () => ({ logger }));

import { LeadRolloutGuarded } from "@/application/use-cases/lead-rollout/lead-rollout-guard";
import { LEAD_ROLLOUT_AREAS, LEAD_ROLLOUT_MODES, LeadV1RolloutDisabledError, type LeadRolloutArea, type LeadRolloutConfig, type LeadRolloutMode } from "@/domain/services/lead-rollout";
import { loadLeadRolloutConfig } from "@/infrastructure/config/lead-rollout-config";

/**
 * Module 160 - the rollout guard's operational signal (`lead_rollout.guard_blocked`): present on every refusal, absent on every
 * pass-through, built from fixed low-cardinality fields only, free of any argument / raw configuration value, and never able to
 * change the outcome of the call.
 */
const OPEN: Record<LeadRolloutMode, LeadRolloutArea[]> = { DISABLED: [], ENTRY_ONLY: ["ENTRY"], PURCHASE_ONLY: ["PURCHASE"], ENABLED: ["ENTRY", "PURCHASE"] };
const cfg = (mode: LeadRolloutMode): LeadRolloutConfig => ({ mode, status: "CONFIGURED" });
const FIELD_KEYS = ["area", "configStatus", "mode", "reason"];

beforeEach(() => vi.clearAllMocks());

describe("M160 - guard block events", () => {
  for (const mode of LEAD_ROLLOUT_MODES) {
    for (const area of LEAD_ROLLOUT_AREAS) {
      const open = OPEN[mode].includes(area);
      it(`${mode} / ${area}: ${open ? "passes through and emits NOTHING (no per-request noise)" : "refuses and emits exactly one safe event"}`, async () => {
        const inner = { execute: vi.fn(async () => "done") };
        const call = new LeadRolloutGuarded(inner, area, () => cfg(mode)).execute();
        if (open) {
          await expect(call).resolves.toBe("done");
          expect(logger.info).not.toHaveBeenCalled();
          expect(logger.warn).not.toHaveBeenCalled();
          expect(logger.error).not.toHaveBeenCalled();
        } else {
          await expect(call).rejects.toBeInstanceOf(LeadV1RolloutDisabledError);
          expect(logger.info).toHaveBeenCalledTimes(1);
          expect(logger.error).not.toHaveBeenCalled();
          const [event, fields] = logger.info.mock.calls[0]!;
          expect(event).toBe("lead_rollout.guard_blocked");
          expect(fields).toEqual({ area, mode, configStatus: "CONFIGURED", reason: "AREA_CLOSED" });
          expect(Object.keys(fields).sort()).toEqual(FIELD_KEYS);
        }
      });
    }
  }

  it("the default (unset) configuration reports DEFAULT status; a misconfigured one reports MISCONFIGURED - both effective DISABLED", async () => {
    await expect(new LeadRolloutGuarded({ execute: async () => 1 }, "ENTRY", () => loadLeadRolloutConfig({})).execute()).rejects.toBeInstanceOf(LeadV1RolloutDisabledError);
    await expect(new LeadRolloutGuarded({ execute: async () => 1 }, "PURCHASE", () => loadLeadRolloutConfig({ LEAD_V1_ROLLOUT_MODE: "enabled" })).execute()).rejects.toBeInstanceOf(LeadV1RolloutDisabledError);
    expect(logger.info.mock.calls.map((c) => c[1])).toEqual([
      { area: "ENTRY", mode: "DISABLED", configStatus: "DEFAULT", reason: "AREA_CLOSED" },
      { area: "PURCHASE", mode: "DISABLED", configStatus: "MISCONFIGURED", reason: "AREA_CLOSED" },
    ]);
  });

  it("a reader that throws is an unexpected enforcement failure: error level, fixed reason, still refused, error text never logged", async () => {
    const leak = "db-password-hunter2";
    const guarded = new LeadRolloutGuarded({ execute: vi.fn(async () => "x") }, "PURCHASE", () => {
      throw new Error(leak);
    });
    await expect(guarded.execute()).rejects.toBeInstanceOf(LeadV1RolloutDisabledError);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error.mock.calls[0]).toEqual(["lead_rollout.guard_blocked", { area: "PURCHASE", mode: "DISABLED", configStatus: "MISCONFIGURED", reason: "CONFIG_READER_FAILED" }]);
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(leak);
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["unknown mode", { mode: "SUPER_ENABLED-s3cr3t", status: "CONFIGURED" }],
    ["hostile mode", { mode: "constructor", status: "bogus-status-s3cr3t" }],
    ["non-string mode", { mode: ["ENABLED"], status: 7 }],
  ])("a malformed reader result (%s) is refused, reported as CONFIG_MALFORMED/UNKNOWN and the raw value is never logged", async (_label, value) => {
    const guarded = new LeadRolloutGuarded({ execute: vi.fn(async () => "x") }, "ENTRY", () => value as unknown as LeadRolloutConfig);
    await expect(guarded.execute()).rejects.toBeInstanceOf(LeadV1RolloutDisabledError);
    expect(logger.error).toHaveBeenCalledTimes(1);
    const fields = logger.error.mock.calls[0]![1] as Record<string, unknown>;
    expect(fields.reason).toBe("CONFIG_MALFORMED");
    expect(fields.mode).toBe("UNKNOWN");
    expect(Object.keys(fields).sort()).toEqual(FIELD_KEYS);
    expect(JSON.stringify(logger.error.mock.calls)).not.toMatch(/s3cr3t|constructor|SUPER_ENABLED/);
  });

  it("the arguments of the refused call (personal data, descriptions, tokens) never reach the logger", async () => {
    const inner = { execute: vi.fn(async (..._a: unknown[]) => "x") };
    const guarded = new LeadRolloutGuarded(inner, "ENTRY", () => cfg("DISABLED"));
    await expect(
      guarded.execute("user-5f1c", { description: "Mi casa en Calle Mayor 5, llamar al 600123456", email: "ana@example.com", token: "tok_live_abc" }),
    ).rejects.toBeInstanceOf(LeadV1RolloutDisabledError);
    const logged = JSON.stringify([...logger.info.mock.calls, ...logger.warn.mock.calls, ...logger.error.mock.calls]);
    for (const needle of ["user-5f1c", "Calle Mayor", "600123456", "ana@example.com", "tok_live_abc"]) expect(logged).not.toContain(needle);
    expect(inner.execute).not.toHaveBeenCalled();
  });
});

describe("M160 - logging failures never change business behaviour", () => {
  const boom = () => {
    throw new Error("log transport down");
  };

  it("a logger that throws on every level still yields the SAME refusal (same class, same message, no extra error)", async () => {
    logger.info.mockImplementation(boom);
    logger.error.mockImplementation(boom);
    const closed = new LeadRolloutGuarded({ execute: vi.fn(async () => "x") }, "ENTRY", () => cfg("DISABLED"));
    const err = await closed.execute().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LeadV1RolloutDisabledError);
    expect((err as LeadV1RolloutDisabledError).code).toBe("LEAD_V1_ROLLOUT_DISABLED");
    expect((err as Error).message).toBe("This feature is not available right now.");

    const broken = new LeadRolloutGuarded({ execute: vi.fn(async () => "x") }, "ENTRY", () => {
      throw new Error("x");
    });
    await expect(broken.execute()).rejects.toBeInstanceOf(LeadV1RolloutDisabledError);
  });

  it("an open area is unaffected by a broken logger, and the wrapped use case's own errors still propagate unchanged", async () => {
    logger.info.mockImplementation(boom);
    logger.error.mockImplementation(boom);
    logger.warn.mockImplementation(boom);
    const ok = new LeadRolloutGuarded({ execute: async () => "result" }, "ENTRY", () => cfg("ENABLED"));
    await expect(ok.execute()).resolves.toBe("result");
    const businessError = new Error("business rule");
    const failing = new LeadRolloutGuarded({ execute: async () => Promise.reject(businessError) }, "PURCHASE", () => cfg("ENABLED"));
    await expect(failing.execute()).rejects.toBe(businessError);
  });

  it("the loader still fails closed when the logger throws while reporting a misconfiguration", () => {
    logger.warn.mockImplementation(boom);
    logger.error.mockImplementation(boom);
    expect(loadLeadRolloutConfig({ LEAD_V1_ROLLOUT_MODE: "typo" })).toEqual({ mode: "DISABLED", status: "MISCONFIGURED" });
  });
});
