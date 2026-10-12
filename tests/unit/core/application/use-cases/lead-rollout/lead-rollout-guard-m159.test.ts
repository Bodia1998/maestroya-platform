import { describe, expect, it, vi } from "vitest";

import { LeadRolloutGuarded, assertLeadRolloutAreaOpen } from "@/application/use-cases/lead-rollout/lead-rollout-guard";
import { guardLeadV1Entry, guardLeadV1Purchase, getLeadRolloutStatus } from "@/application/use-cases/lead-rollout/compose";
import { AccountRestrictedError, ValidationError } from "@/domain/errors/domain-error";
import {
  LEAD_ROLLOUT_AREAS,
  LEAD_ROLLOUT_MODES,
  LeadV1RolloutDisabledError,
  parseLeadRolloutConfig,
  type LeadRolloutArea,
  type LeadRolloutConfig,
  type LeadRolloutMode,
} from "@/domain/services/lead-rollout";

const cfg = (mode: LeadRolloutMode): LeadRolloutConfig => ({ mode, status: "CONFIGURED" });
const OPEN: Record<LeadRolloutMode, LeadRolloutArea[]> = { DISABLED: [], ENTRY_ONLY: ["ENTRY"], PURCHASE_ONLY: ["PURCHASE"], ENABLED: ["ENTRY", "PURCHASE"] };

describe("M159 — guard: every mode x area", () => {
  for (const mode of LEAD_ROLLOUT_MODES) {
    for (const area of LEAD_ROLLOUT_AREAS) {
      const open = OPEN[mode].includes(area);
      it(`${mode} / ${area}: ${open ? "passes the call through unchanged" : "refuses and never calls the wrapped use case"}`, async () => {
        const inner = { execute: vi.fn(async (userId: string, input: { a: number }, extra?: string) => ({ userId, input, extra })) };
        const guarded = new LeadRolloutGuarded(inner, area, () => cfg(mode));
        const input = { a: 1 };
        if (open) {
          await expect(guarded.execute("u1", input, "x")).resolves.toEqual({ userId: "u1", input, extra: "x" });
          expect(inner.execute).toHaveBeenCalledTimes(1);
          expect(inner.execute.mock.calls[0]![1]).toBe(input);
        } else {
          await expect(guarded.execute("u1", input, "x")).rejects.toBeInstanceOf(LeadV1RolloutDisabledError);
          expect(inner.execute).not.toHaveBeenCalled();
        }
      });
    }
  }
});

describe("M159 — guard: fail-safe behaviour", () => {
  it("a missing / malformed configuration (as parsed from the environment) refuses every area", async () => {
    for (const raw of [undefined, "", "enabled", "true", " ENABLED", 1, {}]) {
      for (const area of LEAD_ROLLOUT_AREAS) {
        const inner = { execute: vi.fn(async () => "done") };
        await expect(new LeadRolloutGuarded(inner, area, () => parseLeadRolloutConfig(raw)).execute()).rejects.toBeInstanceOf(LeadV1RolloutDisabledError);
        expect(inner.execute).not.toHaveBeenCalled();
      }
    }
  });

  it.each([
    ["throws", () => { throw new Error("config store down"); }],
    ["returns undefined", () => undefined],
    ["returns null", () => null],
    ["returns an unknown mode", () => ({ mode: "SUPER_ENABLED", status: "CONFIGURED" })],
    ["returns a hostile mode", () => ({ mode: "constructor", status: "CONFIGURED" })],
  ])("a reader that %s refuses (fails closed) and is never fatal", async (_label, reader) => {
    for (const area of LEAD_ROLLOUT_AREAS) {
      const inner = { execute: vi.fn(async () => "done") };
      await expect(new LeadRolloutGuarded(inner, area, reader as unknown as () => LeadRolloutConfig).execute()).rejects.toBeInstanceOf(LeadV1RolloutDisabledError);
      expect(inner.execute).not.toHaveBeenCalled();
    }
  });

  it("an unknown area is closed even when everything is ENABLED", () => {
    expect(() => assertLeadRolloutAreaOpen("BOGUS" as LeadRolloutArea, () => cfg("ENABLED"))).toThrow(LeadV1RolloutDisabledError);
  });

  it("the refusal is identical for every blocked area and mode (uniform, no information leak)", async () => {
    const seen = new Set<string>();
    for (const [mode, area] of [["DISABLED", "ENTRY"], ["DISABLED", "PURCHASE"], ["ENTRY_ONLY", "PURCHASE"], ["PURCHASE_ONLY", "ENTRY"]] as const) {
      const error = (await new LeadRolloutGuarded({ execute: async () => 1 }, area, () => cfg(mode)).execute().then(
        () => null,
        (e: unknown) => e,
      )) as LeadV1RolloutDisabledError;
      seen.add(`${error.name}|${error.code}|${error.message}`);
    }
    expect(seen.size).toBe(1);
  });
});

describe("M159 — guard: pass-through fidelity (it adds no behaviour of its own)", () => {
  it("returns the wrapped use case's errors unchanged: the other gates still decide when the area is open", async () => {
    for (const error of [new AccountRestrictedError(), new ValidationError("bad"), new Error("db")]) {
      const guarded = new LeadRolloutGuarded({ execute: async () => { throw error; } }, "ENTRY", () => cfg("ENABLED"));
      await expect(guarded.execute()).rejects.toBe(error);
    }
  });

  it("opening an area grants nothing: a wrapped authorization refusal is still the caller's outcome", async () => {
    const inner = { execute: vi.fn(async () => { throw new AccountRestrictedError(); }) };
    await expect(new LeadRolloutGuarded(inner, "PURCHASE", () => cfg("ENABLED")).execute()).rejects.toBeInstanceOf(AccountRestrictedError);
  });

  it("the configuration is read on EVERY call: flipping the switch between calls takes effect immediately", async () => {
    let mode: LeadRolloutMode = "ENABLED";
    const inner = { execute: vi.fn(async () => "ok") };
    const guarded = new LeadRolloutGuarded(inner, "ENTRY", () => cfg(mode));
    await expect(guarded.execute()).resolves.toBe("ok");
    mode = "DISABLED";
    await expect(guarded.execute()).rejects.toBeInstanceOf(LeadV1RolloutDisabledError);
    mode = "PURCHASE_ONLY";
    await expect(guarded.execute()).rejects.toBeInstanceOf(LeadV1RolloutDisabledError);
    mode = "ENTRY_ONLY";
    await expect(guarded.execute()).resolves.toBe("ok");
    expect(inner.execute).toHaveBeenCalledTimes(2);
  });

  it("holds no shared state: a burst of concurrent calls is decided one by one, each against the configuration it read", async () => {
    let mode: LeadRolloutMode = "ENABLED";
    const inner = { execute: vi.fn(async (n: number) => { await Promise.resolve(); return n; }) };
    const guarded = new LeadRolloutGuarded(inner, "PURCHASE", () => cfg(mode));
    const first = Array.from({ length: 25 }, (_, i) => guarded.execute(i));
    mode = "DISABLED"; // flipped while the first burst is still in flight: those calls were already admitted
    const second = Array.from({ length: 25 }, (_, i) => guarded.execute(100 + i));
    const [a, b] = await Promise.all([Promise.allSettled(first), Promise.allSettled(second)]);
    expect(a.every((r) => r.status === "fulfilled")).toBe(true);
    expect(b.every((r) => r.status === "rejected" && r.reason instanceof LeadV1RolloutDisabledError)).toBe(true);
    expect(inner.execute).toHaveBeenCalledTimes(25);
  });
});

describe("M159 — compose helpers", () => {
  it("always wrap (no 'OFF returns the original object' shortcut): the safe state is the enforced one", () => {
    const inner = { execute: async () => 1 };
    expect(guardLeadV1Entry(inner, () => cfg("ENABLED"))).toBeInstanceOf(LeadRolloutGuarded);
    expect(guardLeadV1Purchase(inner, () => cfg("DISABLED"))).toBeInstanceOf(LeadRolloutGuarded);
    expect(guardLeadV1Entry(inner)).not.toBe(inner);
  });

  it("the default reader is the environment (DISABLED when unset)", async () => {
    await expect(guardLeadV1Entry({ execute: async () => 1 }).execute()).rejects.toBeInstanceOf(LeadV1RolloutDisabledError);
    await expect(guardLeadV1Purchase({ execute: async () => 1 }).execute()).rejects.toBeInstanceOf(LeadV1RolloutDisabledError);
  });

  it("the admin status view reflects the effective state", () => {
    expect(getLeadRolloutStatus(() => cfg("ENTRY_ONLY"))).toEqual({ mode: "ENTRY_ONLY", status: "CONFIGURED", entryOpen: true, purchaseOpen: false });
    expect(getLeadRolloutStatus(() => parseLeadRolloutConfig("nope"))).toMatchObject({ mode: "DISABLED", status: "MISCONFIGURED", entryOpen: false, purchaseOpen: false });
  });
});
