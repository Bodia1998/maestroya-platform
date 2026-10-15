import { describe, expect, it, vi } from "vitest";

vi.mock("@/infrastructure/observability/logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import type { LeadRequestCategoryRecord, LeadRequestCategoryRepository } from "@/domain/repositories/lead-request-category-repository";
import { leadRequestCategoryPolicyFrom, type LeadRequestCategoryPolicy } from "@/domain/services/lead-request-category-support";
import { LEAD_ROLLOUT_MODES, isLeadRolloutAreaOpen, parseLeadRolloutConfig, type LeadRolloutMode } from "@/domain/services/lead-rollout";
import { LegacyRequestCreationRedirectedError } from "@/domain/services/new-request-flow";
import { LegacyRequestCreationGuarded } from "@/application/use-cases/new-request-flow/legacy-request-creation-guard";
import { NewRequestFlowSelector } from "@/application/use-cases/new-request-flow/new-request-flow-selector";

const ELIGIBLE: LeadRequestCategoryRecord = { id: "c-elig", name: "Fontanería", slug: "fontaneria", parentSlug: null };
const ELIGIBLE_CHILD: LeadRequestCategoryRecord = { id: "c-child", name: "Grifos", slug: "grifos", parentSlug: "fontaneria" };
const OTHER: LeadRequestCategoryRecord = { id: "c-other", name: "Pintura", slug: "pintura", parentSlug: null };
const EXCLUDED: LeadRequestCategoryRecord = { id: "c-excl", name: "Reformas", slug: "reformas", parentSlug: null };
const ALL = [ELIGIBLE, ELIGIBLE_CHILD, OTHER, EXCLUDED];

const VALID_POLICY = leadRequestCategoryPolicyFrom({
  status: "VALID",
  config: { pilotCategorySlugs: ["fontaneria", "reformas"], leadPricing: { unsupportedCategorySlugs: ["reformas"] } },
});

function repo(records: LeadRequestCategoryRecord[] = ALL) {
  const calls = { listActive: 0, findActiveById: 0 };
  const impl: LeadRequestCategoryRepository = {
    listActive: async () => {
      calls.listActive += 1;
      return records;
    },
    findActiveById: async (id) => {
      calls.findActiveById += 1;
      return records.find((r) => r.id === id) ?? null;
    },
  };
  return { impl, calls };
}

/** The real M159 reading of a raw env value: the selector's `readEntryOpen` is derived exactly like production does it. */
const entryOpenFor = (raw: unknown) => () => isLeadRolloutAreaOpen(parseLeadRolloutConfig(raw).mode, "ENTRY");

describe("M165 - NewRequestFlowSelector follows the M159 modes without bypassing them", () => {
  const EXPECT_LEAD_V1: Record<LeadRolloutMode, boolean> = { DISABLED: false, ENTRY_ONLY: true, PURCHASE_ONLY: false, ENABLED: true };

  it.each(LEAD_ROLLOUT_MODES)("mode %s: an eligible category defaults to LEAD_V1 only if the ENTRY area is open", async (mode) => {
    const { impl } = repo();
    const selector = new NewRequestFlowSelector(impl, () => VALID_POLICY, entryOpenFor(mode));
    const decision = await selector.forCategory(ELIGIBLE.id);
    expect(decision.flow).toBe(EXPECT_LEAD_V1[mode] ? "LEAD_V1" : "LEGACY_QUOTE_PAYMENT");
  });

  it.each([undefined, "", "enabled", "true", " ENABLED", "1", 5, null])("default / misconfigured value %j fails safe to LEGACY and reads nothing", async (raw) => {
    const { impl, calls } = repo();
    const selector = new NewRequestFlowSelector(impl, () => VALID_POLICY, entryOpenFor(raw));
    expect((await selector.forCategory(ELIGIBLE.id)).flow).toBe("LEGACY_QUOTE_PAYMENT");
    expect((await selector.forEntry()).flow).toBe("LEGACY_QUOTE_PAYMENT");
    expect(await selector.legacyCategoryIds()).toBeNull();
    expect(calls).toEqual({ listActive: 0, findActiveById: 0 });
  });

  it("a throwing / garbage switch reader is DISABLED, never open", async () => {
    for (const readEntryOpen of [
      () => {
        throw new Error("env unreadable");
      },
      () => "true" as unknown as boolean,
      () => 1 as unknown as boolean,
    ]) {
      const { impl, calls } = repo();
      const selector = new NewRequestFlowSelector(impl, () => VALID_POLICY, readEntryOpen);
      expect((await selector.forCategory(ELIGIBLE.id)).flow).toBe("LEGACY_QUOTE_PAYMENT");
      expect(calls.findActiveById).toBe(0);
    }
  });

  it("the switch is read on EVERY call: a cached selector obeys a switch that flips at runtime", async () => {
    let open = false;
    const { impl } = repo();
    const selector = new NewRequestFlowSelector(impl, () => VALID_POLICY, () => open);
    expect((await selector.forCategory(ELIGIBLE.id)).flow).toBe("LEGACY_QUOTE_PAYMENT");
    open = true;
    expect((await selector.forCategory(ELIGIBLE.id)).flow).toBe("LEAD_V1");
    open = false;
    expect((await selector.forCategory(ELIGIBLE.id)).flow).toBe("LEGACY_QUOTE_PAYMENT");
  });
});

describe("M165 - eligibility is the M132 pilot policy, with no second category list", () => {
  const open = () => true;

  it("eligible slug and subcategory of an eligible parent => LEAD_V1; other / excluded / unknown / inactive => LEGACY", async () => {
    const { impl } = repo();
    const selector = new NewRequestFlowSelector(impl, () => VALID_POLICY, open);
    expect((await selector.forCategory(ELIGIBLE.id)).flow).toBe("LEAD_V1");
    expect((await selector.forCategory(ELIGIBLE_CHILD.id)).flow).toBe("LEAD_V1");
    expect(await selector.forCategory(OTHER.id)).toEqual({ flow: "LEGACY_QUOTE_PAYMENT", reason: "CATEGORY_NOT_ELIGIBLE" });
    expect((await selector.forCategory(EXCLUDED.id)).flow).toBe("LEGACY_QUOTE_PAYMENT");
    expect((await selector.forCategory("does-not-exist")).flow).toBe("LEGACY_QUOTE_PAYMENT");
  });

  it("a pilot configuration that cannot be resolved makes NOTHING eligible (legacy continues), and a throwing reader is the same", async () => {
    const invalid = leadRequestCategoryPolicyFrom({ status: "INVALID" });
    for (const readPolicy of [
      () => invalid,
      () => {
        throw new Error("config unreadable");
      },
    ]) {
      const { impl } = repo();
      const selector = new NewRequestFlowSelector(impl, readPolicy, open);
      expect((await selector.forCategory(ELIGIBLE.id)).flow).toBe("LEGACY_QUOTE_PAYMENT");
      expect((await selector.forEntry()).flow).toBe("LEGACY_QUOTE_PAYMENT");
      expect([...(await selector.legacyCategoryIds())!].sort()).toEqual(ALL.map((c) => c.id).sort());
    }
  });

  it("forEntry (no category chosen): LEAD_V1 iff at least one active category is eligible", async () => {
    expect((await new NewRequestFlowSelector(repo().impl, () => VALID_POLICY, open).forEntry()).flow).toBe("LEAD_V1");
    expect((await new NewRequestFlowSelector(repo([OTHER, EXCLUDED]).impl, () => VALID_POLICY, open).forEntry()).flow).toBe("LEGACY_QUOTE_PAYMENT");
    expect((await new NewRequestFlowSelector(repo([]).impl, () => VALID_POLICY, open).forEntry()).flow).toBe("LEGACY_QUOTE_PAYMENT");
  });

  it("legacyCategoryIds is the exact complement of the eligible set while the area is open", async () => {
    const selector = new NewRequestFlowSelector(repo().impl, () => VALID_POLICY, open);
    expect([...(await selector.legacyCategoryIds())!].sort()).toEqual([OTHER.id, EXCLUDED.id].sort());
  });

  it("an infrastructure failure is NOT swallowed into a guessed flow", async () => {
    const failing: LeadRequestCategoryRepository = {
      listActive: async () => {
        throw new Error("db down");
      },
      findActiveById: async () => {
        throw new Error("db down");
      },
    };
    const selector = new NewRequestFlowSelector(failing, () => VALID_POLICY, open);
    await expect(selector.forCategory(ELIGIBLE.id)).rejects.toThrow("db down");
    await expect(selector.forEntry()).rejects.toThrow("db down");
    await expect(selector.legacyCategoryIds()).rejects.toThrow("db down");
  });
});

describe("M165 - retries, duplicate submissions and concurrency keep one flow", () => {
  it("N concurrent and repeated selections for the same state are identical (no hidden state, nothing written)", async () => {
    const { impl } = repo();
    const selector = new NewRequestFlowSelector(impl, () => VALID_POLICY, () => true);
    const results = await Promise.all(Array.from({ length: 50 }, () => selector.forCategory(ELIGIBLE.id)));
    expect(new Set(results.map((r) => r.flow))).toEqual(new Set(["LEAD_V1"]));
    // the repository port the selector holds has read methods only
    expect(Object.keys(impl).sort()).toEqual(["findActiveById", "listActive"]);
  });

  it("a burst under a flipping switch only ever yields a documented flow for each observed state (never a mixed/invalid value)", async () => {
    let open = true;
    const selector = new NewRequestFlowSelector(repo().impl, () => VALID_POLICY, () => open);
    const out = await Promise.all(
      Array.from({ length: 40 }, async (_, i) => {
        open = i % 2 === 0;
        return (await selector.forCategory(ELIGIBLE.id)).flow;
      }),
    );
    for (const flow of out) expect(["LEAD_V1", "LEGACY_QUOTE_PAYMENT"]).toContain(flow);
  });
});

describe("M165 - LegacyRequestCreationGuarded", () => {
  const USER = "11111111-1111-4111-8111-111111111111";
  const input = (categoryId: string) => ({ title: "t", description: "d", categoryId });

  function build(open: boolean) {
    const inner = { execute: vi.fn(async (_userId: string, _input: { categoryId: string }) => ({ id: "legacy-request" })) };
    const { impl, calls } = repo();
    const selector = new NewRequestFlowSelector(impl, () => VALID_POLICY, () => open);
    return { inner, calls, guarded: new LegacyRequestCreationGuarded(inner, selector) };
  }

  it("area open + eligible category: refused with the redirect error and the legacy use case is never called", async () => {
    const { inner, guarded } = build(true);
    await expect(guarded.execute(USER, input(ELIGIBLE.id))).rejects.toBeInstanceOf(LegacyRequestCreationRedirectedError);
    expect(inner.execute).not.toHaveBeenCalled();
  });

  it("area open + non-eligible category: explicit legacy behaviour is intact (same arguments, same result)", async () => {
    const { inner, guarded } = build(true);
    const args = [USER, input(OTHER.id)] as [string, { categoryId: string }];
    await expect(guarded.execute(...args)).resolves.toEqual({ id: "legacy-request" });
    expect(inner.execute).toHaveBeenCalledWith(...args);
  });

  it("area closed (default): pass-through for every category, and the category tables are not even read", async () => {
    const { inner, calls, guarded } = build(false);
    for (const c of ALL) await expect(guarded.execute(USER, input(c.id))).resolves.toEqual({ id: "legacy-request" });
    expect(inner.execute).toHaveBeenCalledTimes(ALL.length);
    expect(calls).toEqual({ listActive: 0, findActiveById: 0 });
  });

  it("errors of the wrapped legacy use case are returned unchanged", async () => {
    const boom = new Error("legacy validation");
    const guarded = new LegacyRequestCreationGuarded(
      { execute: async (_u: string, _i: { categoryId: string }): Promise<never> => { throw boom; } },
      new NewRequestFlowSelector(repo().impl, () => VALID_POLICY, () => false),
    );
    await expect(guarded.execute(USER, input(OTHER.id))).rejects.toBe(boom);
  });

  it("a selector infrastructure failure refuses the call instead of creating a request on a guessed flow", async () => {
    const inner = { execute: vi.fn(async (_u: string, _i: { categoryId: string }) => ({ id: "x" })) };
    const failing: LeadRequestCategoryRepository = { listActive: async () => [], findActiveById: async () => { throw new Error("db down"); } };
    const guarded = new LegacyRequestCreationGuarded(inner, new NewRequestFlowSelector(failing, () => VALID_POLICY, () => true));
    await expect(guarded.execute(USER, input(ELIGIBLE.id))).rejects.toThrow("db down");
    expect(inner.execute).not.toHaveBeenCalled();
  });
});

describe("M165 - type-level sanity", () => {
  it("LeadRequestCategoryPolicy fixtures are plain data", () => {
    const p: LeadRequestCategoryPolicy = VALID_POLICY;
    expect(p.supportedSlugs.has("fontaneria")).toBe(true);
    expect(p.unsupportedSlugs.has("reformas")).toBe(true);
  });
});
