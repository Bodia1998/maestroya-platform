import { beforeEach, describe, expect, it, vi } from "vitest";

import { UnauthorizedError } from "@/domain/errors/domain-error";
import { LeadAbuseControlRejectedError } from "@/domain/services/lead-abuse-controls";
import { LeadAdminConsoleRejectedError } from "@/domain/services/lead-admin-console";
import { LeadFeeDisputeRejectedError } from "@/domain/services/lead-fee-dispute";
import { LeadQualityClaimRejectedError } from "@/domain/services/lead-quality-claim";

/**
 * Module 157 — authorization matrix of the Lead Admin Operations Console Server Actions
 * (`src/app/(dashboard)/admin/leads/actions.ts`). Same mock-`requireRole`-and-the-use-case pattern as the other admin action tests:
 * this file proves the BOUNDARY (role gate first, session actor, validation, closed error messages, delegation to the existing
 * M154 / M155 / M156 use cases). The use cases' own rules are covered by their own suites.
 */
const mockRequireRole = vi.fn();
const mockRevalidatePath = vi.fn();
const fn = () => vi.fn();
const uc = {
  listLeads: fn(), leadDetail: fn(), claims: fn(), disputes: fn(), subject: fn(),
  openFlags: fn(), startReview: fn(), decide: fn(), revoke: fn(), impose: fn(), lift: fn(),
};

vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => mockRevalidatePath(...a) }));
vi.mock("@/infrastructure/auth/rbac", () => ({
  ROLES: { ADMIN: "ADMIN", SUPER_ADMIN: "SUPER_ADMIN", SUPPORT: "SUPPORT" },
  requireRole: (...allowed: string[]) => mockRequireRole(...allowed),
}));
vi.mock("@/application/use-cases/lead-admin-console/compose", () => ({
  makeListAdminLeadsUseCase: () => ({ execute: uc.listLeads }),
  makeGetAdminLeadDetailUseCase: () => ({ execute: uc.leadDetail }),
  makeListAdminLeadClaimsUseCase: () => ({ execute: uc.claims }),
  makeListAdminLeadDisputesUseCase: () => ({ execute: uc.disputes }),
  makeGetAdminAbuseSubjectUseCase: () => ({ execute: uc.subject }),
}));
vi.mock("@/application/use-cases/lead-abuse/compose", () => ({
  makeListOpenLeadAbuseFlagsUseCase: () => ({ execute: uc.openFlags }),
  makeImposeLeadAbuseBlockUseCase: () => ({ execute: uc.impose }),
  makeLiftLeadAbuseDecisionUseCase: () => ({ execute: uc.lift }),
}));
vi.mock("@/application/use-cases/lead-fee-dispute/compose", () => ({
  makeRevokeLeadPurchaseUseCase: () => ({ execute: uc.revoke }),
}));
vi.mock("@/application/use-cases/lead-quality-claim/compose", () => ({
  makeStartLeadQualityClaimReviewUseCase: () => ({ execute: uc.startReview }),
  makeDecideLeadQualityClaimUseCase: () => ({ execute: uc.decide }),
}));

const actions = await import("../../../src/app/(dashboard)/admin/leads/actions");

const ID = (n: number) => `00000000-0000-4000-a000-${String(n).padStart(12, "0")}`;
const ADMIN = { id: ID(1), roles: ["ADMIN"] };

type Case = { name: string; mutating: boolean; useCase: keyof typeof uc; call: () => Promise<unknown> };
const CASES: Case[] = [
  { name: "listAdminLeadsAction", mutating: false, useCase: "listLeads", call: () => actions.listAdminLeadsAction({}) },
  { name: "getAdminLeadDetailAction", mutating: false, useCase: "leadDetail", call: () => actions.getAdminLeadDetailAction(ID(10)) },
  { name: "listAdminLeadClaimsAction", mutating: false, useCase: "claims", call: () => actions.listAdminLeadClaimsAction({}) },
  { name: "listAdminLeadDisputesAction", mutating: false, useCase: "disputes", call: () => actions.listAdminLeadDisputesAction({}) },
  { name: "listOpenLeadAbuseFlagsAction", mutating: false, useCase: "openFlags", call: () => actions.listOpenLeadAbuseFlagsAction() },
  { name: "getAdminAbuseSubjectAction", mutating: false, useCase: "subject", call: () => actions.getAdminAbuseSubjectAction(ID(20)) },
  { name: "startLeadClaimReviewAction", mutating: true, useCase: "startReview", call: () => actions.startLeadClaimReviewAction(ID(40)) },
  { name: "decideLeadClaimAction", mutating: true, useCase: "decide", call: () => actions.decideLeadClaimAction({ claimId: ID(40), decision: "APPROVED", explanation: "Phone number was invalid." }) },
  { name: "revokeLeadPurchaseAction", mutating: true, useCase: "revoke", call: () => actions.revokeLeadPurchaseAction({ leadPurchaseId: ID(30), explanation: "Confirmed misuse.", evidenceReference: "TICKET-1" }) },
  { name: "imposeLeadAbuseBlockAction", mutating: true, useCase: "impose", call: () => actions.imposeLeadAbuseBlockAction({ subjectUserId: ID(20), restrictedAction: "LEAD_PURCHASE_INITIATION", durationMinutes: 60, explanation: "Burst of purchases." }) },
  { name: "liftLeadAbuseDecisionAction", mutating: true, useCase: "lift", call: () => actions.liftLeadAbuseDecisionAction({ decisionId: ID(80), note: "Reviewed, false positive." }) },
];

beforeEach(() => {
  mockRequireRole.mockReset().mockResolvedValue(ADMIN);
  mockRevalidatePath.mockReset();
  for (const f of Object.values(uc)) f.mockReset().mockResolvedValue({});
});

describe("M157 actions — role gate (every read AND every mutation)", () => {
  for (const c of CASES) {
    it(`${c.name}: requireRole(ADMIN, SUPER_ADMIN) is called first, with exactly those two roles — SUPPORT is never allowed`, async () => {
      await c.call();
      expect(mockRequireRole).toHaveBeenCalledTimes(1);
      expect(mockRequireRole).toHaveBeenCalledWith("ADMIN", "SUPER_ADMIN");
      expect(mockRequireRole.mock.calls[0]).not.toContain("SUPPORT");
    });

    it(`${c.name}: a caller without the role is rejected and NO use case runs`, async () => {
      mockRequireRole.mockRejectedValue(new UnauthorizedError("You do not have permission to do that."));
      await expect(c.call()).rejects.toBeInstanceOf(UnauthorizedError);
      for (const f of Object.values(uc)) expect(f).not.toHaveBeenCalled();
      expect(mockRevalidatePath).not.toHaveBeenCalled();
    });

    it(`${c.name}: an unauthenticated caller is rejected and NO use case runs`, async () => {
      mockRequireRole.mockRejectedValue(new UnauthorizedError("You must be signed in to do that."));
      await expect(c.call()).rejects.toBeInstanceOf(UnauthorizedError);
      for (const f of Object.values(uc)) expect(f).not.toHaveBeenCalled();
    });
  }
});

describe("M157 actions — the acting administrator comes from the session only", () => {
  it("passes admin.id as the actor and never accepts an actor / role from the client payload", async () => {
    await actions.decideLeadClaimAction({ claimId: ID(40), decision: "REJECTED", explanation: "Not valid.", actorUserId: ID(99), roles: ["SUPER_ADMIN"] } as never);
    expect(uc.decide).toHaveBeenCalledWith(ADMIN.id, { claimId: ID(40), decision: "REJECTED", explanation: "Not valid." });

    await actions.revokeLeadPurchaseAction({ leadPurchaseId: ID(30), explanation: "Misuse.", evidenceReference: "T-2", actorUserId: ID(99) } as never);
    expect(uc.revoke).toHaveBeenCalledWith({ actorUserId: ADMIN.id, leadPurchaseId: ID(30), explanation: "Misuse.", evidenceReference: "T-2" });

    await actions.startLeadClaimReviewAction(ID(40));
    expect(uc.startReview).toHaveBeenCalledWith(ADMIN.id, ID(40));

    await actions.liftLeadAbuseDecisionAction({ decisionId: ID(80), note: "ok", adminUserId: ID(99) } as never);
    expect(uc.lift).toHaveBeenCalledWith(ADMIN.id, { decisionId: ID(80), note: "ok" });
  });

  it("converts the block duration to milliseconds and delegates the bounds to the M156 use case", async () => {
    await actions.imposeLeadAbuseBlockAction({ subjectUserId: ID(20), restrictedAction: "LEAD_PUBLICATION", durationMinutes: 90, explanation: "Spam." });
    expect(uc.impose).toHaveBeenCalledWith(ADMIN.id, { subjectUserId: ID(20), restrictedAction: "LEAD_PUBLICATION", durationMs: 90 * 60_000, explanation: "Spam." });
  });
});

describe("M157 actions — input validation happens before any use case", () => {
  const bad: Array<[string, () => Promise<unknown>]> = [
    ["lead id not a uuid", () => actions.getAdminLeadDetailAction("../../etc/passwd")],
    ["subject id not a uuid", () => actions.getAdminAbuseSubjectAction("1 OR 1=1")],
    ["claim id not a uuid", () => actions.startLeadClaimReviewAction("x")],
    ["decision not APPROVED/REJECTED", () => actions.decideLeadClaimAction({ claimId: ID(40), decision: "REFUNDED", explanation: "x" })],
    ["empty explanation", () => actions.decideLeadClaimAction({ claimId: ID(40), decision: "APPROVED", explanation: "   " })],
    ["explanation too long", () => actions.decideLeadClaimAction({ claimId: ID(40), decision: "APPROVED", explanation: "x".repeat(1001) })],
    ["revoke without evidence reference", () => actions.revokeLeadPurchaseAction({ leadPurchaseId: ID(30), explanation: "x", evidenceReference: "" })],
    ["revoke with a bad purchase id", () => actions.revokeLeadPurchaseAction({ leadPurchaseId: "nope", explanation: "x", evidenceReference: "T" })],
    ["block of an unknown action", () => actions.imposeLeadAbuseBlockAction({ subjectUserId: ID(20), restrictedAction: "LEAD_CONTACT", durationMinutes: 60, explanation: "x" })],
    ["block shorter than 30 minutes", () => actions.imposeLeadAbuseBlockAction({ subjectUserId: ID(20), restrictedAction: "LEAD_PUBLICATION", durationMinutes: 29, explanation: "x" })],
    ["block longer than 30 days", () => actions.imposeLeadAbuseBlockAction({ subjectUserId: ID(20), restrictedAction: "LEAD_PUBLICATION", durationMinutes: 43_201, explanation: "x" })],
    ["block with a fractional duration", () => actions.imposeLeadAbuseBlockAction({ subjectUserId: ID(20), restrictedAction: "LEAD_PUBLICATION", durationMinutes: 60.5, explanation: "x" })],
    ["lift without a note", () => actions.liftLeadAbuseDecisionAction({ decisionId: ID(80), note: "" })],
    ["list with limit 1000", () => actions.listAdminLeadsAction({ limit: 1000 })],
    ["list with an unknown status", () => actions.listAdminLeadsAction({ status: "HACKED" })],
    ["list with a negative offset", () => actions.listAdminLeadClaimsAction({ offset: -5 })],
  ];
  for (const [name, call] of bad) {
    it(`${name} -> {success:false}, no use case, no revalidation`, async () => {
      const result = (await call()) as { success: boolean; error?: string };
      expect(result.success).toBe(false);
      expect(typeof result.error).toBe("string");
      for (const f of Object.values(uc)) expect(f).not.toHaveBeenCalled();
      expect(mockRevalidatePath).not.toHaveBeenCalled();
    });
  }
});

describe("M157 actions — safe, closed error messages", () => {
  const rejections: Array<[string, unknown, string]> = [
    ["claim not authorized", new LeadQualityClaimRejectedError("ACTOR_NOT_AUTHORIZED"), "You do not have permission to do that."],
    ["claim invalid transition", new LeadQualityClaimRejectedError("INVALID_TRANSITION"), "no longer possible"],
    ["claim not found", new LeadQualityClaimRejectedError("CLAIM_NOT_FOUND"), "not found"],
    ["revoke purchase not confirmed", new LeadFeeDisputeRejectedError("PURCHASE_NOT_CONFIRMED"), "no longer possible"],
    ["abuse invalid state", new LeadAbuseControlRejectedError("INVALID_STATE"), "no longer possible"],
    ["abuse own account (generic unauthorized)", new LeadAbuseControlRejectedError("ACTOR_NOT_AUTHORIZED"), "You do not have permission to do that."],
    ["console not found", new LeadAdminConsoleRejectedError("LEAD_NOT_FOUND"), "not found"],
  ];
  for (const [name, error, fragment] of rejections) {
    it(`${name}: shows a closed message and nothing else`, async () => {
      uc.decide.mockRejectedValue(error);
      const result = (await actions.decideLeadClaimAction({ claimId: ID(40), decision: "APPROVED", explanation: "ok" })) as { success: boolean; error: string };
      expect(result.success).toBe(false);
      expect(result.error).toContain(fragment);
      expect(mockRevalidatePath).not.toHaveBeenCalled();
    });
  }

  it("never leaks an unexpected / database error to the browser", async () => {
    const secret = new Error('duplicate key value violates unique constraint "lead_abuse_decisions_one_active_block" postgres://user:pw@db');
    for (const [call, useCase] of [
      [() => actions.revokeLeadPurchaseAction({ leadPurchaseId: ID(30), explanation: "x", evidenceReference: "T" }), uc.revoke],
      [() => actions.imposeLeadAbuseBlockAction({ subjectUserId: ID(20), restrictedAction: "LEAD_PUBLICATION", durationMinutes: 60, explanation: "x" }), uc.impose],
      [() => actions.getAdminLeadDetailAction(ID(10)), uc.leadDetail],
    ] as const) {
      useCase.mockRejectedValue(secret);
      const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const result = (await call()) as { success: boolean; error: string };
      spy.mockRestore();
      expect(result.success).toBe(false);
      expect(result.error).not.toMatch(/postgres|constraint|duplicate|lead_abuse|pw@/i);
    }
  });
});

describe("M157 actions — reads do not mutate; mutations revalidate only on success", () => {
  it("no read action calls a mutating use case, and none revalidates", async () => {
    for (const c of CASES.filter((x) => !x.mutating)) await c.call();
    for (const k of ["startReview", "decide", "revoke", "impose", "lift"] as const) expect(uc[k]).not.toHaveBeenCalled();
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("each mutation calls exactly its own use case once and revalidates the console", async () => {
    for (const c of CASES.filter((x) => x.mutating)) {
      for (const f of Object.values(uc)) f.mockClear();
      mockRevalidatePath.mockClear();
      const result = (await c.call()) as { success: boolean; data?: unknown };
      expect(result).toEqual({ success: true, data: undefined });
      expect(uc[c.useCase]).toHaveBeenCalledTimes(1);
      for (const [k, f] of Object.entries(uc)) if (k !== c.useCase) expect(f, `${c.name} -> ${k}`).not.toHaveBeenCalled();
      expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/leads", "layout");
    }
  });

  it("a stale view is safe: a concurrent move surfaces as 'no longer possible' and changes nothing here", async () => {
    uc.startReview.mockRejectedValue(new LeadQualityClaimRejectedError("INVALID_TRANSITION"));
    const result = (await actions.startLeadClaimReviewAction(ID(40))) as { success: boolean; error: string };
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no longer possible/);
    expect(uc.startReview).toHaveBeenCalledTimes(1); // no retry loop
  });
});
