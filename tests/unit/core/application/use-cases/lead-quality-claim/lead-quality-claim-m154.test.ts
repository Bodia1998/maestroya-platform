import { describe, expect, it } from "vitest";

import { DecideLeadQualityClaimUseCase } from "@/application/use-cases/lead-quality-claim/decide-lead-quality-claim.use-case";
import { StartLeadQualityClaimReviewUseCase } from "@/application/use-cases/lead-quality-claim/start-lead-quality-claim-review.use-case";
import { SubmitLeadQualityClaimUseCase } from "@/application/use-cases/lead-quality-claim/submit-lead-quality-claim.use-case";
import type { AdminUserRecord } from "@/domain/repositories/admin-repository";
import { LeadQualityClaimInsertConflictError } from "@/domain/repositories/lead-quality-claim-repository";
import type { LeadPurchaseRecord } from "@/domain/repositories/lead-purchase-repository";
import type { ProfessionalRecord } from "@/domain/repositories/professional-repository";
import { LeadQualityClaimRejectedError, type LeadQualityClaimRejection } from "@/domain/services/lead-quality-claim";

import { FakeAdminAuditLogRepository } from "../../../../../test-utils/fake-admin-audit-log-repository";
import { FakeLeadQualityClaimRepository } from "../../../../../test-utils/fake-lead-quality-claim-repository";

const uuid = (n: number) => `00000000-0000-4000-a000-${String(n).padStart(12, "0")}`;
const CONFIRMED_AT = new Date("2026-10-10T10:00:00.000Z");
const NOW = new Date("2026-10-11T10:00:00.000Z"); // 24h after confirmation
const PRO_USER = uuid(1);
const PRO_ID = uuid(2);
const OTHER_PRO_USER = uuid(3);
const OTHER_PRO_ID = uuid(4);
const ADMIN_ID = uuid(5);

const professional = (over: Partial<ProfessionalRecord> = {}) => ({ id: PRO_ID, userId: PRO_USER, status: "ACTIVE", ...over }) as ProfessionalRecord;
const purchase = (over: Partial<LeadPurchaseRecord> = {}) =>
  ({ id: uuid(10), leadId: uuid(11), professionalProfileId: PRO_ID, status: "CONFIRMED", confirmedAt: CONFIRMED_AT, paymentReference: "pi_1", ...over }) as LeadPurchaseRecord;
const adminUser = (over: Partial<AdminUserRecord> = {}): AdminUserRecord => ({
  id: ADMIN_ID, name: null, email: null, phone: null, status: "ACTIVE", roles: ["ADMIN"], hasProfessionalProfile: false, lastLoginAt: null, createdAt: new Date(), ...over,
});

function world(opts: { purchases?: LeadPurchaseRecord[]; professionals?: ProfessionalRecord[]; admin?: AdminUserRecord | null | "throws" } = {}) {
  const purchases = opts.purchases ?? [purchase()];
  const professionals = opts.professionals ?? [professional()];
  let clock = NOW;
  const now = () => clock;
  const audit = new FakeAdminAuditLogRepository();
  // The fake plays the DATABASE: its clock stamps submittedAt and decides the window, and it knows purchase / profile persistence.
  const claims = new FakeLeadQualityClaimRepository(audit, {
    now,
    confirmedAtOf: (id) => purchases.find((p) => p.id === id)?.confirmedAt,
    ownerUserOf: (profileId) => professionals.find((p) => p.id === profileId)?.userId,
  });
  const admins = {
    calls: 0,
    getUserById: async (id: string) => {
      admins.calls += 1;
      if (opts.admin === "throws") throw new Error("db down");
      const a = opts.admin === undefined ? adminUser() : opts.admin;
      return a && a.id === id ? a : null;
    },
  };
  const submit = new SubmitLeadQualityClaimUseCase(
    { findByUserId: async (userId) => professionals.find((p) => p.userId === userId) ?? null },
    { findById: async (id) => purchases.find((p) => p.id === id) ?? null },
    claims,
    now,
  );
  const start = new StartLeadQualityClaimReviewUseCase(admins, claims, now);
  const decide = new DecideLeadQualityClaimUseCase(admins, claims, now);
  return { claims, audit, admins, submit, start, decide, setClock: (d: Date) => (clock = d), purchases, professionals };
}

const input = (patch: Record<string, unknown> = {}) => ({
  leadPurchaseId: uuid(10),
  reasonCode: "CONTACT_UNREACHABLE" as const,
  description: "The phone number never answers and messages bounce.",
  ...patch,
});
const reasonOf = async (p: Promise<unknown>): Promise<LeadQualityClaimRejection | "OTHER" | null> => {
  try {
    await p;
  } catch (e) {
    return e instanceof LeadQualityClaimRejectedError ? e.reason : "OTHER";
  }
  return null;
};

describe("Module 154 — SubmitLeadQualityClaimUseCase", () => {
  it("records a SUBMITTED claim for the buyer's own CONFIRMED purchase with respondBy = submittedAt + 72h, and audits it", async () => {
    const w = world();
    const dto = await w.submit.execute(PRO_USER, input({ evidenceReference: "SHOT-1" }));
    expect(dto).toMatchObject({ leadPurchaseId: uuid(10), reasonCode: "CONTACT_UNREACHABLE", status: "SUBMITTED", evidenceReference: "SHOT-1", decidedAt: null, reviewStartedAt: null });
    expect(dto.submittedAt).toBe(NOW.toISOString());
    expect(dto.respondBy).toBe("2026-10-14T10:00:00.000Z");
    expect(w.claims.rows).toHaveLength(1);
    expect(w.claims.rows[0]?.professionalProfileId).toBe(PRO_ID);
    expect(w.audit.entries).toHaveLength(1);
    expect(w.audit.entries[0]).toMatchObject({ adminUserId: PRO_USER, action: "LEAD_QUALITY_CLAIM_SUBMITTED", targetType: "LeadQualityClaim", targetId: w.claims.rows[0]?.id });
    expect(w.audit.entries[0]?.metadata).toMatchObject({ reasonCode: "CONTACT_UNREACHABLE", fromStatus: null, toStatus: "SUBMITTED" });
  });

  it("the audit entry never carries the description, evidence text or contact data", async () => {
    const w = world();
    await w.submit.execute(PRO_USER, input());
    expect(JSON.stringify(w.audit.entries)).not.toContain("never answers");
  });

  it("accepts every approved reason and no other", async () => {
    for (const [i, reasonCode] of (["CONTACT_UNREACHABLE", "CONTACT_INVALID", "DUPLICATE_LEAD"] as const).entries()) {
      const w = world({ purchases: [purchase({ id: uuid(20 + i) })] });
      expect((await w.submit.execute(PRO_USER, input({ leadPurchaseId: uuid(20 + i), reasonCode }))).reasonCode).toBe(reasonCode);
    }
    for (const bad of ["WORKMANSHIP", "PLATFORM_ERROR", "CLAIM_APPROVED", "", undefined]) {
      const w = world();
      expect(await reasonOf(w.submit.execute(PRO_USER, input({ reasonCode: bad })))).toBe("INVALID_INPUT");
      expect(w.claims.rows).toHaveLength(0);
    }
  });

  it("validates free text and evidence before any I/O (no row, no audit)", async () => {
    for (const patch of [{ description: "short" }, { description: "Call ana@example.com about it please" }, { description: 5 }, { evidenceReference: "has spaces" }]) {
      const w = world();
      expect(await reasonOf(w.submit.execute(PRO_USER, input(patch)))).toBe("INVALID_INPUT");
      expect(w.claims.rows).toHaveLength(0);
      expect(w.audit.entries).toHaveLength(0);
    }
    expect(await reasonOf(world().submit.execute("", input()))).toBe("INVALID_INPUT");
  });

  it("gives the SAME outcome for an unknown purchase, another professional's purchase, a non-CONFIRMED purchase, a malformed id, no profile and an inactive profile (no probing)", async () => {
    const cases: Array<[string, ReturnType<typeof world>, string, Record<string, unknown>]> = [
      ["unknown purchase", world(), PRO_USER, { leadPurchaseId: uuid(99) }],
      ["someone else's purchase", world({ purchases: [purchase({ professionalProfileId: OTHER_PRO_ID })] }), PRO_USER, {}],
      ["PENDING_PAYMENT", world({ purchases: [purchase({ status: "PENDING_PAYMENT", confirmedAt: null })] }), PRO_USER, {}],
      ["REFUNDED", world({ purchases: [purchase({ status: "REFUNDED" })] }), PRO_USER, {}],
      ["REVOKED", world({ purchases: [purchase({ status: "REVOKED" })] }), PRO_USER, {}],
      ["CONFIRMED without confirmedAt", world({ purchases: [purchase({ confirmedAt: null })] }), PRO_USER, {}],
      ["malformed id", world(), PRO_USER, { leadPurchaseId: "not-a-uuid" }],
      ["no professional profile", world({ professionals: [] }), PRO_USER, {}],
      ["inactive professional", world({ professionals: [professional({ status: "SUSPENDED" })] }), PRO_USER, {}],
      ["a user who is not the buyer", world({ professionals: [professional(), professional({ id: OTHER_PRO_ID, userId: OTHER_PRO_USER })] }), OTHER_PRO_USER, {}],
    ];
    for (const [label, w, user, patch] of cases) {
      expect(await reasonOf(w.submit.execute(user, input(patch))), label).toBe("PURCHASE_NOT_CLAIMABLE");
      expect(w.claims.rows, label).toHaveLength(0);
      expect(w.audit.entries, label).toHaveLength(0);
    }
  });

  it("derives the owner from the session only: client-supplied professional / owner fields are ignored", async () => {
    const w = world({ purchases: [purchase({ professionalProfileId: OTHER_PRO_ID })] });
    expect(await reasonOf(w.submit.execute(PRO_USER, { ...input(), professionalProfileId: OTHER_PRO_ID, userId: OTHER_PRO_USER } as never))).toBe("PURCHASE_NOT_CLAIMABLE");
    const ok = world();
    await ok.submit.execute(PRO_USER, { ...input(), professionalProfileId: OTHER_PRO_ID } as never);
    expect(ok.claims.rows[0]?.professionalProfileId).toBe(PRO_ID);
  });

  it("enforces the 72-hour window after confirmedAt (inclusive at the boundary)", async () => {
    const edge = world();
    edge.setClock(new Date("2026-10-13T10:00:00.000Z"));
    expect((await edge.submit.execute(PRO_USER, input())).status).toBe("SUBMITTED");
    const late = world();
    late.setClock(new Date("2026-10-13T10:00:00.001Z"));
    expect(await reasonOf(late.submit.execute(PRO_USER, input()))).toBe("CLAIM_WINDOW_CLOSED");
    expect(late.claims.rows).toHaveLength(0);
    const early = world();
    early.setClock(new Date("2026-10-10T09:59:00.000Z"));
    expect(await reasonOf(early.submit.execute(PRO_USER, input()))).toBe("CLAIM_WINDOW_CLOSED");
  });

  it("allows one claim per purchase: a repeated submission is ALREADY_CLAIMED and creates nothing", async () => {
    const w = world();
    await w.submit.execute(PRO_USER, input());
    expect(await reasonOf(w.submit.execute(PRO_USER, input({ reasonCode: "CONTACT_INVALID" })))).toBe("ALREADY_CLAIMED");
    expect(w.claims.rows).toHaveLength(1);
    expect(w.audit.entries).toHaveLength(1);
  });

  it("maps a database refusal under concurrency (lost race, limits) to the same closed codes", async () => {
    for (const reason of ["ALREADY_CLAIMED", "OPEN_CLAIM_LIMIT_REACHED", "PERIOD_CLAIM_LIMIT_REACHED", "CLAIM_WINDOW_CLOSED", "PURCHASE_NOT_CLAIMABLE"] as const) {
      const w = world();
      w.claims.failNextCreateWith = new LeadQualityClaimInsertConflictError(reason);
      expect(await reasonOf(w.submit.execute(PRO_USER, input()))).toBe(reason);
      expect(w.audit.entries).toHaveLength(0);
    }
    const w = world();
    w.claims.failNextCreateWith = new Error("boom") as never;
    expect(await reasonOf(w.submit.execute(PRO_USER, input()))).toBe("OTHER");
  });

  it("limits a professional to 3 OPEN claims; deciding one frees a slot", async () => {
    const purchases = [0, 1, 2, 3].map((i) => purchase({ id: uuid(30 + i) }));
    const w = world({ purchases });
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) ids.push((await w.submit.execute(PRO_USER, input({ leadPurchaseId: uuid(30 + i) }))).id);
    expect(await reasonOf(w.submit.execute(PRO_USER, input({ leadPurchaseId: uuid(33) })))).toBe("OPEN_CLAIM_LIMIT_REACHED");
    await w.decide.execute(ADMIN_ID, { claimId: ids[0] as string, decision: "REJECTED", explanation: "Number was reachable." });
    expect((await w.submit.execute(PRO_USER, input({ leadPurchaseId: uuid(33) }))).status).toBe("SUBMITTED");
  });

  it("UNDER_REVIEW claims count as open", async () => {
    const purchases = [0, 1, 2, 3].map((i) => purchase({ id: uuid(30 + i) }));
    const w = world({ purchases });
    for (let i = 0; i < 3; i += 1) {
      const dto = await w.submit.execute(PRO_USER, input({ leadPurchaseId: uuid(30 + i) }));
      await w.start.execute(ADMIN_ID, dto.id);
    }
    expect(await reasonOf(w.submit.execute(PRO_USER, input({ leadPurchaseId: uuid(33) })))).toBe("OPEN_CLAIM_LIMIT_REACHED");
  });

  it("limits a professional to 10 submitted claims in a rolling 30 days, counted over all statuses", async () => {
    const purchases = Array.from({ length: 11 }, (_, i) => purchase({ id: uuid(40 + i) }));
    const w = world({ purchases });
    for (let i = 0; i < 10; i += 1) {
      const dto = await w.submit.execute(PRO_USER, input({ leadPurchaseId: uuid(40 + i) }));
      await w.decide.execute(ADMIN_ID, { claimId: dto.id, decision: "REJECTED", explanation: "Reachable." }); // keeps "open" low
    }
    expect(await reasonOf(w.submit.execute(PRO_USER, input({ leadPurchaseId: uuid(50) })))).toBe("PERIOD_CLAIM_LIMIT_REACHED");
  });

  it("limits are per professional: another professional is unaffected", async () => {
    const purchases = [0, 1, 2].map((i) => purchase({ id: uuid(60 + i) })).concat(purchase({ id: uuid(63), professionalProfileId: OTHER_PRO_ID }));
    const w = world({ purchases, professionals: [professional(), professional({ id: OTHER_PRO_ID, userId: OTHER_PRO_USER })] });
    for (let i = 0; i < 3; i += 1) await w.submit.execute(PRO_USER, input({ leadPurchaseId: uuid(60 + i) }));
    expect((await w.submit.execute(OTHER_PRO_USER, input({ leadPurchaseId: uuid(63) }))).status).toBe("SUBMITTED");
  });

  it("never touches the purchase and exposes no financial outcome", async () => {
    const p = purchase();
    const before = JSON.stringify(p);
    const w = world({ purchases: [p] });
    const dto = await w.submit.execute(PRO_USER, input());
    expect(JSON.stringify(p)).toBe(before);
    expect(Object.keys(dto).join(",")).not.toMatch(/refund|amount|payment|ledger|invoice|credit/i);
  });

  it("H1: the claim and its audit entry are atomic — when the audit write fails the claim is NOT recorded and the caller gets the error", async () => {
    const w = world();
    w.audit.failNext = true;
    expect(await reasonOf(w.submit.execute(PRO_USER, input()))).toBe("OTHER");
    expect(w.claims.rows).toHaveLength(0);
    expect(w.audit.entries).toHaveLength(0);
    // nothing was consumed: the same submission succeeds afterwards, with exactly one claim and one audit entry
    expect((await w.submit.execute(PRO_USER, input())).status).toBe("SUBMITTED");
    expect(w.claims.rows).toHaveLength(1);
    expect(w.audit.entries).toHaveLength(1);
  });

  it("M1: submittedAt and respondBy come from the database clock — the use case cannot choose them, and the window is decided there", async () => {
    const w = world();
    w.setClock(new Date("2026-10-12T12:34:56.789Z"));
    const dto = await w.submit.execute(PRO_USER, input());
    expect(dto.submittedAt).toBe("2026-10-12T12:34:56.789Z");
    expect(dto.respondBy).toBe("2026-10-15T12:34:56.789Z");
    // an application clock far off the database clock changes nothing: only the database clock decides the window
    const skewed = world();
    const appClockBehind = new SubmitLeadQualityClaimUseCase(
      { findByUserId: async (userId) => skewed.professionals.find((p) => p.userId === userId) ?? null },
      { findById: async (id) => skewed.purchases.find((p) => p.id === id) ?? null },
      skewed.claims,
      () => new Date("2026-10-10T10:30:00.000Z"),
    );
    skewed.setClock(new Date("2026-10-13T10:00:00.001Z")); // 1 ms after the window closed, per the database
    expect(await reasonOf(appClockBehind.execute(PRO_USER, input()))).toBe("CLAIM_WINDOW_CLOSED");
    expect(skewed.claims.rows).toHaveLength(0);
  });
});

describe("Module 154 — administrative decisions", () => {
  async function submitted(w = world()) {
    const dto = await w.submit.execute(PRO_USER, input());
    return { w, id: dto.id };
  }

  it("start review: SUBMITTED -> UNDER_REVIEW, audited with the admin as actor", async () => {
    const { w, id } = await submitted();
    const dto = await w.start.execute(ADMIN_ID, id);
    expect(dto.status).toBe("UNDER_REVIEW");
    expect(dto.reviewStartedAt).toBe(NOW.toISOString());
    expect(w.claims.rows[0]).toMatchObject({ reviewStartedByUserId: ADMIN_ID });
    expect(w.audit.entries.at(-1)).toMatchObject({ adminUserId: ADMIN_ID, action: "LEAD_QUALITY_CLAIM_REVIEW_STARTED" });
    expect(w.audit.entries.at(-1)?.metadata).toMatchObject({ fromStatus: "SUBMITTED", toStatus: "UNDER_REVIEW" });
  });

  it("start review cannot be repeated and is not possible on a decided claim", async () => {
    const { w, id } = await submitted();
    await w.start.execute(ADMIN_ID, id);
    expect(await reasonOf(w.start.execute(ADMIN_ID, id))).toBe("INVALID_TRANSITION");
    await w.decide.execute(ADMIN_ID, { claimId: id, decision: "APPROVED", explanation: "Confirmed." });
    expect(await reasonOf(w.start.execute(ADMIN_ID, id))).toBe("INVALID_TRANSITION");
  });

  it.each(["APPROVED", "REJECTED"] as const)("%s from SUBMITTED and from UNDER_REVIEW records the decision, the admin and the explanation, and audits it", async (decision) => {
    for (const review of [false, true]) {
      const { w, id } = await submitted(world());
      if (review) await w.start.execute(ADMIN_ID, id);
      const dto = await w.decide.execute(ADMIN_ID, { claimId: id, decision, explanation: "  Verified against the call log.  " });
      expect(dto).toMatchObject({ status: decision, decisionExplanation: "Verified against the call log.", decidedAt: NOW.toISOString() });
      expect(w.claims.rows[0]).toMatchObject({ decidedByUserId: ADMIN_ID });
      expect(w.audit.entries.at(-1)).toMatchObject({ adminUserId: ADMIN_ID, action: `LEAD_QUALITY_CLAIM_${decision}` });
      expect(w.audit.entries.at(-1)?.metadata).toMatchObject({ fromStatus: review ? "UNDER_REVIEW" : "SUBMITTED", toStatus: decision });
      expect(JSON.stringify(w.audit.entries.at(-1))).not.toContain("call log");
    }
  });

  it("requires a decision explanation for BOTH approval and rejection (and rejects contact data in it)", async () => {
    for (const decision of ["APPROVED", "REJECTED"] as const) {
      for (const explanation of ["", "   ", undefined, "write to ana@example.com", "x".repeat(1001)]) {
        const { w, id } = await submitted();
        expect(await reasonOf(w.decide.execute(ADMIN_ID, { claimId: id, decision, explanation: explanation as never }))).toBe("INVALID_INPUT");
        expect(w.claims.rows[0]?.status).toBe("SUBMITTED");
      }
    }
  });

  it("rejects an invalid decision value (PENDING, UNDER_REVIEW, REFUNDED ...)", async () => {
    const { w, id } = await submitted();
    for (const decision of ["SUBMITTED", "UNDER_REVIEW", "REFUNDED", "CLAIM_APPROVED", "", undefined]) {
      expect(await reasonOf(w.decide.execute(ADMIN_ID, { claimId: id, decision: decision as never, explanation: "Because." }))).toBe("INVALID_INPUT");
    }
    expect(w.claims.rows[0]?.status).toBe("SUBMITTED");
  });

  it("a decided claim can never be decided again — same decision, opposite decision, or after review", async () => {
    for (const [first, second] of [["APPROVED", "APPROVED"], ["APPROVED", "REJECTED"], ["REJECTED", "APPROVED"], ["REJECTED", "REJECTED"]] as const) {
      const { w, id } = await submitted();
      await w.decide.execute(ADMIN_ID, { claimId: id, decision: first, explanation: "First." });
      expect(await reasonOf(w.decide.execute(ADMIN_ID, { claimId: id, decision: second, explanation: "Second." }))).toBe("INVALID_TRANSITION");
      expect(w.claims.rows[0]).toMatchObject({ status: first, decisionExplanation: "First." });
    }
  });

  it("when approval and rejection race, the status-conditional write lets exactly one win", async () => {
    const { w, id } = await submitted();
    w.claims.loseNextWrite = true; // the competing decision already won
    expect(await reasonOf(w.decide.execute(ADMIN_ID, { claimId: id, decision: "APPROVED", explanation: "Late." }))).toBe("INVALID_TRANSITION");
    expect(w.audit.entries).toHaveLength(1); // only the submission
    w.claims.loseNextWrite = true;
    expect(await reasonOf(w.start.execute(ADMIN_ID, id))).toBe("INVALID_TRANSITION");
  });

  it("an unknown or malformed claim id is CLAIM_NOT_FOUND", async () => {
    const w = world();
    expect(await reasonOf(w.decide.execute(ADMIN_ID, { claimId: uuid(999), decision: "APPROVED", explanation: "x" }))).toBe("CLAIM_NOT_FOUND");
    expect(await reasonOf(w.decide.execute(ADMIN_ID, { claimId: "nope", decision: "APPROVED", explanation: "x" }))).toBe("CLAIM_NOT_FOUND");
    expect(await reasonOf(w.start.execute(ADMIN_ID, uuid(999)))).toBe("CLAIM_NOT_FOUND");
  });

  it("H1: a failing audit write rolls the review-start back — the claim stays SUBMITTED and the caller gets the error", async () => {
    const { w, id } = await submitted();
    w.audit.failNext = true;
    expect(await reasonOf(w.start.execute(ADMIN_ID, id))).toBe("OTHER");
    expect(w.claims.rows[0]).toMatchObject({ status: "SUBMITTED", reviewStartedAt: null, reviewStartedByUserId: null });
    expect(w.audit.entries).toHaveLength(1); // only the submission
    expect((await w.start.execute(ADMIN_ID, id)).status).toBe("UNDER_REVIEW"); // and it can be retried
  });

  it.each(["APPROVED", "REJECTED"] as const)("H1: a failing audit write rolls the %s decision back — the claim keeps its previous state", async (decision) => {
    for (const review of [false, true]) {
      const { w, id } = await submitted(world());
      if (review) await w.start.execute(ADMIN_ID, id);
      const before = JSON.stringify(w.claims.rows[0]);
      const auditBefore = w.audit.entries.length;
      w.audit.failNext = true;
      expect(await reasonOf(w.decide.execute(ADMIN_ID, { claimId: id, decision, explanation: "Verified." }))).toBe("OTHER");
      expect(JSON.stringify(w.claims.rows[0])).toBe(before);
      expect(w.audit.entries).toHaveLength(auditBefore);
      expect((await w.decide.execute(ADMIN_ID, { claimId: id, decision, explanation: "Verified." })).status).toBe(decision);
    }
  });

  describe("M2: separation of duties", () => {
    const ownerAsAdmin = () => world({ admin: adminUser({ id: PRO_USER, roles: ["ADMIN"] }) });
    const GENERIC = new LeadQualityClaimRejectedError("ACTOR_NOT_AUTHORIZED").message;

    it("an admin who owns the claim's professional profile cannot start its review, approve it or reject it — and nothing changes", async () => {
      const w = ownerAsAdmin();
      const { id } = await submitted(w);
      expect(await reasonOf(w.start.execute(PRO_USER, id))).toBe("ACTOR_NOT_AUTHORIZED");
      for (const decision of ["APPROVED", "REJECTED"] as const) {
        expect(await reasonOf(w.decide.execute(PRO_USER, { claimId: id, decision, explanation: "My own claim." }))).toBe("ACTOR_NOT_AUTHORIZED");
      }
      expect(w.claims.rows[0]).toMatchObject({ status: "SUBMITTED", reviewStartedByUserId: null, decidedByUserId: null });
      expect(w.audit.entries).toHaveLength(1);
    });

    it("also after another admin started the review, and the refusal is the same generic error (nothing about ownership or state leaks)", async () => {
      const w = ownerAsAdmin();
      const { id } = await submitted(w);
      // another admin (a different identity) moves the claim; the owner-admin still cannot act, whatever the state
      const other = world({ admin: adminUser() });
      other.claims.rows.push(...w.claims.rows.map((r) => ({ ...r })));
      await other.start.execute(ADMIN_ID, id);
      await other.decide.execute(ADMIN_ID, { claimId: id, decision: "APPROVED", explanation: "Fine." });
      const decided = ownerAsAdmin();
      decided.claims.rows.push(...other.claims.rows.map((r) => ({ ...r })));
      for (const attempt of [() => decided.start.execute(PRO_USER, id), () => decided.decide.execute(PRO_USER, { claimId: id, decision: "REJECTED", explanation: "Again." })]) {
        try {
          await attempt();
          throw new Error("expected a refusal");
        } catch (e) {
          expect(e).toBeInstanceOf(LeadQualityClaimRejectedError);
          expect((e as LeadQualityClaimRejectedError).reason).toBe("ACTOR_NOT_AUTHORIZED"); // not INVALID_TRANSITION
          expect((e as Error).message).toBe(GENERIC);
        }
      }
    });

    it("derives ownership from persisted records: a client-supplied owner field changes nothing", async () => {
      const w = ownerAsAdmin();
      const { id } = await submitted(w);
      expect(await reasonOf(w.decide.execute(PRO_USER, { claimId: id, decision: "APPROVED", explanation: "x", professionalProfileId: OTHER_PRO_ID, ownerUserId: OTHER_PRO_USER } as never))).toBe("ACTOR_NOT_AUTHORIZED");
    });

    it("an admin who is also a professional CAN still handle OTHER professionals' claims", async () => {
      const w = world({
        admin: adminUser({ id: PRO_USER, roles: ["ADMIN"] }),
        purchases: [purchase({ id: uuid(70), professionalProfileId: OTHER_PRO_ID })],
        professionals: [professional(), professional({ id: OTHER_PRO_ID, userId: OTHER_PRO_USER })],
      });
      const dto = await w.submit.execute(OTHER_PRO_USER, input({ leadPurchaseId: uuid(70) }));
      expect((await w.start.execute(PRO_USER, dto.id)).status).toBe("UNDER_REVIEW");
      expect((await w.decide.execute(PRO_USER, { claimId: dto.id, decision: "REJECTED", explanation: "Reachable." })).status).toBe("REJECTED");
    });
  });

  describe("authorization is enforced in the use case and the admin is re-read on every call", () => {
    const denied: Array<[string, Parameters<typeof world>[0] & object]> = [
      ["unknown user", { admin: null }],
      ["a professional / customer without an admin role", { admin: adminUser({ roles: ["PROFESSIONAL"] }) }],
      ["a SUPPORT user", { admin: adminUser({ roles: ["SUPPORT"] }) }],
      ["no roles", { admin: adminUser({ roles: [] }) }],
      ["a SUSPENDED admin", { admin: adminUser({ status: "SUSPENDED" }) }],
      ["a BANNED admin", { admin: adminUser({ status: "BANNED" as never }) }],
      ["an INACTIVE admin", { admin: adminUser({ status: "DEACTIVATED" as never }) }],
      ["a failing admin lookup (fails closed)", { admin: "throws" }],
    ];
    it.each(denied)("denies %s for review, approval and rejection, changing nothing", async (_label, opts) => {
      const base = await submitted(world());
      const w = world(opts);
      w.claims.rows.push(...base.w.claims.rows.map((r) => ({ ...r })));
      const id = base.id;
      expect(await reasonOf(w.start.execute(ADMIN_ID, id))).toBe("ACTOR_NOT_AUTHORIZED");
      for (const decision of ["APPROVED", "REJECTED"] as const) {
        expect(await reasonOf(w.decide.execute(ADMIN_ID, { claimId: id, decision, explanation: "Because." }))).toBe("ACTOR_NOT_AUTHORIZED");
      }
      expect(w.claims.rows[0]?.status).toBe("SUBMITTED");
      expect(w.audit.entries).toHaveLength(0);
    });

    it("denies an empty / non-string actor id and the claiming professional acting as admin", async () => {
      const { w, id } = await submitted(world({ admin: null }));
      for (const actor of ["", "  ", undefined, null]) {
        expect(await reasonOf(w.decide.execute(actor as never, { claimId: id, decision: "APPROVED", explanation: "x" }))).toBe("ACTOR_NOT_AUTHORIZED");
      }
      expect(await reasonOf(w.decide.execute(PRO_USER, { claimId: id, decision: "APPROVED", explanation: "x" }))).toBe("ACTOR_NOT_AUTHORIZED");
    });

    it.each([["ADMIN"], ["SUPER_ADMIN"]])("allows an ACTIVE %s", async (role) => {
      const { w, id } = await submitted(world({ admin: adminUser({ roles: [role] }) }));
      expect((await w.decide.execute(ADMIN_ID, { claimId: id, decision: "APPROVED", explanation: "OK." })).status).toBe("APPROVED");
    });

    it("re-reads the admin on every call (a role revoked between two calls takes effect immediately)", async () => {
      const w = world();
      const dto = await w.submit.execute(PRO_USER, input());
      const state = { admin: adminUser() as AdminUserRecord | null };
      const admins = { getUserById: async () => state.admin };
      const start = new StartLeadQualityClaimReviewUseCase(admins, w.claims);
      const decide = new DecideLeadQualityClaimUseCase(admins, w.claims);
      await start.execute(ADMIN_ID, dto.id);
      state.admin = adminUser({ roles: [] });
      expect(await reasonOf(decide.execute(ADMIN_ID, { claimId: dto.id, decision: "APPROVED", explanation: "x" }))).toBe("ACTOR_NOT_AUTHORIZED");
      expect(w.claims.rows[0]?.status).toBe("UNDER_REVIEW");
    });
  });
});

describe("Module 154 — a claim decision is not a financial result", () => {
  it("approval records the decision only: no refund field, no purchase change, no M153 / gateway collaborator exists in the constructors", async () => {
    const p = purchase();
    const before = JSON.stringify(p);
    const w = world({ purchases: [p] });
    const dto = await w.submit.execute(PRO_USER, input());
    const approved = await w.decide.execute(ADMIN_ID, { claimId: dto.id, decision: "APPROVED", explanation: "Contact confirmed unreachable." });
    expect(approved.status).toBe("APPROVED");
    expect(JSON.stringify(p)).toBe(before);
    expect(Object.keys(approved).join(",")).not.toMatch(/refund|amount|payment|ledger|invoice|credit/i);
    expect(w.audit.entries.map((e) => e.action)).toEqual(["LEAD_QUALITY_CLAIM_SUBMITTED", "LEAD_QUALITY_CLAIM_APPROVED"]);
  });

  it("every claim reason, including an approved one, is unrelated to the M153 refund reasons", async () => {
    const w = world();
    const dto = await w.submit.execute(PRO_USER, input({ reasonCode: "DUPLICATE_LEAD" }));
    expect(dto.reasonCode).toBe("DUPLICATE_LEAD");
    expect(["PLATFORM_ERROR", "DUPLICATE_CHARGE"]).not.toContain(dto.reasonCode);
  });
});
