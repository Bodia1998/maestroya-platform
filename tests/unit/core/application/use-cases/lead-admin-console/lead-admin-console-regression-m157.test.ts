import { describe, expect, it, vi } from "vitest";

import {
  ImposeLeadAbuseBlockUseCase,
  LiftLeadAbuseDecisionUseCase,
  ListOpenLeadAbuseFlagsUseCase,
} from "@/application/use-cases/lead-abuse/admin-lead-abuse.use-cases";
import { EvaluateLeadAbuseUseCase } from "@/application/use-cases/lead-abuse/evaluate-lead-abuse.use-case";
import { GetAdminAbuseSubjectUseCase } from "@/application/use-cases/lead-admin-console/lead-admin-console.use-cases";
import type { AdminUserRecord } from "@/domain/repositories/admin-repository";
import { LeadAbuseControlRejectedError, defaultLeadAbuseControlConfig } from "@/domain/services/lead-abuse-controls";

import { FakeAdminAuditLogRepository } from "../../../../../test-utils/fake-admin-audit-log-repository";
import { FakeLeadAbuseControlRepository, FakeLeadAbuseFactsReader } from "../../../../../test-utils/fake-lead-abuse-control-repository";

/**
 * Module 157 — regression: the console's mutation path IS the M156 use cases, and their safeguards still hold when they are driven
 * the way the console drives them (actor from the session, free-text reason, stale / repeated submissions).
 */
vi.mock("@/infrastructure/observability/logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const uuid = (n: number) => `00000000-0000-4000-a000-${String(n).padStart(12, "0")}`;
const ADMIN = uuid(1);
const OTHER_ADMIN = uuid(2);
const SUBJECT = uuid(3);
const NOW = new Date("2026-10-12T10:00:00.000Z");

const admins = {
  getUserById: async (id: string) =>
    ({ id, name: null, email: null, phone: null, status: "ACTIVE", roles: ["ADMIN"], hasProfessionalProfile: false, lastLoginAt: null, createdAt: NOW }) as AdminUserRecord,
};

function world() {
  const audit = new FakeAdminAuditLogRepository();
  const control = new FakeLeadAbuseControlRepository(audit);
  return {
    audit,
    control,
    impose: new ImposeLeadAbuseBlockUseCase(admins, control, () => NOW),
    lift: new LiftLeadAbuseDecisionUseCase(admins, control, () => NOW),
    flags: new ListOpenLeadAbuseFlagsUseCase(admins, control),
  };
}

const reason = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(LeadAbuseControlRejectedError);
    return (e as LeadAbuseControlRejectedError).reason;
  }
  throw new Error("expected a rejection");
};

describe("M157 regression — PURCHASE_REJECTED_PROBING stays record-only through the console", () => {
  it("an absurd rejected-purchase count (ENFORCE) records one signal and creates NO flag and NO block; the review queue stays empty", async () => {
    const w = world();
    const facts = new FakeLeadAbuseFactsReader();
    facts.counts.rejected = 1_000_000;
    await new EvaluateLeadAbuseUseCase(facts, w.control, defaultLeadAbuseControlConfig("ENFORCE"), () => NOW).execute({ subjectUserId: SUBJECT, trigger: "PURCHASE" });

    expect(w.control.signals.map((s) => s.signalType)).toEqual(["PURCHASE_REJECTED_PROBING"]);
    expect(w.control.decisions).toEqual([]);
    expect(await w.flags.execute(ADMIN)).toEqual([]);
    expect(w.audit.entries).toEqual([]);
  });

  it("the console subject view shows that signal as record only and lists no decision", async () => {
    const w = world();
    const facts = new FakeLeadAbuseFactsReader();
    facts.counts.rejected = 50;
    await new EvaluateLeadAbuseUseCase(facts, w.control, defaultLeadAbuseControlConfig("ENFORCE"), () => NOW).execute({ subjectUserId: SUBJECT, trigger: "PURCHASE" });
    const reader = {
      getAbuseSubject: async (id: string) => ({
        subjectUserId: id,
        signals: w.control.signals.map((s, i) => ({ id: uuid(100 + i), subjectUserId: s.subjectUserId, signalType: s.signalType, reliability: s.reliability, severity: s.severity, ruleVersion: s.ruleVersion, targetLeadId: s.targetLeadId, observedCount: s.observedCount, threshold: s.threshold, windowSeconds: s.windowSeconds, occurredAt: s.occurredAt })),
        decisions: [],
      }),
    };
    const view = await new GetAdminAbuseSubjectUseCase(admins, reader, () => NOW).execute(ADMIN, SUBJECT);
    expect(view.signals).toHaveLength(1);
    expect(view.signals[0]).toMatchObject({ signalType: "PURCHASE_REJECTED_PROBING", recordOnly: true });
    expect(view.decisions).toEqual([]);
  });
});

describe("M157 regression — M156 safeguards when driven by the console", () => {
  it("imposing a block is audited with actor, target, action and before/after status; the free-text reason is not copied into the audit entry", async () => {
    const w = world();
    const decision = await w.impose.execute(ADMIN, { subjectUserId: SUBJECT, restrictedAction: "LEAD_PURCHASE_INITIATION", durationMs: 2 * 3_600_000, explanation: "Confirmed scraping of previews" });
    expect(decision).toMatchObject({ status: "ACTIVE", action: "TEMPORARY_BLOCK", restrictedAction: "LEAD_PURCHASE_INITIATION", origin: "ADMIN" });
    expect(decision.expiresAt?.getTime()).toBe(NOW.getTime() + 2 * 3_600_000);
    expect(w.audit.entries).toHaveLength(1);
    expect(w.audit.entries[0]).toMatchObject({ adminUserId: ADMIN, action: "LEAD_ABUSE_BLOCK_APPLIED", targetType: "LeadAbuseDecision", targetId: decision.id });
    expect(w.audit.entries[0]?.metadata).toMatchObject({ subjectUserId: SUBJECT, toStatus: "ACTIVE", fromStatus: null });
    expect(JSON.stringify(w.audit.entries[0]?.metadata)).not.toContain("scraping");
  });

  it("lifting records the actor and the ACTIVE -> LIFTED change; a second lift of the same decision is an invalid transition (no duplicate audit entry)", async () => {
    const w = world();
    const { id } = await w.impose.execute(ADMIN, { subjectUserId: SUBJECT, restrictedAction: "LEAD_PUBLICATION", durationMs: 3_600_000, explanation: "x" });
    await w.lift.execute(OTHER_ADMIN, { decisionId: id, note: "False positive" });
    expect(await reason(w.lift.execute(OTHER_ADMIN, { decisionId: id, note: "again" }))).toBe("INVALID_STATE");
    const lifts = w.audit.entries.filter((e) => e.action === "LEAD_ABUSE_DECISION_LIFTED");
    expect(lifts).toHaveLength(1);
    expect(lifts[0]).toMatchObject({ adminUserId: OTHER_ADMIN, targetId: id });
    expect(lifts[0]?.metadata).toMatchObject({ fromStatus: "ACTIVE", toStatus: "LIFTED" });
  });

  it("racing lifts: exactly one wins, exactly one audit entry", async () => {
    const w = world();
    const { id } = await w.impose.execute(ADMIN, { subjectUserId: SUBJECT, restrictedAction: "LEAD_PUBLICATION", durationMs: 3_600_000, explanation: "x" });
    const results = await Promise.allSettled([1, 2, 3, 4].map((n) => w.lift.execute(OTHER_ADMIN, { decisionId: id, note: `n${n}` })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(w.audit.entries.filter((e) => e.action === "LEAD_ABUSE_DECISION_LIFTED")).toHaveLength(1);
  });

  it("a duplicate block of the same action is rejected, not stacked", async () => {
    const w = world();
    const input = { subjectUserId: SUBJECT, restrictedAction: "LEAD_PUBLICATION", durationMs: 3_600_000, explanation: "x" } as const;
    await w.impose.execute(ADMIN, input);
    expect(await reason(w.impose.execute(ADMIN, input))).toBe("INVALID_STATE");
    expect(w.control.decisions.filter((d) => d.status === "ACTIVE")).toHaveLength(1);
    expect(w.audit.entries).toHaveLength(1);
  });

  it("separation of duties: an administrator can neither block nor unflag their own account", async () => {
    const w = world();
    expect(await reason(w.impose.execute(ADMIN, { subjectUserId: ADMIN, restrictedAction: "LEAD_PUBLICATION", durationMs: 3_600_000, explanation: "x" }))).toBe("ACTOR_NOT_AUTHORIZED");
    const { id } = await w.impose.execute(OTHER_ADMIN, { subjectUserId: ADMIN, restrictedAction: "LEAD_PUBLICATION", durationMs: 3_600_000, explanation: "x" });
    expect(await reason(w.lift.execute(ADMIN, { decisionId: id, note: "free me" }))).toBe("ACTOR_NOT_AUTHORIZED");
    expect(w.control.decisions.find((d) => d.id === id)?.status).toBe("ACTIVE");
  });

  it("malformed input never reaches the store (no permanent block, bad ids, blank reason)", async () => {
    const w = world();
    const base = { subjectUserId: SUBJECT, restrictedAction: "LEAD_PUBLICATION", durationMs: 3_600_000, explanation: "x" } as const;
    for (const bad of [{ durationMs: 0 }, { durationMs: 31 * 24 * 3_600_000 }, { durationMs: 1.5 }, { restrictedAction: "LEAD_CONTACT" }, { subjectUserId: "nope" }, { explanation: "  " }]) {
      expect(await reason(w.impose.execute(ADMIN, { ...base, ...bad } as never))).toBe("INVALID_INPUT");
    }
    expect(await reason(w.lift.execute(ADMIN, { decisionId: "nope", note: "x" }))).toBe("DECISION_NOT_FOUND");
    expect(w.control.decisions).toEqual([]);
    expect(w.audit.entries).toEqual([]);
  });

  it("a failing audit write surfaces to the caller instead of being swallowed", async () => {
    const w = world();
    w.audit.failNext = true;
    await expect(w.impose.execute(ADMIN, { subjectUserId: SUBJECT, restrictedAction: "LEAD_PUBLICATION", durationMs: 3_600_000, explanation: "x" })).rejects.toThrow();
  });
});
