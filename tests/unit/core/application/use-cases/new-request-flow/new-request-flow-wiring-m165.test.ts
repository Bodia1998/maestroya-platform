import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// No database, Stripe or network: the category repository and the pilot configuration are replaced by in-memory stand-ins; a call
// that is LET THROUGH reaches the real legacy use case, which then fails against the inert prisma stub - exactly the pass-through
// signal this file needs (it is never mistaken for the refusal, which is a specific error class).
vi.mock("@/infrastructure/database/prisma/client", () => ({ prisma: {} }));
vi.mock("@/infrastructure/payments/stripe/client", () => ({ stripe: {} }));
vi.mock("@/infrastructure/observability/logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const state = vi.hoisted(() => ({
  reads: 0,
  pilot: { status: "VALID", config: { pilotCategorySlugs: ["fontaneria"], leadPricing: { unsupportedCategorySlugs: [] as string[] } } } as { status: string; config?: unknown },
}));
const ELIGIBLE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const RECORDS = [
  { id: ELIGIBLE_ID, name: "Fontanería", slug: "fontaneria", parentSlug: null },
  { id: OTHER_ID, name: "Pintura", slug: "pintura", parentSlug: null },
];

vi.mock("@/infrastructure/database/prisma/repositories/prisma-lead-request-category-repository", () => ({
  PrismaLeadRequestCategoryRepository: class {
    async listActive() {
      state.reads += 1;
      return RECORDS;
    }
    async findActiveById(id: string) {
      state.reads += 1;
      return RECORDS.find((r) => r.id === id) ?? null;
    }
  },
}));
vi.mock("@/application/use-cases/lead-publication/compose", () => ({ resolveLeadPublicationConfiguration: () => state.pilot }));

import { makeCreateServiceRequestUseCase } from "@/application/use-cases/service-request/compose";
import { makeNewRequestFlowSelector } from "@/application/use-cases/new-request-flow/compose";
import { LegacyRequestCreationGuarded } from "@/application/use-cases/new-request-flow/legacy-request-creation-guard";
import { LEAD_ROLLOUT_MODES, type LeadRolloutMode } from "@/domain/services/lead-rollout";
import { LegacyRequestCreationRedirectedError } from "@/domain/services/new-request-flow";

const USER = "11111111-1111-4111-8111-111111111111";
const input = (categoryId: string) => ({ title: "Leaky tap", description: "Kitchen tap leaks badly", categoryId, location: { line1: "x", city: "Madrid", postalCode: "28001", country: "ES" } });

const originalMode = process.env.LEAD_V1_ROLLOUT_MODE;
beforeEach(() => {
  delete process.env.LEAD_V1_ROLLOUT_MODE;
  state.reads = 0;
  state.pilot = { status: "VALID", config: { pilotCategorySlugs: ["fontaneria"], leadPricing: { unsupportedCategorySlugs: [] } } };
});
afterEach(() => {
  if (originalMode === undefined) delete process.env.LEAD_V1_ROLLOUT_MODE;
  else process.env.LEAD_V1_ROLLOUT_MODE = originalMode;
});

async function refused(categoryId: string): Promise<boolean> {
  try {
    await makeCreateServiceRequestUseCase().execute(USER, input(categoryId) as never);
  } catch (error) {
    return error instanceof LegacyRequestCreationRedirectedError;
  }
  return false;
}

const ENTRY_OPEN: Record<LeadRolloutMode, boolean> = { DISABLED: false, ENTRY_ONLY: true, PURCHASE_ONLY: false, ENABLED: true };

describe("M165 - the legacy creation entry point (production factory) follows the M159 ENTRY area", () => {
  it("is the cutover guard", () => {
    expect(makeCreateServiceRequestUseCase()).toBeInstanceOf(LegacyRequestCreationGuarded);
  });

  it("with NO configuration (default DISABLED) the legacy path is untouched and nothing is read", async () => {
    expect(await refused(ELIGIBLE_ID)).toBe(false);
    expect(await refused(OTHER_ID)).toBe(false);
    expect(state.reads).toBe(0);
  });

  it.each(["enabled", "true", " ENABLED", "1", "ALL"])("malformed rollout value %j keeps the legacy path untouched (fail safe, never towards LEAD_V1)", async (value) => {
    process.env.LEAD_V1_ROLLOUT_MODE = value;
    expect(await refused(ELIGIBLE_ID)).toBe(false);
    expect(state.reads).toBe(0);
  });

  for (const mode of LEAD_ROLLOUT_MODES) {
    it(`${mode}: an eligible category is refused by the legacy path exactly when ENTRY is open; a non-pilot category never is`, async () => {
      process.env.LEAD_V1_ROLLOUT_MODE = mode;
      expect(await refused(ELIGIBLE_ID), `eligible under ${mode}`).toBe(ENTRY_OPEN[mode]);
      expect(await refused(OTHER_ID), `non-pilot under ${mode}`).toBe(false);
    });
  }

  it("an invalid / missing pilot configuration never refuses legacy creation (nothing is eligible)", async () => {
    process.env.LEAD_V1_ROLLOUT_MODE = "ENABLED";
    state.pilot = { status: "INVALID" };
    expect(await refused(ELIGIBLE_ID)).toBe(false);
  });

  it("a factory built BEFORE the switch changed obeys the CURRENT value", async () => {
    const useCase = makeCreateServiceRequestUseCase();
    const attempt = async () => {
      try {
        await useCase.execute(USER, input(ELIGIBLE_ID) as never);
      } catch (error) {
        return error instanceof LegacyRequestCreationRedirectedError;
      }
      return false;
    };
    process.env.LEAD_V1_ROLLOUT_MODE = "ENABLED";
    const open = await attempt();
    process.env.LEAD_V1_ROLLOUT_MODE = "DISABLED";
    const closed = await attempt();
    expect([open, closed]).toEqual([true, false]);
  });

  it("selector wiring: DISABLED/PURCHASE_ONLY => LEGACY, ENTRY_ONLY/ENABLED => LEAD_V1 for a pilot category", async () => {
    for (const mode of LEAD_ROLLOUT_MODES) {
      process.env.LEAD_V1_ROLLOUT_MODE = mode;
      expect((await makeNewRequestFlowSelector().forCategory(ELIGIBLE_ID)).flow).toBe(ENTRY_OPEN[mode] ? "LEAD_V1" : "LEGACY_QUOTE_PAYMENT");
    }
  });
});
