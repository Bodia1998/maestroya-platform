import { describe, expect, it, vi } from "vitest";

import { toLeadContactDto } from "@/application/dto/lead-contact.dto";
import type { LeadContactAuthorizationReader, LeadContactReader, LeadContactRecord } from "@/application/ports/lead-contact-access";
import { AntiAbuseService } from "@/application/services/anti-abuse-service";
import {
  ImposeLeadAbuseBlockUseCase,
  LiftLeadAbuseDecisionUseCase,
  ListOpenLeadAbuseFlagsUseCase,
} from "@/application/use-cases/lead-abuse/admin-lead-abuse.use-cases";
import { EvaluateLeadAbuseUseCase } from "@/application/use-cases/lead-abuse/evaluate-lead-abuse.use-case";
import {
  LeadAbuseGuardedInitiatePurchase,
  LeadAbuseGuardedPublishLead,
  LeadAbuseObservedGetLeadContact,
  LeadAbuseRuntime,
} from "@/application/use-cases/lead-abuse/lead-abuse-guards";
import { GetLeadContactUseCase } from "@/application/use-cases/lead-contact/get-lead-contact.use-case";
import { AccountRestrictedError, RateLimitedError } from "@/domain/errors/domain-error";
import type { AdminUserRecord } from "@/domain/repositories/admin-repository";
import { DuplicateActiveLeadPurchaseError, LeadNotPurchasableError } from "@/domain/services/lead-purchase";
import { LeadContactAccessDeniedError, type LeadContactAuthorizationFacts } from "@/domain/services/lead-contact-access-policy";
import {
  LEAD_ABUSE_RULES,
  LeadAbuseControlRejectedError,
  defaultLeadAbuseControlConfig,
  type LeadAbuseMode,
  type LeadAbuseRejectionReason,
} from "@/domain/services/lead-abuse-controls";
import { InMemoryRateLimitRepository } from "@/infrastructure/security/in-memory-rate-limit-repository";

import { FakeAdminAuditLogRepository } from "../../../../../test-utils/fake-admin-audit-log-repository";
import { FakeLeadAbuseControlRepository, FakeLeadAbuseFactsReader } from "../../../../../test-utils/fake-lead-abuse-control-repository";

vi.mock("@/infrastructure/observability/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const uuid = (n: number) => `00000000-0000-4000-a000-${String(n).padStart(12, "0")}`;
const USER = uuid(1);
const OTHER_USER = uuid(2);
const ADMIN = uuid(3);
const LEAD = uuid(10);
const NOW = new Date("2026-10-12T10:00:00.000Z");
const HOUR = 3_600_000;

const cfg = (mode: LeadAbuseMode) => defaultLeadAbuseControlConfig(mode);

function evaluation(mode: LeadAbuseMode, now: () => Date = () => NOW) {
  const audit = new FakeAdminAuditLogRepository();
  const control = new FakeLeadAbuseControlRepository(audit);
  const facts = new FakeLeadAbuseFactsReader();
  const evaluate = new EvaluateLeadAbuseUseCase(facts, control, cfg(mode), now);
  return { audit, control, facts, evaluate };
}

describe("M156 — EvaluateLeadAbuseUseCase", () => {
  it("OFF reads nothing, writes nothing and returns null", async () => {
    const w = evaluation("OFF");
    w.facts.counts.publications = 500;
    expect(await w.evaluate.execute({ subjectUserId: USER, trigger: "PUBLICATION" })).toBeNull();
    expect(w.facts.calls).toEqual([]);
    expect(w.control.signals).toEqual([]);
    expect(w.control.decisions).toEqual([]);
  });

  it("malformed input (bad subject id / unknown trigger) is ignored without any read", async () => {
    const w = evaluation("ENFORCE");
    expect(await w.evaluate.execute({ subjectUserId: "not-a-uuid", trigger: "PUBLICATION" })).toBeNull();
    expect(await w.evaluate.execute({ subjectUserId: USER, trigger: "WHATEVER" as never })).toBeNull();
    expect(await w.evaluate.execute(undefined as never)).toBeNull();
    expect(w.facts.calls).toEqual([]);
  });

  it("each trigger reads only the facts of its own rules", async () => {
    const w = evaluation("SHADOW");
    await w.evaluate.execute({ subjectUserId: USER, trigger: "PUBLICATION" });
    expect(w.facts.calls.sort()).toEqual(["duplicates", "publications"]);
    w.facts.calls.length = 0;
    await w.evaluate.execute({ subjectUserId: USER, trigger: "CONTACT" });
    expect(w.facts.calls).toEqual(["denied"]);
    w.facts.calls.length = 0;
    await w.evaluate.execute({ subjectUserId: USER, trigger: "PURCHASE" });
    expect(w.facts.calls.sort()).toEqual(["disputesLost", "disputesOpened", "initiations", "rejected", "revocations"]);
  });

  it("below every threshold nothing is recorded", async () => {
    const w = evaluation("ENFORCE");
    w.facts.counts.publications = 9;
    const a = await w.evaluate.execute({ subjectUserId: USER, trigger: "PUBLICATION" });
    expect(a?.hits).toEqual([]);
    expect(w.control.signals).toEqual([]);
    expect(w.control.decisions).toEqual([]);
  });

  it("SHADOW records the signal and nothing else; repeating inside the window records nothing new", async () => {
    const w = evaluation("SHADOW");
    w.facts.counts.publications = 25; // over the BLOCK threshold
    await w.evaluate.execute({ subjectUserId: USER, trigger: "PUBLICATION" });
    await w.evaluate.execute({ subjectUserId: USER, trigger: "PUBLICATION" });
    expect(w.control.signals).toHaveLength(1);
    expect(w.control.signals[0]).toMatchObject({ signalType: "PUBLICATION_BURST", reliability: "HEURISTIC", severity: "HIGH", observedCount: 25, targetLeadId: null });
    expect(w.control.decisions).toEqual([]);
    expect(w.audit.entries).toEqual([]);
  });

  it("a later window records a new signal", async () => {
    let t = NOW;
    const w = evaluation("SHADOW", () => t);
    w.facts.counts.publications = 12;
    await w.evaluate.execute({ subjectUserId: USER, trigger: "PUBLICATION" });
    t = new Date(NOW.getTime() + HOUR);
    await w.evaluate.execute({ subjectUserId: USER, trigger: "PUBLICATION" });
    expect(w.control.signals).toHaveLength(2);
  });

  it("FLAG flags but never blocks, even over the block threshold", async () => {
    const w = evaluation("FLAG");
    w.facts.counts.publications = 99;
    await w.evaluate.execute({ subjectUserId: USER, trigger: "PUBLICATION" });
    expect(w.control.decisions).toHaveLength(1);
    expect(w.control.decisions[0]).toMatchObject({ action: "FLAG_FOR_REVIEW", restrictedAction: null, origin: "AUTOMATED", expiresAt: null, createdByUserId: null });
  });

  it("ENFORCE flags AND temporarily blocks the one named action; the block expires within the automated cap", async () => {
    const w = evaluation("ENFORCE");
    w.facts.counts.publications = 20;
    await w.evaluate.execute({ subjectUserId: USER, trigger: "PUBLICATION" });
    const block = w.control.decisions.find((d) => d.action === "TEMPORARY_BLOCK")!;
    expect(block).toMatchObject({ subjectUserId: USER, restrictedAction: "LEAD_PUBLICATION", status: "ACTIVE", origin: "AUTOMATED", ruleKey: "PUBLICATION_BURST" });
    expect(block.expiresAt!.getTime() - NOW.getTime()).toBe(LEAD_ABUSE_RULES.PUBLICATION_BURST.blockDurationMs);
    expect(block.expiresAt!.getTime() - NOW.getTime()).toBeLessThanOrEqual(24 * HOUR);
    expect(w.control.decisions.some((d) => d.action === "FLAG_FOR_REVIEW")).toBe(true);
    expect(w.control.decisions.some((d) => d.restrictedAction === "LEAD_PURCHASE_INITIATION")).toBe(false);
  });

  it("is idempotent: repeating the evaluation creates no new decision and no new audit entry", async () => {
    const w = evaluation("ENFORCE");
    w.facts.counts.initiations = 40;
    await w.evaluate.execute({ subjectUserId: USER, trigger: "PURCHASE" });
    const decisions = w.control.decisions.length;
    const audits = w.audit.entries.length;
    expect(decisions).toBe(2);
    for (let i = 0; i < 3; i += 1) await w.evaluate.execute({ subjectUserId: USER, trigger: "PURCHASE" });
    expect(w.control.decisions).toHaveLength(decisions);
    expect(w.audit.entries).toHaveLength(audits);
    expect(w.audit.entries.map((e) => e.action).sort()).toEqual(["LEAD_ABUSE_BLOCK_APPLIED", "LEAD_ABUSE_FLAGGED"]);
    expect(w.audit.entries.every((e) => e.adminUserId === null && e.targetType === "LeadAbuseDecision")).toBe(true);
  });

  it("dispute / revocation history is a RELIABLE signal that flags for review only — never an automated block", async () => {
    const w = evaluation("ENFORCE");
    w.facts.counts.disputesOpened = 9;
    w.facts.counts.disputesLost = 9;
    w.facts.counts.revocations = 9;
    const a = await w.evaluate.execute({ subjectUserId: USER, trigger: "PURCHASE" });
    expect(a?.hits.map((h) => h.rule).sort()).toEqual(["REPEATED_DISPUTES_LOST", "REPEATED_DISPUTES_OPENED", "REPEATED_REVOCATIONS"]);
    expect(w.control.signals.every((s) => s.reliability === "RELIABLE")).toBe(true);
    expect(w.control.decisions.filter((d) => d.action === "TEMPORARY_BLOCK")).toEqual([]);
    expect(w.control.decisions).toHaveLength(1); // one ACTIVE flag per subject
  });

  it("malformed counts skip their rule: no signal, no decision", async () => {
    const w = evaluation("ENFORCE");
    w.facts.malformed = { publications: -3, duplicates: "7", initiations: NaN };
    expect((await w.evaluate.execute({ subjectUserId: USER, trigger: "PUBLICATION" }))?.hits).toEqual([]);
    expect((await w.evaluate.execute({ subjectUserId: USER, trigger: "PURCHASE" }))?.hits).toEqual([]);
    expect(w.control.signals).toEqual([]);
    expect(w.control.decisions).toEqual([]);
  });

  it("a failing facts read throws and writes nothing", async () => {
    const w = evaluation("ENFORCE");
    w.facts.failNext = true;
    await expect(w.evaluate.execute({ subjectUserId: USER, trigger: "PUBLICATION" })).rejects.toThrow();
    expect(w.control.signals).toEqual([]);
    expect(w.control.decisions).toEqual([]);
  });

  it("the audit entry never carries free text", async () => {
    const w = evaluation("ENFORCE");
    w.facts.counts.publications = 30;
    await w.evaluate.execute({ subjectUserId: USER, trigger: "PUBLICATION" });
    for (const e of w.audit.entries) expect(Object.keys(e.metadata ?? {}).sort()).toEqual(["decisionAction", "expiresAt", "fromStatus", "origin", "restrictedAction", "ruleKey", "ruleVersion", "subjectUserId", "toStatus"]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------

function runtime(mode: LeadAbuseMode, opts: { now?: () => Date; antiAbuse?: Pick<AntiAbuseService, "enforceRateLimit"> | null } = {}) {
  const w = evaluation(mode, opts.now);
  const rt = new LeadAbuseRuntime(mode, w.evaluate, w.control, opts.antiAbuse ?? null, opts.now ?? (() => NOW), async () => undefined);
  return { ...w, rt };
}

function realAntiAbuse() {
  const rateLimits = new InMemoryRateLimitRepository();
  const events: unknown[] = [];
  const svc = new AntiAbuseService(
    rateLimits,
    { record: async (e: unknown) => void events.push(e), list: async () => [] } as never,
    { create: async () => ({}), findActiveForUser: async () => null, lift: async () => null, list: async () => [] } as never,
  );
  return { svc, events };
}

async function blockFor(w: ReturnType<typeof runtime>, restricted: "LEAD_PUBLICATION" | "LEAD_PURCHASE_INITIATION", at = NOW, ms = HOUR) {
  await w.control.imposeAdminBlock({ subjectUserId: USER, restrictedAction: restricted, actorUserId: ADMIN, explanation: "x", decidedAt: at, expiresAt: new Date(at.getTime() + ms) });
}

describe("M156 — publication guard", () => {
  it("passes arguments and the result through unchanged; evaluates after success", async () => {
    const w = runtime("SHADOW");
    w.facts.counts.publications = 11;
    const inner = { execute: vi.fn(async (_u: string, _l: string) => ({ id: LEAD })) };
    const result = await new LeadAbuseGuardedPublishLead(inner, w.rt).execute(USER, LEAD);
    expect(result).toEqual({ id: LEAD });
    expect(inner.execute).toHaveBeenCalledWith(USER, LEAD);
    expect(w.control.signals).toHaveLength(1);
  });

  it("ENFORCE: a block in force stops the call before the use case runs", async () => {
    const w = runtime("ENFORCE");
    await blockFor(w, "LEAD_PUBLICATION");
    const inner = { execute: vi.fn(async () => "published") };
    await expect(new LeadAbuseGuardedPublishLead(inner, w.rt).execute(USER, LEAD)).rejects.toBeInstanceOf(AccountRestrictedError);
    expect(inner.execute).not.toHaveBeenCalled();
  });

  it("a block of another action, another user, an expired block or a lifted block does not stop publication", async () => {
    const w = runtime("ENFORCE");
    await blockFor(w, "LEAD_PURCHASE_INITIATION");
    const inner = { execute: vi.fn(async () => "published") };
    const guard = new LeadAbuseGuardedPublishLead(inner, w.rt);
    await expect(guard.execute(USER, LEAD)).resolves.toBe("published");
    await expect(guard.execute(OTHER_USER, LEAD)).resolves.toBe("published");

    const expired = runtime("ENFORCE");
    await blockFor(expired, "LEAD_PUBLICATION", new Date(NOW.getTime() - 2 * HOUR), HOUR);
    await expect(new LeadAbuseGuardedPublishLead(inner, expired.rt).execute(USER, LEAD)).resolves.toBe("published");

    const lifted = runtime("ENFORCE");
    await blockFor(lifted, "LEAD_PUBLICATION");
    lifted.control.decisions[0]!.status = "LIFTED";
    await expect(new LeadAbuseGuardedPublishLead(inner, lifted.rt).execute(USER, LEAD)).resolves.toBe("published");
  });

  it("SHADOW and FLAG never block, even with a block row present (the mode is the kill switch)", async () => {
    for (const mode of ["SHADOW", "FLAG"] as const) {
      const w = runtime(mode);
      await blockFor(w, "LEAD_PUBLICATION");
      const inner = { execute: vi.fn(async () => "published") };
      await expect(new LeadAbuseGuardedPublishLead(inner, w.rt).execute(USER, LEAD)).resolves.toBe("published");
    }
  });

  it("ENFORCE no longer fails open: a store outage on the block lookup refuses the action with the generic retryable error (hardening, was fail-open)", async () => {
    const w = runtime("ENFORCE");
    await blockFor(w, "LEAD_PUBLICATION");
    w.control.failNext = "findBlock";
    const inner = { execute: vi.fn(async () => "published") };
    // one transient failure is retried and the ESTABLISHED block is then honoured, not bypassed
    await expect(new LeadAbuseGuardedPublishLead(inner, w.rt).execute(USER, LEAD)).rejects.toBeInstanceOf(AccountRestrictedError);
    expect(inner.execute).not.toHaveBeenCalled();
  });

  it("an evaluation failure after the action never fails the action", async () => {
    const w = runtime("FLAG");
    w.facts.failNext = true;
    const inner = { execute: vi.fn(async () => "published") };
    await expect(new LeadAbuseGuardedPublishLead(inner, w.rt).execute(USER, LEAD)).resolves.toBe("published");
  });

  it("errors of the wrapped use case are rethrown as the very same object, with no evaluation", async () => {
    const w = runtime("ENFORCE");
    const boom = new Error("boom");
    const inner = { execute: vi.fn(async () => Promise.reject(boom)) };
    await expect(new LeadAbuseGuardedPublishLead(inner, w.rt).execute(USER, LEAD)).rejects.toBe(boom);
    expect(w.facts.calls).toEqual([]);
  });

  it("ENFORCE rate limit is enforced at this boundary: the 31st publication in an hour is refused before the use case runs", async () => {
    const { svc, events } = realAntiAbuse();
    const w = runtime("ENFORCE", { antiAbuse: svc });
    const inner = { execute: vi.fn(async () => "published") };
    const guard = new LeadAbuseGuardedPublishLead(inner, w.rt);
    for (let i = 0; i < 30; i += 1) await guard.execute(USER, LEAD);
    await expect(guard.execute(USER, LEAD)).rejects.toBeInstanceOf(RateLimitedError);
    expect(inner.execute).toHaveBeenCalledTimes(30);
    expect(events).toHaveLength(1);
    // another user has an independent budget
    await expect(guard.execute(OTHER_USER, LEAD)).resolves.toBe("published");
  });

  it("the rate limit exists only in ENFORCE; SHADOW and FLAG never call the limiter", async () => {
    const { svc } = realAntiAbuse();
    const spy = vi.spyOn(svc, "enforceRateLimit");
    const inner = { execute: vi.fn(async () => "published") };
    for (const mode of ["SHADOW", "FLAG"] as const) {
      const w = runtime(mode, { antiAbuse: svc });
      for (let i = 0; i < 35; i += 1) await new LeadAbuseGuardedPublishLead(inner, w.rt).execute(USER, LEAD);
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it("end to end: a real burst in ENFORCE blocks the next publication", async () => {
    const w = runtime("ENFORCE");
    w.facts.counts.publications = 20;
    const inner = { execute: vi.fn(async () => "published") };
    const guard = new LeadAbuseGuardedPublishLead(inner, w.rt);
    await expect(guard.execute(USER, LEAD)).resolves.toBe("published"); // the 20th succeeds, then the evaluation blocks
    await expect(guard.execute(USER, LEAD)).rejects.toBeInstanceOf(AccountRestrictedError);
    expect(inner.execute).toHaveBeenCalledTimes(1);
  });
});

describe("M156 — purchase initiation guard", () => {
  it("ENFORCE: blocked initiation never reaches the use case; publication block does not affect purchase", async () => {
    const w = runtime("ENFORCE");
    await blockFor(w, "LEAD_PURCHASE_INITIATION");
    const inner = { execute: vi.fn(async () => "pending") };
    await expect(new LeadAbuseGuardedInitiatePurchase(inner, w.rt).execute(USER, LEAD)).rejects.toBeInstanceOf(AccountRestrictedError);
    expect(inner.execute).not.toHaveBeenCalled();

    const other = runtime("ENFORCE");
    await blockFor(other, "LEAD_PUBLICATION");
    await expect(new LeadAbuseGuardedInitiatePurchase(inner, other.rt).execute(USER, LEAD)).resolves.toBe("pending");
  });

  it("records a probing event for a LeadNotPurchasableError (deduplicated per lead and hour) and rethrows the SAME error", async () => {
    const w = runtime("SHADOW");
    const refusal = new LeadNotPurchasableError();
    const inner = { execute: vi.fn(async () => Promise.reject(refusal)) };
    const guard = new LeadAbuseGuardedInitiatePurchase(inner, w.rt);
    await expect(guard.execute(USER, LEAD)).rejects.toBe(refusal);
    await expect(guard.execute(USER, LEAD)).rejects.toBe(refusal);
    const events = w.control.signals.filter((s) => s.signalType === "PURCHASE_REJECTED_EVENT");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ targetLeadId: LEAD, subjectUserId: USER, observedCount: null });
    await expect(guard.execute(USER, uuid(11))).rejects.toBe(refusal);
    expect(w.control.signals.filter((s) => s.signalType === "PURCHASE_REJECTED_EVENT")).toHaveLength(2);
  });

  it("other failures (duplicate purchase, infrastructure) record nothing and are rethrown unchanged", async () => {
    const w = runtime("SHADOW");
    const dup = new DuplicateActiveLeadPurchaseError();
    await expect(new LeadAbuseGuardedInitiatePurchase({ execute: async () => Promise.reject(dup) }, w.rt).execute(USER, LEAD)).rejects.toBe(dup);
    expect(w.control.signals).toEqual([]);
  });

  it("event recording is best effort: a failing store does not change the refusal", async () => {
    const w = runtime("SHADOW");
    w.control.failNext = "recordSignal";
    const refusal = new LeadNotPurchasableError();
    await expect(new LeadAbuseGuardedInitiatePurchase({ execute: async () => Promise.reject(refusal) }, w.rt).execute(USER, LEAD)).rejects.toBe(refusal);
  });

  it("malformed ids record nothing", async () => {
    const w = runtime("SHADOW");
    const refusal = new LeadNotPurchasableError();
    await expect(new LeadAbuseGuardedInitiatePurchase({ execute: async () => Promise.reject(refusal) }, w.rt).execute(USER, "not-a-uuid")).rejects.toBe(refusal);
    await expect(new LeadAbuseGuardedInitiatePurchase({ execute: async () => Promise.reject(refusal) }, w.rt).execute("", LEAD)).rejects.toBe(refusal);
    expect(w.control.signals).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
// Regression: M138/M139 contact protection and M155 dispute / revocation denial, with the observer attached.
// ---------------------------------------------------------------------------------------------------------------------------

const PRO_USER = USER;
const PRO_ID = uuid(20);
const RECORD: LeadContactRecord = { customerDisplayName: "Ana", email: "ana@example.com", phone: "+34600111222", addressLine1: "Calle 1", addressLine2: null, postalCode: "28013", city: "Madrid", province: "Madrid" };

function contactWorld(mode: LeadAbuseMode, state: "CONFIRMED" | "PENDING" | "REVOKED" | "INVALID" | null, extra: Partial<LeadContactAuthorizationFacts> = {}) {
  const readContact = vi.fn(async () => RECORD);
  const facts: LeadContactAuthorizationFacts = {
    leadExists: true,
    flowVersion: "LEAD_V1",
    grant: state ? { state, professionalProfileId: PRO_ID } : null,
    blocked: false,
    contactOwnershipConsistent: true,
    ...extra,
  };
  const authorization: LeadContactAuthorizationReader = { findFacts: async () => facts };
  const contacts: LeadContactReader = { readContact };
  const inner = new GetLeadContactUseCase(
    { findById: async (id: string) => ({ id, status: "ACTIVE" }) } as never,
    { findByUserId: async (userId: string) => (userId === PRO_USER ? { id: PRO_ID, userId, status: "ACTIVE" } : null) } as never,
    authorization,
    contacts,
  );
  const w = runtime(mode);
  return { ...w, inner, readContact, observed: new LeadAbuseObservedGetLeadContact(inner, w.rt) };
}

describe("M156 — contact observer preserves M138/M139/M155 (it can neither grant nor deny)", () => {
  it("a CONFIRMED purchase still reads contact exactly as before and records no event", async () => {
    const w = contactWorld("ENFORCE", "CONFIRMED");
    const viaGuard = await w.observed.execute(PRO_USER, LEAD);
    expect(viaGuard).toEqual(await w.inner.execute(PRO_USER, LEAD));
    expect(viaGuard).toEqual(toLeadContactDto(LEAD, RECORD));
    expect(w.control.signals).toEqual([]);
  });

  it.each([
    ["no purchase", null],
    ["PENDING_PAYMENT", "PENDING"],
    ["REVOKED (M155 revocation / lost chargeback)", "REVOKED"],
    ["not CONFIRMED (M155 DISPUTED maps to INVALID/blocked)", "INVALID"],
  ] as const)("%s is denied with the identical error, contact is never read, and a probing event is recorded", async (_label, state) => {
    const w = contactWorld("SHADOW", state);
    const error = await w.observed.execute(PRO_USER, LEAD).catch((e) => e);
    expect(error).toBeInstanceOf(LeadContactAccessDeniedError);
    expect(error.message).toBe(new LeadContactAccessDeniedError().message);
    expect(w.readContact).not.toHaveBeenCalled();
    expect(w.control.signals.filter((s) => s.signalType === "CONTACT_ACCESS_DENIED_EVENT")).toHaveLength(1);
  });

  it("a purchase blocked for any server-side reason (M155 dispute freeze) stays denied", async () => {
    const w = contactWorld("ENFORCE", "CONFIRMED", { blocked: true });
    await expect(w.observed.execute(PRO_USER, LEAD)).rejects.toBeInstanceOf(LeadContactAccessDeniedError);
    expect(w.readContact).not.toHaveBeenCalled();
  });

  it("a LOW risk or HIGH risk never changes the outcome: not purchased stays denied, purchased stays allowed", async () => {
    const denied = contactWorld("ENFORCE", null);
    denied.facts.counts.denied = 0; // squeaky-clean subject
    await expect(denied.observed.execute(PRO_USER, LEAD)).rejects.toBeInstanceOf(LeadContactAccessDeniedError);

    const allowed = contactWorld("ENFORCE", "CONFIRMED");
    await allowed.control.applyAutomatedDecision({ subjectUserId: PRO_USER, action: "FLAG_FOR_REVIEW", restrictedAction: null, ruleKey: "REPEATED_REVOCATIONS", ruleVersion: "m156.v1", expiresAt: null, decidedAt: NOW, observedCount: 9, threshold: 2 });
    await blockFor(allowed, "LEAD_PURCHASE_INITIATION");
    await expect(allowed.observed.execute(PRO_USER, LEAD)).resolves.toEqual(toLeadContactDto(LEAD, RECORD));
  });

  it("denial stays fail-closed when the recording store is down or the evaluation throws", async () => {
    const w = contactWorld("FLAG", null);
    w.control.failNext = "all";
    await expect(w.observed.execute(PRO_USER, LEAD)).rejects.toBeInstanceOf(LeadContactAccessDeniedError);
    const w2 = contactWorld("FLAG", null);
    w2.facts.failNext = true;
    await expect(w2.observed.execute(PRO_USER, LEAD)).rejects.toBeInstanceOf(LeadContactAccessDeniedError);
  });

  it("only LeadContactAccessDeniedError is observed: any other failure is rethrown untouched and records nothing", async () => {
    const w = runtime("ENFORCE");
    const boom = new Error("db");
    await expect(new LeadAbuseObservedGetLeadContact({ execute: async () => Promise.reject(boom) }, w.rt).execute(PRO_USER, LEAD)).rejects.toBe(boom);
    expect(w.control.signals).toEqual([]);
  });

  it("repeated probing of many leads becomes a flag, never a block of contact access", async () => {
    const w = contactWorld("ENFORCE", null);
    w.facts.counts.denied = 6;
    await expect(w.observed.execute(PRO_USER, LEAD)).rejects.toBeInstanceOf(LeadContactAccessDeniedError);
    expect(w.control.decisions).toHaveLength(1);
    expect(w.control.decisions[0]).toMatchObject({ action: "FLAG_FOR_REVIEW", ruleKey: "CONTACT_ACCESS_DENIED_PROBING" });
  });

  it("OFF (and an unrecorded mode) records nothing", async () => {
    const w = contactWorld("OFF", null);
    await expect(w.observed.execute(PRO_USER, LEAD)).rejects.toBeInstanceOf(LeadContactAccessDeniedError);
    expect(w.control.signals).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
// Administrator use cases
// ---------------------------------------------------------------------------------------------------------------------------

const adminUser = (over: Partial<AdminUserRecord> = {}): AdminUserRecord => ({
  id: ADMIN, name: null, email: null, phone: null, status: "ACTIVE", roles: ["ADMIN"], hasProfessionalProfile: false, lastLoginAt: null, createdAt: new Date(), ...over,
});

function adminWorld(admin: AdminUserRecord | null | "throws" = adminUser()) {
  const audit = new FakeAdminAuditLogRepository();
  const control = new FakeLeadAbuseControlRepository(audit);
  const users: Record<string, AdminUserRecord> = { [USER]: adminUser({ id: USER, roles: ["PROFESSIONAL"] }), [OTHER_USER]: adminUser({ id: OTHER_USER, roles: ["CUSTOMER"] }) };
  const admins = {
    getUserById: async (id: string) => {
      if (admin === "throws" && id === ADMIN) throw new Error("db down");
      if (id === ADMIN) return admin === "throws" ? null : admin;
      return users[id] ?? null;
    },
  };
  return {
    audit,
    control,
    impose: new ImposeLeadAbuseBlockUseCase(admins, control, () => NOW),
    lift: new LiftLeadAbuseDecisionUseCase(admins, control, () => NOW),
    list: new ListOpenLeadAbuseFlagsUseCase(admins, control),
  };
}

const input = (over: Record<string, unknown> = {}) => ({ subjectUserId: USER, restrictedAction: "LEAD_PURCHASE_INITIATION" as const, durationMs: 2 * HOUR, explanation: "Reviewed chargebacks", ...over });
const reason = async (p: Promise<unknown>): Promise<LeadAbuseRejectionReason | "NONE"> => {
  try {
    await p;
    return "NONE";
  } catch (e) {
    if (e instanceof LeadAbuseControlRejectedError) return e.reason;
    throw e;
  }
};

describe("M156 — administrator authorization", () => {
  it.each([
    ["an ordinary customer", adminUser({ roles: ["CUSTOMER"] })],
    ["a professional", adminUser({ roles: ["PROFESSIONAL"] })],
    ["a suspended administrator", adminUser({ status: "SUSPENDED" })],
    ["an unknown actor", null],
    ["an actor whose lookup fails", "throws" as const],
    ["an actor without roles", adminUser({ roles: [] })],
  ])("%s cannot impose, lift or list, and nothing is written", async (_l, actor) => {
    const w = adminWorld(actor);
    expect(await reason(w.impose.execute(ADMIN, input()))).toBe("ACTOR_NOT_AUTHORIZED");
    expect(await reason(w.lift.execute(ADMIN, { decisionId: uuid(99), note: "n" }))).toBe("ACTOR_NOT_AUTHORIZED");
    expect(await reason(w.list.execute(ADMIN))).toBe("ACTOR_NOT_AUTHORIZED");
    expect(w.control.decisions).toEqual([]);
    expect(w.audit.entries).toEqual([]);
  });

  it("an empty / non-string actor id is refused", async () => {
    const w = adminWorld();
    for (const bad of ["", "   ", undefined, null, 5]) expect(await reason(w.impose.execute(bad as never, input()))).toBe("ACTOR_NOT_AUTHORIZED");
  });

  it("ADMIN and SUPER_ADMIN are accepted", async () => {
    for (const role of ["ADMIN", "SUPER_ADMIN"]) {
      const w = adminWorld(adminUser({ roles: [role] }));
      expect(await reason(w.impose.execute(ADMIN, input()))).toBe("NONE");
    }
  });
});

describe("M156 — impose a block", () => {
  it("creates one bounded, auditable block; the audit metadata holds no explanation text", async () => {
    const w = adminWorld();
    const dto = await w.impose.execute(ADMIN, input());
    expect(dto).toMatchObject({ subjectUserId: USER, action: "TEMPORARY_BLOCK", restrictedAction: "LEAD_PURCHASE_INITIATION", status: "ACTIVE", origin: "ADMIN", ruleKey: null });
    expect(dto.expiresAt).toEqual(new Date(NOW.getTime() + 2 * HOUR));
    expect(w.audit.entries).toHaveLength(1);
    expect(w.audit.entries[0]).toMatchObject({ adminUserId: ADMIN, action: "LEAD_ABUSE_BLOCK_APPLIED" });
    expect(JSON.stringify(w.audit.entries[0]!.metadata)).not.toContain("Reviewed chargebacks");
    expect(w.control.decisions[0]!.explanation).toBe("Reviewed chargebacks");
  });

  it.each([
    ["unknown action", { restrictedAction: "CONTACT_READ" }],
    ["bad subject id", { subjectUserId: "nope" }],
    ["no duration", { durationMs: undefined }],
    ["permanent-looking duration", { durationMs: Number.MAX_SAFE_INTEGER }],
    ["too short", { durationMs: 1000 }],
    ["empty explanation", { explanation: "  " }],
    ["control characters", { explanation: "a\u0007b" }],
  ])("rejects %s", async (_l, over) => {
    const w = adminWorld();
    expect(await reason(w.impose.execute(ADMIN, input(over)))).toBe("INVALID_INPUT");
    expect(w.control.decisions).toEqual([]);
  });

  it("an administrator cannot block themselves; an unknown subject is refused", async () => {
    const w = adminWorld();
    expect(await reason(w.impose.execute(ADMIN, input({ subjectUserId: ADMIN })))).toBe("ACTOR_NOT_AUTHORIZED");
    expect(await reason(w.impose.execute(ADMIN, input({ subjectUserId: uuid(77) })))).toBe("SUBJECT_NOT_FOUND");
    expect(w.control.decisions).toEqual([]);
  });

  it("a second block of the same action while one is in force is refused (INVALID_STATE), not stacked", async () => {
    const w = adminWorld();
    await w.impose.execute(ADMIN, input());
    expect(await reason(w.impose.execute(ADMIN, input()))).toBe("INVALID_STATE");
    expect(w.control.decisions).toHaveLength(1);
    expect(await reason(w.impose.execute(ADMIN, input({ restrictedAction: "LEAD_PUBLICATION" })))).toBe("NONE");
  });
});

describe("M156 — lift / resolve", () => {
  async function withBlock() {
    const w = adminWorld();
    const dto = await w.impose.execute(ADMIN, input());
    return { w, id: dto.id };
  }

  it("lifts a block with a note; the entry is audited; the block no longer restricts", async () => {
    const { w, id } = await withBlock();
    const dto = await w.lift.execute(ADMIN, { decisionId: id, note: "Resolved with the professional" });
    expect(dto).toMatchObject({ status: "LIFTED", liftedAt: NOW });
    expect(w.control.decisions[0]).toMatchObject({ liftedByUserId: ADMIN, resolutionNote: "Resolved with the professional" });
    expect(await w.control.findBlockInForce(USER, "LEAD_PURCHASE_INITIATION", NOW)).toBeNull();
    expect(w.audit.entries.map((e) => e.action)).toEqual(["LEAD_ABUSE_BLOCK_APPLIED", "LEAD_ABUSE_DECISION_LIFTED"]);
    expect(JSON.stringify(w.audit.entries[1]!.metadata)).not.toContain("Resolved with the professional");
  });

  it("resolves a review flag the same way", async () => {
    const w = adminWorld();
    await w.control.applyAutomatedDecision({ subjectUserId: USER, action: "FLAG_FOR_REVIEW", restrictedAction: null, ruleKey: "PUBLICATION_BURST", ruleVersion: "m156.v1", expiresAt: null, decidedAt: NOW, observedCount: 11, threshold: 10 });
    expect(await w.list.execute(ADMIN)).toHaveLength(1);
    await w.lift.execute(ADMIN, { decisionId: w.control.decisions[0]!.id, note: "false positive" });
    expect(await w.list.execute(ADMIN)).toHaveLength(0);
  });

  it("is single-shot: a second lift is INVALID_STATE; exactly one of two racing lifts wins", async () => {
    const { w, id } = await withBlock();
    const results = await Promise.all([reason(w.lift.execute(ADMIN, { decisionId: id, note: "a" })), reason(w.lift.execute(ADMIN, { decisionId: id, note: "b" }))]);
    expect(results.sort()).toEqual(["INVALID_STATE", "NONE"]);
    expect(w.audit.entries.filter((e) => e.action === "LEAD_ABUSE_DECISION_LIFTED")).toHaveLength(1);
  });

  it("validates input and refuses self-service", async () => {
    const { w, id } = await withBlock();
    expect(await reason(w.lift.execute(ADMIN, { decisionId: id, note: "" }))).toBe("INVALID_INPUT");
    expect(await reason(w.lift.execute(ADMIN, { decisionId: "x", note: "ok" }))).toBe("DECISION_NOT_FOUND");
    expect(await reason(w.lift.execute(ADMIN, { decisionId: uuid(98), note: "ok" }))).toBe("DECISION_NOT_FOUND");
    // a decision about the administrator's own account cannot be cleared by that administrator
    const self = adminWorld();
    await self.control.applyAutomatedDecision({ subjectUserId: ADMIN, action: "FLAG_FOR_REVIEW", restrictedAction: null, ruleKey: "PUBLICATION_BURST", ruleVersion: "m156.v1", expiresAt: null, decidedAt: NOW, observedCount: 11, threshold: 10 });
    expect(await reason(self.lift.execute(ADMIN, { decisionId: self.control.decisions[0]!.id, note: "mine" }))).toBe("ACTOR_NOT_AUTHORIZED");
    expect(self.control.decisions[0]!.status).toBe("ACTIVE");
  });

  it("the review queue is bounded and oldest first", async () => {
    const w = adminWorld();
    for (let i = 0; i < 3; i += 1) {
      await w.control.applyAutomatedDecision({ subjectUserId: uuid(30 + i), action: "FLAG_FOR_REVIEW", restrictedAction: null, ruleKey: "PUBLICATION_BURST", ruleVersion: "m156.v1", expiresAt: null, decidedAt: new Date(NOW.getTime() + i), observedCount: 11, threshold: 10 });
    }
    expect((await w.list.execute(ADMIN, 2)).map((d) => d.subjectUserId)).toEqual([uuid(30), uuid(31)]);
    expect(await w.list.execute(ADMIN, -5)).toHaveLength(1);
    expect(await w.list.execute(ADMIN, Number.NaN)).toHaveLength(3);
  });
});
