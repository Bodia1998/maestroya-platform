import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// No database and no Stripe call is made: a REFUSED call never reaches a collaborator, and a call that is let through fails (or
// returns) inside the wrapped use case against these inert stand-ins — which is exactly the pass-through this file needs to observe.
vi.mock("@/infrastructure/database/prisma/client", () => ({ prisma: {} }));
vi.mock("@/infrastructure/payments/stripe/client", () => ({ stripe: {} }));
vi.mock("@/infrastructure/observability/logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { LeadRolloutGuarded } from "@/application/use-cases/lead-rollout/lead-rollout-guard";
import { makeInitiateLeadFeePaymentUseCase, makeProcessLeadFeePaymentWebhookUseCase } from "@/application/use-cases/lead-fee-payment/compose";
import { makeConfirmLeadPurchaseUseCase, makeInitiateLeadPurchaseUseCase, makeTransitionLeadPurchaseUseCase } from "@/application/use-cases/lead-purchase/compose";
import { makeSubmitLeadRequestUseCase } from "@/application/use-cases/lead-request/compose";
import {
  makeCreateLeadUseCase,
  makeCreateLeadV1ServiceRequestUseCase,
  makeGetLeadFeedForProfessionalUseCase,
  makeGetPublishedLeadPreviewUseCase,
  makeGetPublishedLeadPreviewsForProfessionalUseCase,
  makePublishLeadUseCase,
} from "@/application/use-cases/lead/compose";
import { makeGetLeadPurchaseCheckoutUseCase } from "@/application/use-cases/lead-checkout/compose";
import { makeGetLeadContactUseCase } from "@/application/use-cases/lead-contact/compose";
import { LEAD_ROLLOUT_MODES, LeadV1RolloutDisabledError, type LeadRolloutArea, type LeadRolloutMode } from "@/domain/services/lead-rollout";

const USER = "11111111-1111-4111-8111-111111111111";
const LEAD = "22222222-2222-4222-8222-222222222222";
const REQUEST_INPUT = { title: "x", description: "y", categoryId: "c" };

type Executable = { execute: (...args: never[]) => Promise<unknown> };
interface Entry {
  name: string;
  area: LeadRolloutArea;
  make: () => Executable;
  args: unknown[];
}

/** Every production factory that STARTS new LEAD_V1 activity, with the area that must govern it. */
const GUARDED: Entry[] = [
  { name: "makeSubmitLeadRequestUseCase", area: "ENTRY", make: () => makeSubmitLeadRequestUseCase() as never, args: [USER, REQUEST_INPUT, {}] },
  { name: "makeCreateLeadV1ServiceRequestUseCase", area: "ENTRY", make: () => makeCreateLeadV1ServiceRequestUseCase() as never, args: [USER, REQUEST_INPUT] },
  { name: "makeCreateLeadUseCase", area: "ENTRY", make: () => makeCreateLeadUseCase() as never, args: [USER, LEAD] },
  { name: "makePublishLeadUseCase", area: "ENTRY", make: () => makePublishLeadUseCase() as never, args: [USER, LEAD] },
  { name: "makeGetLeadFeedForProfessionalUseCase", area: "PURCHASE", make: () => makeGetLeadFeedForProfessionalUseCase() as never, args: [USER, {}] },
  { name: "makeGetPublishedLeadPreviewsForProfessionalUseCase", area: "PURCHASE", make: () => makeGetPublishedLeadPreviewsForProfessionalUseCase() as never, args: [USER] },
  { name: "makeInitiateLeadPurchaseUseCase", area: "PURCHASE", make: () => makeInitiateLeadPurchaseUseCase() as never, args: [USER, LEAD] },
  { name: "makeInitiateLeadFeePaymentUseCase", area: "PURCHASE", make: () => makeInitiateLeadFeePaymentUseCase() as never, args: [USER, LEAD] },
];

const OPEN: Record<LeadRolloutMode, LeadRolloutArea[]> = { DISABLED: [], ENTRY_ONLY: ["ENTRY"], PURCHASE_ONLY: ["PURCHASE"], ENABLED: ["ENTRY", "PURCHASE"] };

async function blocked(make: () => Executable, args: unknown[]): Promise<boolean> {
  try {
    await (make().execute as (...a: unknown[]) => Promise<unknown>)(...args);
  } catch (error) {
    return error instanceof LeadV1RolloutDisabledError;
  }
  return false;
}

const original = process.env.LEAD_V1_ROLLOUT_MODE;
beforeEach(() => {
  delete process.env.LEAD_V1_ROLLOUT_MODE;
});
afterEach(() => {
  if (original === undefined) delete process.env.LEAD_V1_ROLLOUT_MODE;
  else process.env.LEAD_V1_ROLLOUT_MODE = original;
});

describe("M159 — every entry point that starts new LEAD_V1 activity is guarded at its composition root", () => {
  it.each(GUARDED)("$name is a rollout guard for the $area area", ({ make }) => {
    expect(make()).toBeInstanceOf(LeadRolloutGuarded);
  });

  it.each(GUARDED)("$name: with NO configuration the call is refused (safe default)", async ({ make, args }) => {
    expect(await blocked(make, args)).toBe(true);
  });

  it.each(["enabled", "true", " ENABLED", "1", "ALL", "ENTRY"])("with the malformed value %j every guarded entry point is refused", async (value) => {
    process.env.LEAD_V1_ROLLOUT_MODE = value;
    for (const entry of GUARDED) expect(await blocked(entry.make, entry.args), entry.name).toBe(true);
  });

  for (const mode of LEAD_ROLLOUT_MODES) {
    it(`${mode}: each entry point is refused exactly when its area is closed`, async () => {
      process.env.LEAD_V1_ROLLOUT_MODE = mode;
      for (const entry of GUARDED) {
        expect(await blocked(entry.make, entry.args), `${entry.name} under ${mode}`).toBe(!OPEN[mode].includes(entry.area));
      }
    });
  }

  it("a factory built BEFORE the switch changed still obeys the CURRENT value (a cached use case cannot go stale)", async () => {
    const submit = makeSubmitLeadRequestUseCase();
    const purchase = makeInitiateLeadPurchaseUseCase();
    process.env.LEAD_V1_ROLLOUT_MODE = "ENABLED";
    const open = [await blocked(() => submit as never, GUARDED[0]!.args), await blocked(() => purchase as never, [USER, LEAD])];
    process.env.LEAD_V1_ROLLOUT_MODE = "DISABLED";
    const closed = [await blocked(() => submit as never, GUARDED[0]!.args), await blocked(() => purchase as never, [USER, LEAD])];
    expect(open).toEqual([false, false]);
    expect(closed).toEqual([true, true]);
  });

  it("a refused submission is refused by the outermost guard: the nested create / publish factories are guarded as well (defence in depth)", async () => {
    process.env.LEAD_V1_ROLLOUT_MODE = "PURCHASE_ONLY";
    for (const name of ["makeCreateLeadV1ServiceRequestUseCase", "makeCreateLeadUseCase", "makePublishLeadUseCase"]) {
      const entry = GUARDED.find((e) => e.name === name)!;
      expect(await blocked(entry.make, entry.args), name).toBe(true);
    }
  });
});

describe("M159 — what the switch must NEVER stop (existing rights, payments in flight, financial records)", () => {
  const UNGUARDED: Array<[string, () => unknown]> = [
    ["makeGetPublishedLeadPreviewUseCase (read by the checkout page of an existing purchase)", () => makeGetPublishedLeadPreviewUseCase()],
    ["makeGetLeadPurchaseCheckoutUseCase (the caller's own purchase state)", () => makeGetLeadPurchaseCheckoutUseCase()],
    ["makeGetLeadContactUseCase (contact for a CONFIRMED buyer, M138)", () => makeGetLeadContactUseCase()],
    ["makeConfirmLeadPurchaseUseCase (trusted lifecycle, M137)", () => makeConfirmLeadPurchaseUseCase()],
    ["makeTransitionLeadPurchaseUseCase (trusted lifecycle, M137)", () => makeTransitionLeadPurchaseUseCase()],
    ["makeProcessLeadFeePaymentWebhookUseCase (payment confirmation, M141)", () => makeProcessLeadFeePaymentWebhookUseCase()],
  ];

  it.each(UNGUARDED)("%s is not wrapped by the rollout guard", (_label, make) => {
    expect(make()).not.toBeInstanceOf(LeadRolloutGuarded);
  });

  it("in the default DISABLED state the unguarded read paths still run (they are never refused with the rollout error)", async () => {
    expect(await blocked(() => makeGetLeadPurchaseCheckoutUseCase() as never, [USER, "not-a-uuid"])).toBe(false);
    expect(await blocked(() => makeGetPublishedLeadPreviewUseCase() as never, [USER, LEAD])).toBe(false);
    expect(await blocked(() => makeGetLeadContactUseCase() as never, [USER, LEAD])).toBe(false);
  });

  it("DISABLED with a malformed value still never refuses the unguarded paths", async () => {
    process.env.LEAD_V1_ROLLOUT_MODE = "definitely-not-a-mode";
    expect(await blocked(() => makeGetLeadPurchaseCheckoutUseCase() as never, [USER, LEAD])).toBe(false);
    expect(await blocked(() => makeGetLeadContactUseCase() as never, [USER, LEAD])).toBe(false);
  });
});
