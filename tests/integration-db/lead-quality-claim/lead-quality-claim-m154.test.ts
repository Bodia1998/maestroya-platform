/**
 * Module 154 (Part A) — Lead Quality Claims against REAL PostgreSQL.
 *
 * Proves what mocks cannot: the migration's DDL, the one-claim-per-purchase unique index, the insert trigger (purchase cross-check,
 * 72-hour window, clock-skew guard, the 3-open / 10-per-30-days limits under genuinely concurrent submissions), the update trigger
 * (forward-only status, write-once decision, immutable content, approve-vs-reject races), the CHECKs, the no-delete rule, the real
 * Prisma adapter, the real audit trail, and that NO refund / ledger / invoice / credit-note row (and no purchase change) results from
 * a claim or its approval. Run with `npm run test:integration:db` (requires the guarded test database — see tests/test-utils/db).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DecideLeadQualityClaimUseCase } from "@/application/use-cases/lead-quality-claim/decide-lead-quality-claim.use-case";
import { StartLeadQualityClaimReviewUseCase } from "@/application/use-cases/lead-quality-claim/start-lead-quality-claim-review.use-case";
import { SubmitLeadQualityClaimUseCase } from "@/application/use-cases/lead-quality-claim/submit-lead-quality-claim.use-case";
import { LeadQualityClaimInsertConflictError } from "@/domain/repositories/lead-quality-claim-repository";
import { LeadQualityClaimRejectedError } from "@/domain/services/lead-quality-claim";
import { prisma } from "@/infrastructure/database/prisma/client";
import type * as AuditRepositoryModule from "@/infrastructure/database/prisma/repositories/prisma-admin-audit-log-repository";
import { recordAdminAuditLogWithin } from "@/infrastructure/database/prisma/repositories/prisma-admin-audit-log-repository";
import { PrismaAdminRepository } from "@/infrastructure/database/prisma/repositories/prisma-admin-repository";
import { PrismaLeadPurchaseRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-purchase-repository";
import { PrismaLeadQualityClaimRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-quality-claim-repository";
import { PrismaLeadRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-repository";
import { PrismaProfessionalRepository } from "@/infrastructure/database/prisma/repositories/prisma-professional-repository";

import { SNAPSHOT_DATA } from "../../test-utils/lead-publication-fixtures";
import { setupDbTestLifecycle } from "../../test-utils/db/db-test-lifecycle";
import { createAddress, createCustomerProfile, createProfessionalProfile, createServiceCategory, createServiceRequest, createUser } from "../../test-utils/db/seed-helpers";

vi.mock("@/infrastructure/observability/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Wraps (never replaces) the transactional audit insert so a test can make ONE real audit INSERT fail inside the transaction.
vi.mock("@/infrastructure/database/prisma/repositories/prisma-admin-audit-log-repository", async (importOriginal) => {
  const actual = await importOriginal<typeof AuditRepositoryModule>();
  return { ...actual, recordAdminAuditLogWithin: vi.fn(actual.recordAdminAuditLogWithin) };
});

describe("Module 154 — lead quality claims (real PostgreSQL)", () => {
  setupDbTestLifecycle();

  const leads = new PrismaLeadRepository();
  const purchases = new PrismaLeadPurchaseRepository();
  const claims = new PrismaLeadQualityClaimRepository();
  const professionals = new PrismaProfessionalRepository();
  const admins = new PrismaAdminRepository();
  let seq = 0;

  const submitUc = () => new SubmitLeadQualityClaimUseCase(professionals, purchases, claims);
  const startUc = () => new StartLeadQualityClaimReviewUseCase(admins, claims);
  const decideUc = () => new DecideLeadQualityClaimUseCase(admins, claims);

  /** A professional (user + profile). */
  async function newProfessional() {
    seq += 1;
    const user = await createUser(prisma, { name: `Pro ${seq}`, email: `m154-pro-${seq}@test.maestroya.invalid` });
    const profile = await createProfessionalProfile(prisma, user.id);
    return { userId: user.id, profileId: profile.id };
  }

  /** A real ADMIN (role row + user_roles) so the real AdminRepository does the lookup. */
  async function newAdmin(roleKey = "ADMIN", status: "ACTIVE" | "SUSPENDED" = "ACTIVE") {
    seq += 1;
    const user = await createUser(prisma, { name: `Admin ${seq}`, email: `m154-admin-${seq}@test.maestroya.invalid` });
    const role = await prisma.role.upsert({ where: { key: roleKey }, update: {}, create: { key: roleKey, name: roleKey } });
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
    if (status !== "ACTIVE") await prisma.user.update({ where: { id: user.id }, data: { status } });
    return user.id;
  }

  let shared: { customerUserId: string; addressId: string; customerId: string; categoryId: string } | null = null;
  beforeEach(() => {
    shared = null; // the lifecycle truncates the database before every test
  });
  async function customerWorld() {
    if (shared) return shared;
    const customerUser = await createUser(prisma, { name: "Ana Cliente", email: "m154-customer@test.maestroya.invalid" });
    const address = await createAddress(prisma, customerUser.id);
    const customer = await createCustomerProfile(prisma, customerUser.id);
    const category = await createServiceCategory(prisma);
    shared = { customerUserId: customerUser.id, addressId: address.id, customerId: customer.id, categoryId: category.id };
    return shared;
  }

  /** A published lead bought by `profileId`; CONFIRMED (confirmedAt = now - ageHours) unless `confirm` is false. */
  async function purchaseFor(profileId: string, opts: { confirm?: boolean; ageHours?: number } = {}) {
    const w = await customerWorld();
    const request = await createServiceRequest(prisma, { customerId: w.customerId, categoryId: w.categoryId, addressId: w.addressId });
    await prisma.serviceRequest.update({ where: { id: request.id }, data: { flowVersion: "LEAD_V1" } });
    const draft = await leads.create({ serviceRequestId: request.id });
    const lead = (await leads.publish(draft.id, { ...SNAPSHOT_DATA, price: "100.00", maxBuyers: 10 }))!;
    const purchase = await purchases.initiate({ leadId: lead.id, professionalProfileId: profileId });
    if (opts.confirm === false) return purchase.id;
    seq += 1;
    await purchases.recordPaymentReference(purchase.id, `pi_m154_${seq}`);
    const confirmed = await purchases.transition(purchase.id, "PENDING_PAYMENT", "CONFIRMED", new Date());
    expect(confirmed?.status).toBe("CONFIRMED");
    if (opts.ageHours !== undefined) {
      await prisma.leadPurchase.update({ where: { id: purchase.id }, data: { confirmedAt: new Date(Date.now() - opts.ageHours * 3_600_000) } });
    }
    return purchase.id;
  }

  const body = (purchaseId: string, patch: Record<string, unknown> = {}) => ({
    leadPurchaseId: purchaseId,
    reasonCode: "CONTACT_UNREACHABLE" as const,
    description: "The phone number never answers and messages bounce.",
    ...patch,
  });
  const rejection = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      return e instanceof LeadQualityClaimRejectedError ? e.reason : `OTHER:${(e as Error).message}`;
    }
    return null;
  };
  const sqlError = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      return String((e as Error).message);
    }
    throw new Error("expected a database error");
  };
  /** What a caller chooses. `submittedAt` / `respondBy` are the database's to decide. */
  const draftFor = (purchaseId: string, profileId: string, patch: Record<string, unknown> = {}) => ({
    leadPurchaseId: purchaseId,
    professionalProfileId: profileId,
    reasonCode: "CONTACT_INVALID" as const,
    description: "The number is not in service.",
    evidenceReference: null,
    ...patch,
  });
  /** Direct (bypassing the use case) raw INSERT payload for Prisma: the timestamps are placeholders the insert trigger must overwrite. */
  const rawInsert = (purchaseId: string, profileId: string, patch: Record<string, unknown> = {}) => ({
    ...draftFor(purchaseId, profileId),
    status: "SUBMITTED" as const,
    submittedAt: new Date(0),
    respondBy: new Date(0),
    ...patch,
  });
  const GHOST_USER = "00000000-0000-4000-8000-0000000000ff";
  const snapshotOf = async () => ({
    refunds: await prisma.leadFeeRefund.count(),
    ledger: await prisma.leadFeeLedgerEntry.count(),
    invoices: await prisma.leadFeeInvoice.count(),
    creditNotes: await prisma.leadFeeCreditNote.count(),
  });

  it("runs the whole workflow with the real adapter, real admin lookup and real audit trail — and moves no money, no purchase", async () => {
    const pro = await newProfessional();
    const admin = await newAdmin();
    const purchaseId = await purchaseFor(pro.profileId);
    const purchaseBefore = await prisma.leadPurchase.findUniqueOrThrow({ where: { id: purchaseId } });
    const before = await snapshotOf();

    const submitted = await submitUc().execute(pro.userId, body(purchaseId, { evidenceReference: "SHOT-9" }));
    expect(submitted).toMatchObject({ status: "SUBMITTED", reasonCode: "CONTACT_UNREACHABLE", evidenceReference: "SHOT-9" });
    expect(new Date(submitted.respondBy).getTime() - new Date(submitted.submittedAt).getTime()).toBe(72 * 3_600_000);

    expect((await startUc().execute(admin, submitted.id)).status).toBe("UNDER_REVIEW");
    const approved = await decideUc().execute(admin, { claimId: submitted.id, decision: "APPROVED", explanation: "Call log confirms the number is unreachable." });
    expect(approved).toMatchObject({ status: "APPROVED", decisionExplanation: "Call log confirms the number is unreachable." });

    const row = await prisma.leadQualityClaim.findUniqueOrThrow({ where: { id: submitted.id } });
    expect(row).toMatchObject({ status: "APPROVED", decidedByUserId: admin, reviewStartedByUserId: admin, professionalProfileId: pro.profileId, leadPurchaseId: purchaseId });
    expect(row.decidedAt).not.toBeNull();

    // A decision is not a financial result: the purchase is untouched and nothing was refunded / booked / invoiced.
    expect(await prisma.leadPurchase.findUniqueOrThrow({ where: { id: purchaseId } })).toEqual(purchaseBefore);
    expect(await snapshotOf()).toEqual(before);

    // Audit trail: one append-only entry per transition, ids only.
    const logs = await prisma.auditLog.findMany({ where: { entityType: "LeadQualityClaim", entityId: submitted.id }, orderBy: { createdAt: "asc" } });
    expect(logs).toHaveLength(3);
    expect(logs.map((l) => (l.metadata as { adminAction?: string }).adminAction ?? l.action)).toEqual(expect.arrayContaining(["LEAD_QUALITY_CLAIM_SUBMITTED", "LEAD_QUALITY_CLAIM_REVIEW_STARTED", "LEAD_QUALITY_CLAIM_APPROVED"]));
    expect(logs.map((l) => l.actorUserId).sort()).toEqual([pro.userId, admin, admin].sort());
    expect(JSON.stringify(logs)).not.toContain("never answers");
    expect(JSON.stringify(logs)).not.toContain("Call log");
  });

  describe("ownership and eligibility", () => {
    it("gives one undifferentiated outcome for another professional's purchase, a PENDING_PAYMENT purchase and an unknown purchase — and writes nothing", async () => {
      const owner = await newProfessional();
      const stranger = await newProfessional();
      const mine = await purchaseFor(owner.profileId);
      const pending = await purchaseFor(owner.profileId, { confirm: false });
      expect(await rejection(submitUc().execute(stranger.userId, body(mine)))).toBe("PURCHASE_NOT_CLAIMABLE");
      expect(await rejection(submitUc().execute(owner.userId, body(pending)))).toBe("PURCHASE_NOT_CLAIMABLE");
      expect(await rejection(submitUc().execute(owner.userId, body("00000000-0000-4000-8000-000000000001")))).toBe("PURCHASE_NOT_CLAIMABLE");
      expect(await prisma.leadQualityClaim.count()).toBe(0);
      expect(await prisma.auditLog.count({ where: { entityType: "LeadQualityClaim" } })).toBe(0);
    });

    it("a REFUNDED / REVOKED purchase is not claimable", async () => {
      const pro = await newProfessional();
      for (const target of ["REFUNDED", "REVOKED"] as const) {
        const id = await purchaseFor(pro.profileId);
        await purchases.transition(id, "CONFIRMED", target, new Date());
        expect(await rejection(submitUc().execute(pro.userId, body(id)))).toBe("PURCHASE_NOT_CLAIMABLE");
      }
    });

    it("the database itself refuses a claim for another professional's purchase or a non-CONFIRMED purchase (bypassing the use case)", async () => {
      const owner = await newProfessional();
      const stranger = await newProfessional();
      const mine = await purchaseFor(owner.profileId);
      const pending = await purchaseFor(owner.profileId, { confirm: false });
      await expect(claims.create(draftFor(mine, stranger.profileId), stranger.userId)).rejects.toMatchObject({ reason: "PURCHASE_NOT_CLAIMABLE" });
      await expect(claims.create(draftFor(pending, owner.profileId), owner.userId)).rejects.toMatchObject({ reason: "PURCHASE_NOT_CLAIMABLE" });
      expect(await prisma.leadQualityClaim.count()).toBe(0);
    });
  });

  describe("claim window (72 hours after confirmedAt)", () => {
    it("accepts a claim 71 hours after confirmation and rejects one 73 hours after — in the use case AND in the database", async () => {
      const pro = await newProfessional();
      const inside = await purchaseFor(pro.profileId, { ageHours: 71 });
      const outside = await purchaseFor(pro.profileId, { ageHours: 73 });
      expect((await submitUc().execute(pro.userId, body(inside))).status).toBe("SUBMITTED");
      expect(await rejection(submitUc().execute(pro.userId, body(outside)))).toBe("CLAIM_WINDOW_CLOSED");
      await expect(claims.create(draftFor(outside, pro.profileId), pro.userId)).rejects.toMatchObject({ reason: "CLAIM_WINDOW_CLOSED" });
      expect(await prisma.leadQualityClaim.count()).toBe(1);
    });
  });

  describe("M1 — the window is decided by the DATABASE clock", () => {
    it("lead_quality_claims_window_open: accepted at exactly confirmedAt + 72h and at confirmedAt; rejected 1 ms after and 1 ms before", async () => {
      const ok = async (confirmed: string, at: string) => {
        const rows = await prisma.$queryRawUnsafe<{ ok: boolean }[]>(`SELECT lead_quality_claims_window_open('${confirmed}'::timestamp, '${at}'::timestamp) AS ok`);
        return rows[0]?.ok;
      };
      expect(await ok("2026-10-10 10:00:00", "2026-10-13 10:00:00")).toBe(true); // exactly +72h: INCLUSIVE
      expect(await ok("2026-10-10 10:00:00", "2026-10-13 09:59:59.999")).toBe(true);
      expect(await ok("2026-10-10 10:00:00", "2026-10-13 10:00:00.001")).toBe(false); // 1 ms outside
      expect(await ok("2026-10-10 10:00:00", "2026-10-10 10:00:00")).toBe(true); // exactly at confirmation
      expect(await ok("2026-10-10 10:00:00", "2026-10-10 09:59:59.999")).toBe(false); // before confirmation
    });

    it("the insert trigger uses that rule: just inside the window is accepted, just outside is refused", async () => {
      const pro = await newProfessional();
      const inside = await purchaseFor(pro.profileId, { ageHours: 72 - 30 / 3600 }); // 30 s before the window closes
      const outside = await purchaseFor(pro.profileId, { ageHours: 72 + 2 / 3600 }); // closed 2 s ago
      expect((await claims.create(draftFor(inside, pro.profileId), pro.userId)).status).toBe("SUBMITTED");
      await expect(claims.create(draftFor(outside, pro.profileId), pro.userId)).rejects.toMatchObject({ reason: "CLAIM_WINDOW_CLOSED" });
      expect(await prisma.leadQualityClaim.count()).toBe(1);
    });

    it("a client cannot widen the window: a forged submittedAt that LOOKS inside the window is ignored and the claim is still refused", async () => {
      const pro = await newProfessional();
      const id = await purchaseFor(pro.profileId, { ageHours: 100 });
      const confirmedAt = (await prisma.leadPurchase.findUniqueOrThrow({ where: { id } })).confirmedAt!;
      const forged = new Date(confirmedAt.getTime() + 3_600_000); // 1 h after confirmation: "inside" by the client's reckoning
      expect(await sqlError(prisma.leadQualityClaim.create({ data: rawInsert(id, pro.profileId, { submittedAt: forged, respondBy: new Date(forged.getTime() + 72 * 3_600_000) }) }))).toMatch(/claim window/);
      expect(await prisma.leadQualityClaim.count()).toBe(0);
    });

    it("whatever submittedAt / respondBy the client sends, the stored values are the database clock and +72h (the CHECK stays consistent)", async () => {
      const pro = await newProfessional();
      const id = await purchaseFor(pro.profileId, { ageHours: 1 });
      const before = Date.now();
      const row = await prisma.leadQualityClaim.create({ data: rawInsert(id, pro.profileId, { submittedAt: new Date("2001-01-01T00:00:00Z"), respondBy: new Date("2001-01-02T00:00:00Z") }) });
      const after = Date.now();
      expect(row.submittedAt.getTime()).toBeGreaterThanOrEqual(before - 2000);
      expect(row.submittedAt.getTime()).toBeLessThanOrEqual(after + 2000);
      expect(row.respondBy.getTime() - row.submittedAt.getTime()).toBe(72 * 3_600_000);
      const inconsistent = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM lead_quality_claims WHERE "respondBy" <> "submittedAt" + INTERVAL '72 hours'`;
      expect(Number(inconsistent[0]?.n)).toBe(0);
    });

    it("the application clock plays no part: a wrong app clock neither rejects an in-window claim nor admits an out-of-window one", async () => {
      const pro = await newProfessional();
      const inWindow = await purchaseFor(pro.profileId, { ageHours: 71 });
      const stale = await purchaseFor(pro.profileId, { ageHours: 100 });
      const appInTheFuture = new SubmitLeadQualityClaimUseCase(professionals, purchases, claims, () => new Date("2035-01-01T00:00:00Z"));
      const appInThePast = new SubmitLeadQualityClaimUseCase(professionals, purchases, claims, () => new Date("2020-01-01T00:00:00Z"));
      const accepted = await appInTheFuture.execute(pro.userId, body(inWindow));
      expect(accepted.status).toBe("SUBMITTED");
      expect(Math.abs(new Date(accepted.submittedAt).getTime() - Date.now())).toBeLessThan(60_000); // the database's time, not 2035
      expect(await rejection(appInThePast.execute(pro.userId, body(stale)))).toBe("CLAIM_WINDOW_CLOSED");
    });
  });

  describe("one claim per purchase", () => {
    it("a repeated submission is ALREADY_CLAIMED", async () => {
      const pro = await newProfessional();
      const id = await purchaseFor(pro.profileId);
      await submitUc().execute(pro.userId, body(id));
      expect(await rejection(submitUc().execute(pro.userId, body(id, { reasonCode: "DUPLICATE_LEAD" })))).toBe("ALREADY_CLAIMED");
      expect(await prisma.leadQualityClaim.count()).toBe(1);
    });

    it("genuinely concurrent submissions for one purchase create exactly one claim (unique index)", async () => {
      const pro = await newProfessional();
      const id = await purchaseFor(pro.profileId);
      const settled = await Promise.allSettled([1, 2, 3, 4].map(() => submitUc().execute(pro.userId, body(id))));
      expect(settled.filter((s) => s.status === "fulfilled")).toHaveLength(1);
      for (const s of settled) if (s.status === "rejected") expect((s.reason as LeadQualityClaimRejectedError).reason).toBe("ALREADY_CLAIMED");
      expect(await prisma.leadQualityClaim.count()).toBe(1);
      expect(await prisma.auditLog.count({ where: { entityType: "LeadQualityClaim" } })).toBe(1);
    });
  });

  describe("anti-abuse limits (enforced by the database, serialized per professional)", () => {
    it("at most 3 OPEN claims, even when 5 submissions race (exactly 3 win, the rest are OPEN_CLAIM_LIMIT_REACHED)", async () => {
      const pro = await newProfessional();
      const ids: string[] = [];
      for (let i = 0; i < 5; i += 1) ids.push(await purchaseFor(pro.profileId));
      const settled = await Promise.allSettled(ids.map((id) => submitUc().execute(pro.userId, body(id))));
      expect(settled.filter((s) => s.status === "fulfilled")).toHaveLength(3);
      for (const s of settled) if (s.status === "rejected") expect((s.reason as LeadQualityClaimRejectedError).reason).toBe("OPEN_CLAIM_LIMIT_REACHED");
      expect(await prisma.leadQualityClaim.count({ where: { professionalProfileId: pro.profileId } })).toBe(3);
    });

    it("the trigger alone enforces the open limit (use-case pre-check bypassed) and deciding a claim frees a slot", async () => {
      const pro = await newProfessional();
      const admin = await newAdmin();
      const created = [];
      for (let i = 0; i < 3; i += 1) created.push(await claims.create(draftFor(await purchaseFor(pro.profileId), pro.profileId), pro.userId));
      const fourth = await purchaseFor(pro.profileId);
      await expect(claims.create(draftFor(fourth, pro.profileId), pro.userId)).rejects.toMatchObject({ reason: "OPEN_CLAIM_LIMIT_REACHED" });
      await decideUc().execute(admin, { claimId: created[0]!.id, decision: "REJECTED", explanation: "The number answers." });
      expect((await claims.create(draftFor(fourth, pro.profileId), pro.userId)).status).toBe("SUBMITTED");
    });

    it("UNDER_REVIEW counts as open", async () => {
      const pro = await newProfessional();
      const admin = await newAdmin();
      for (let i = 0; i < 3; i += 1) {
        const c = await claims.create(draftFor(await purchaseFor(pro.profileId), pro.profileId), pro.userId);
        await startUc().execute(admin, c.id);
      }
      await expect(claims.create(draftFor(await purchaseFor(pro.profileId), pro.profileId), pro.userId)).rejects.toMatchObject({ reason: "OPEN_CLAIM_LIMIT_REACHED" });
    });

    it("at most 10 claims in a rolling 30 days regardless of status; the 11th is PERIOD_CLAIM_LIMIT_REACHED", async () => {
      const pro = await newProfessional();
      const admin = await newAdmin();
      for (let i = 0; i < 10; i += 1) {
        const c = await claims.create(draftFor(await purchaseFor(pro.profileId), pro.profileId), pro.userId);
        await decideUc().execute(admin, { claimId: c.id, decision: i % 2 === 0 ? "APPROVED" : "REJECTED", explanation: "Decided." });
      }
      expect(await prisma.leadQualityClaim.count({ where: { status: { in: ["SUBMITTED", "UNDER_REVIEW"] } } })).toBe(0);
      const eleventh = await purchaseFor(pro.profileId);
      expect(await rejection(submitUc().execute(pro.userId, body(eleventh)))).toBe("PERIOD_CLAIM_LIMIT_REACHED");
      await expect(claims.create(draftFor(eleventh, pro.profileId), pro.userId)).rejects.toMatchObject({ reason: "PERIOD_CLAIM_LIMIT_REACHED" });
    });

    it("limits are per professional", async () => {
      const a = await newProfessional();
      const b = await newProfessional();
      for (let i = 0; i < 3; i += 1) await claims.create(draftFor(await purchaseFor(a.profileId), a.profileId), a.userId);
      expect((await submitUc().execute(b.userId, body(await purchaseFor(b.profileId)))).status).toBe("SUBMITTED");
    });
  });

  describe("decisions: authorization, transitions and races", () => {
    async function open() {
      const pro = await newProfessional();
      const id = await purchaseFor(pro.profileId);
      const claim = await submitUc().execute(pro.userId, body(id));
      return { pro, purchaseId: id, claimId: claim.id };
    }

    it("re-reads the admin from the database on every call: customers, suspended admins and unknown users are denied; SUPER_ADMIN is allowed", async () => {
      const { claimId, pro } = await open();
      const suspended = await newAdmin("ADMIN", "SUSPENDED");
      const nonAdmin = await newAdmin("CUSTOMER");
      for (const actor of [pro.userId, suspended, nonAdmin, "00000000-0000-4000-8000-000000000002"]) {
        expect(await rejection(decideUc().execute(actor, { claimId, decision: "APPROVED", explanation: "Nope." }))).toBe("ACTOR_NOT_AUTHORIZED");
        expect(await rejection(startUc().execute(actor, claimId))).toBe("ACTOR_NOT_AUTHORIZED");
      }
      expect((await prisma.leadQualityClaim.findUniqueOrThrow({ where: { id: claimId } })).status).toBe("SUBMITTED");
      const superAdmin = await newAdmin("SUPER_ADMIN");
      expect((await decideUc().execute(superAdmin, { claimId, decision: "REJECTED", explanation: "The number answers." })).status).toBe("REJECTED");
      // an admin suspended AFTER a first successful call is denied on the next one
      const second = await open();
      const flaky = await newAdmin();
      await startUc().execute(flaky, second.claimId);
      await prisma.user.update({ where: { id: flaky }, data: { status: "SUSPENDED" } });
      expect(await rejection(decideUc().execute(flaky, { claimId: second.claimId, decision: "APPROVED", explanation: "x" }))).toBe("ACTOR_NOT_AUTHORIZED");
    });

    it("a decided claim can never be decided or reviewed again, whatever the decision", async () => {
      for (const [first, second] of [["APPROVED", "APPROVED"], ["APPROVED", "REJECTED"], ["REJECTED", "APPROVED"]] as const) {
        const { claimId } = await open();
        const admin = await newAdmin();
        await decideUc().execute(admin, { claimId, decision: first, explanation: "First." });
        expect(await rejection(decideUc().execute(admin, { claimId, decision: second, explanation: "Second." }))).toBe("INVALID_TRANSITION");
        expect(await rejection(startUc().execute(admin, claimId))).toBe("INVALID_TRANSITION");
        expect(await prisma.leadQualityClaim.findUniqueOrThrow({ where: { id: claimId } })).toMatchObject({ status: first, decisionExplanation: "First." });
      }
    });

    it("concurrent approval and rejection: exactly one wins and the stored decision matches the winner", async () => {
      const { claimId } = await open();
      const [a, b] = [await newAdmin(), await newAdmin()];
      const settled = await Promise.allSettled([
        decideUc().execute(a, { claimId, decision: "APPROVED", explanation: "Approved by A." }),
        decideUc().execute(b, { claimId, decision: "REJECTED", explanation: "Rejected by B." }),
        decideUc().execute(a, { claimId, decision: "APPROVED", explanation: "Approved again by A." }),
      ]);
      const winners = settled.filter((s): s is PromiseFulfilledResult<Awaited<ReturnType<ReturnType<typeof decideUc>["execute"]>>> => s.status === "fulfilled");
      expect(winners).toHaveLength(1);
      for (const s of settled) if (s.status === "rejected") expect((s.reason as LeadQualityClaimRejectedError).reason).toBe("INVALID_TRANSITION");
      const row = await prisma.leadQualityClaim.findUniqueOrThrow({ where: { id: claimId } });
      expect(row.status).toBe(winners[0]!.value.status);
      expect(row.decisionExplanation).toBe(winners[0]!.value.decisionExplanation);
      expect(await prisma.auditLog.count({ where: { entityType: "LeadQualityClaim", entityId: claimId } })).toBe(2); // submission + the single decision
    });

    it("concurrent review-start by two admins: exactly one succeeds", async () => {
      const { claimId } = await open();
      const [a, b] = [await newAdmin(), await newAdmin()];
      const settled = await Promise.allSettled([startUc().execute(a, claimId), startUc().execute(b, claimId)]);
      expect(settled.filter((s) => s.status === "fulfilled")).toHaveLength(1);
      expect((await prisma.leadQualityClaim.findUniqueOrThrow({ where: { id: claimId } })).status).toBe("UNDER_REVIEW");
    });

    it("a claim decision never changes the purchase or any M153 / ledger / invoice / credit-note row, and an approved claim creates no refund", async () => {
      const { claimId, purchaseId } = await open();
      const admin = await newAdmin();
      const purchaseBefore = await prisma.leadPurchase.findUniqueOrThrow({ where: { id: purchaseId } });
      const before = await snapshotOf();
      await decideUc().execute(admin, { claimId, decision: "APPROVED", explanation: "Confirmed." });
      expect(await prisma.leadPurchase.findUniqueOrThrow({ where: { id: purchaseId } })).toEqual(purchaseBefore);
      expect(purchaseBefore.status).toBe("CONFIRMED");
      expect(await snapshotOf()).toEqual(before);
      expect(before.refunds).toBe(0);
    });
  });

  describe("database guarantees", () => {
    async function row() {
      const pro = await newProfessional();
      const id = await purchaseFor(pro.profileId);
      const claim = await claims.create(draftFor(id, pro.profileId), pro.userId);
      return { pro, id, claim };
    }

    it("makes who/what/when immutable", async () => {
      const { claim } = await row();
      const other = await newProfessional();
      for (const data of [
        { description: "A rewritten description of the problem." },
        { reasonCode: "DUPLICATE_LEAD" as const },
        { evidenceReference: "NEW-1" },
        { professionalProfileId: other.profileId },
        { submittedAt: new Date(Date.now() - 1000) },
        { respondBy: new Date(Date.now() + 1000) },
      ]) {
        expect(await sqlError(prisma.leadQualityClaim.update({ where: { id: claim.id }, data }))).toMatch(/immutable|respond_by_check/);
      }
      expect(await prisma.leadQualityClaim.findUniqueOrThrow({ where: { id: claim.id } })).toMatchObject({ description: claim.description, reasonCode: "CONTACT_INVALID" });
    });

    it("moves status forward only, requires the decision fields exactly when decided, and makes them write-once", async () => {
      const { claim } = await row();
      const admin = await newAdmin();
      // a status change without its fields violates the CHECK
      expect(await sqlError(prisma.leadQualityClaim.update({ where: { id: claim.id }, data: { status: "APPROVED" } }))).toMatch(/status_fields_check/);
      expect(await sqlError(prisma.leadQualityClaim.update({ where: { id: claim.id }, data: { status: "UNDER_REVIEW" } }))).toMatch(/status_fields_check/);
      await prisma.leadQualityClaim.update({ where: { id: claim.id }, data: { status: "UNDER_REVIEW", reviewStartedAt: new Date(), reviewStartedByUserId: admin } });
      expect(await sqlError(prisma.leadQualityClaim.update({ where: { id: claim.id }, data: { status: "SUBMITTED", reviewStartedAt: null, reviewStartedByUserId: null } }))).toMatch(/illegal status transition|write-once/);
      expect(await sqlError(prisma.leadQualityClaim.update({ where: { id: claim.id }, data: { status: "SUBMITTED" } }))).toMatch(/illegal status transition|status_fields_check/);
      await prisma.leadQualityClaim.update({ where: { id: claim.id }, data: { status: "REJECTED", decidedAt: new Date(), decidedByUserId: admin, decisionExplanation: "No." } });
      for (const data of [
        { status: "APPROVED" as const },
        { status: "UNDER_REVIEW" as const },
        { decisionExplanation: "Changed my mind." },
        { decidedAt: new Date(Date.now() + 5000) },
        { decidedByUserId: (await newAdmin()) },
        { reviewStartedAt: new Date(Date.now() + 5000) },
      ]) {
        expect(await sqlError(prisma.leadQualityClaim.update({ where: { id: claim.id }, data }))).toMatch(/illegal status transition|write-once|status_fields_check/);
      }
      expect((await prisma.leadQualityClaim.findUniqueOrThrow({ where: { id: claim.id } })).status).toBe("REJECTED");
    });

    it("never deletes a claim (history is preserved), and the purchase cannot be deleted while a claim references it", async () => {
      const { claim, id } = await row();
      expect(await sqlError(prisma.leadQualityClaim.delete({ where: { id: claim.id } }))).toMatch(/never deleted/);
      expect(await sqlError(prisma.$executeRaw`DELETE FROM lead_quality_claims WHERE id = ${claim.id}::uuid`)).toMatch(/never deleted/);
      expect(await sqlError(prisma.leadPurchase.delete({ where: { id } }))).toMatch(/Foreign key|foreign key|violat/i);
      expect(await prisma.leadQualityClaim.count()).toBe(1);
    });

    it("enforces the shape CHECKs (text lengths) and a bare SUBMITTED insert", async () => {
      const pro = await newProfessional();
      const a = await purchaseFor(pro.profileId);
      const b = await purchaseFor(pro.profileId);
      const c = await purchaseFor(pro.profileId);
      // a respondBy that is not submittedAt + 72h cannot even be inserted: the trigger derives it (see the M1 tests); the CHECK stays as a backstop
      void a;
      expect(await sqlError(prisma.leadQualityClaim.create({ data: rawInsert(b, pro.profileId, { description: "short" }) }))).toMatch(/text_check/);
      expect(await sqlError(prisma.leadQualityClaim.create({ data: { ...rawInsert(c, pro.profileId), status: "APPROVED", decidedAt: new Date(), decidedByUserId: await newAdmin(), decisionExplanation: "Pre-approved." } }))).toMatch(/bare SUBMITTED/);
      expect(await prisma.leadQualityClaim.count()).toBe(0);
    });

    it("only the three approved reasons exist as enum values, and the status enum is exactly the four states", async () => {
      const reasons = await prisma.$queryRaw<{ enumlabel: string }[]>`SELECT e.enumlabel::text AS enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'LeadQualityClaimReason' ORDER BY e.enumsortorder`;
      expect(reasons.map((r) => r.enumlabel)).toEqual(["CONTACT_UNREACHABLE", "CONTACT_INVALID", "DUPLICATE_LEAD"]);
      const statuses = await prisma.$queryRaw<{ enumlabel: string }[]>`SELECT e.enumlabel::text AS enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'LeadQualityClaimStatus' ORDER BY e.enumsortorder`;
      expect(statuses.map((r) => r.enumlabel)).toEqual(["SUBMITTED", "UNDER_REVIEW", "APPROVED", "REJECTED"]);
    });

    it("leaves Module 153 untouched: the refund reason enum still has exactly two values and no CLAIM_APPROVED exists anywhere", async () => {
      const refundReasons = await prisma.$queryRaw<{ enumlabel: string }[]>`SELECT e.enumlabel::text AS enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'LeadFeeRefundReason' ORDER BY e.enumsortorder`;
      expect(refundReasons.map((r) => r.enumlabel)).toEqual(["PLATFORM_ERROR", "DUPLICATE_CHARGE"]);
      const claimApproved = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM pg_enum WHERE enumlabel = 'CLAIM_APPROVED'`;
      expect(Number(claimApproved[0]?.n)).toBe(0);
      const refundTriggers = await prisma.$queryRaw<{ tgname: string }[]>`SELECT tgname::text AS tgname FROM pg_trigger WHERE tgrelid = 'lead_fee_refunds'::regclass AND NOT tgisinternal ORDER BY tgname`;
      expect(refundTriggers.map((t) => t.tgname)).toEqual(["lead_fee_refunds_guard_update_trg", "lead_fee_refunds_no_delete_trg", "lead_fee_refunds_validate_insert_trg"]);
      const claimRefs = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM information_schema.columns WHERE table_name = 'lead_quality_claims' AND (column_name ILIKE '%refund%' OR column_name ILIKE '%amount%' OR column_name ILIKE '%payment%' OR column_name ILIKE '%ledger%' OR column_name ILIKE '%invoice%')`;
      expect(Number(claimRefs[0]?.n)).toBe(0);
    });

    it("maps database refusals to closed conflict reasons through the adapter", async () => {
      const { pro, id } = await row();
      await expect(claims.create(draftFor(id, pro.profileId), pro.userId)).rejects.toBeInstanceOf(LeadQualityClaimInsertConflictError);
      await expect(claims.create(draftFor(id, pro.profileId), pro.userId)).rejects.toMatchObject({ reason: "ALREADY_CLAIMED" });
    });
  });

  describe("H1 — claim transition and audit entry are ONE transaction", () => {
    const auditCount = (claimId?: string) => prisma.auditLog.count({ where: { entityType: "LeadQualityClaim", ...(claimId ? { entityId: claimId } : {}) } });
    /** Makes the NEXT transactional audit INSERT fail for real (an actor that does not exist violates the audit_logs foreign key). */
    async function failNextAuditInsert() {
      const actual = await vi.importActual<typeof AuditRepositoryModule>("@/infrastructure/database/prisma/repositories/prisma-admin-audit-log-repository");
      vi.mocked(recordAdminAuditLogWithin).mockImplementationOnce((client, data, createdAt) => actual.recordAdminAuditLogWithin(client, { ...data, adminUserId: GHOST_USER }, createdAt));
    }

    it("submission: a failing audit INSERT leaves NO claim behind and the caller gets an error; a retry then succeeds", async () => {
      const pro = await newProfessional();
      const id = await purchaseFor(pro.profileId);
      await failNextAuditInsert();
      const outcome = await rejection(submitUc().execute(pro.userId, body(id)));
      expect(outcome).toMatch(/^OTHER:/);
      expect(await prisma.leadQualityClaim.count()).toBe(0);
      expect(await auditCount()).toBe(0);
      expect((await submitUc().execute(pro.userId, body(id))).status).toBe("SUBMITTED"); // the purchase was not "used up"
      expect(await prisma.leadQualityClaim.count()).toBe(1);
      expect(await auditCount()).toBe(1);
    });

    it("start-review: a failing audit INSERT rolls the (already executed) UPDATE back — the claim stays SUBMITTED", async () => {
      const pro = await newProfessional();
      const admin = await newAdmin();
      const claim = await submitUc().execute(pro.userId, body(await purchaseFor(pro.profileId)));
      const before = await prisma.leadQualityClaim.findUniqueOrThrow({ where: { id: claim.id } });
      await failNextAuditInsert();
      expect(await rejection(startUc().execute(admin, claim.id))).toMatch(/^OTHER:/);
      expect(await prisma.leadQualityClaim.findUniqueOrThrow({ where: { id: claim.id } })).toEqual(before);
      expect(await auditCount(claim.id)).toBe(1); // the submission only
      expect((await startUc().execute(admin, claim.id)).status).toBe("UNDER_REVIEW");
      expect(await auditCount(claim.id)).toBe(2);
    });

    it.each(["APPROVED", "REJECTED"] as const)("%s: a failing audit INSERT rolls the decision back from SUBMITTED and from UNDER_REVIEW", async (decision) => {
      for (const review of [false, true]) {
        const pro = await newProfessional();
        const admin = await newAdmin();
        const claim = await submitUc().execute(pro.userId, body(await purchaseFor(pro.profileId)));
        if (review) await startUc().execute(admin, claim.id);
        const before = await prisma.leadQualityClaim.findUniqueOrThrow({ where: { id: claim.id } });
        const auditBefore = await auditCount(claim.id);
        await failNextAuditInsert();
        expect(await rejection(decideUc().execute(admin, { claimId: claim.id, decision, explanation: "Verified." }))).toMatch(/^OTHER:/);
        expect(await prisma.leadQualityClaim.findUniqueOrThrow({ where: { id: claim.id } })).toEqual(before);
        expect(before).toMatchObject({ status: review ? "UNDER_REVIEW" : "SUBMITTED", decidedAt: null, decisionExplanation: null });
        expect(await auditCount(claim.id)).toBe(auditBefore);
        expect((await decideUc().execute(admin, { claimId: claim.id, decision, explanation: "Verified." })).status).toBe(decision);
        expect(await auditCount(claim.id)).toBe(auditBefore + 1);
      }
    });

    it("every committed transition has exactly one audit entry and every audit entry has its transition (no orphans either way)", async () => {
      const pro = await newProfessional();
      const admin = await newAdmin();
      const claim = await submitUc().execute(pro.userId, body(await purchaseFor(pro.profileId)));
      await startUc().execute(admin, claim.id);
      await decideUc().execute(admin, { claimId: claim.id, decision: "REJECTED", explanation: "Reachable." });
      const logs = await prisma.auditLog.findMany({ where: { entityType: "LeadQualityClaim", entityId: claim.id }, orderBy: { createdAt: "asc" } });
      const meta = (l: (typeof logs)[number]) => l.metadata as { adminAction: string; fromStatus: string | null; toStatus: string };
      const sorted = [...logs].sort((x, y) => ["LEAD_QUALITY_CLAIM_SUBMITTED", "LEAD_QUALITY_CLAIM_REVIEW_STARTED", "LEAD_QUALITY_CLAIM_REJECTED"].indexOf(meta(x).adminAction) - ["LEAD_QUALITY_CLAIM_SUBMITTED", "LEAD_QUALITY_CLAIM_REVIEW_STARTED", "LEAD_QUALITY_CLAIM_REJECTED"].indexOf(meta(y).adminAction));
      expect(sorted.map((l) => [meta(l).fromStatus, meta(l).toStatus])).toEqual([[null, "SUBMITTED"], ["SUBMITTED", "UNDER_REVIEW"], ["UNDER_REVIEW", "REJECTED"]]);
    });

    it("audit ordering under concurrency: racing review-starts and decisions on many claims always leave a consistent, correctly ordered trail", async () => {
      const admins2 = [await newAdmin(), await newAdmin(), await newAdmin(), await newAdmin()];
      const claimIds: string[] = [];
      for (let i = 0; i < 6; i += 1) {
        const pro = await newProfessional();
        claimIds.push((await submitUc().execute(pro.userId, body(await purchaseFor(pro.profileId)))).id);
      }
      await Promise.allSettled(
        claimIds.flatMap((claimId) => [
          startUc().execute(admins2[0]!, claimId),
          decideUc().execute(admins2[1]!, { claimId, decision: "APPROVED", explanation: "Approved." }),
          startUc().execute(admins2[2]!, claimId),
          decideUc().execute(admins2[3]!, { claimId, decision: "REJECTED", explanation: "Rejected." }),
        ]),
      );
      for (const claimId of claimIds) {
        const row = await prisma.leadQualityClaim.findUniqueOrThrow({ where: { id: claimId } });
        const logs = await prisma.auditLog.findMany({ where: { entityType: "LeadQualityClaim", entityId: claimId } });
        const by = (action: string) => logs.filter((l) => (l.metadata as { adminAction: string }).adminAction === action);
        const meta = (l: (typeof logs)[number]) => l.metadata as { fromStatus: string | null; toStatus: string };
        const review = by("LEAD_QUALITY_CLAIM_REVIEW_STARTED");
        const decisions = [...by("LEAD_QUALITY_CLAIM_APPROVED"), ...by("LEAD_QUALITY_CLAIM_REJECTED")];
        // exactly one decision won, and its audit entry says so
        expect(row.status === "APPROVED" || row.status === "REJECTED").toBe(true);
        expect(decisions).toHaveLength(1);
        expect(meta(decisions[0]!).toStatus).toBe(row.status);
        expect(by("LEAD_QUALITY_CLAIM_SUBMITTED")).toHaveLength(1);
        expect(review.length).toBeLessThanOrEqual(1);
        // the recorded fromStatus is the TRUE previous status (read under the row lock), so the trail is a valid chain in commit order
        if (review.length === 1) {
          expect(row.reviewStartedAt).not.toBeNull();
          expect(meta(review[0]!)).toMatchObject({ fromStatus: "SUBMITTED", toStatus: "UNDER_REVIEW" });
          expect(meta(decisions[0]!).fromStatus).toBe("UNDER_REVIEW");
          expect(review[0]!.createdAt.getTime()).toBeLessThanOrEqual(decisions[0]!.createdAt.getTime()); // database clock under the row lock
        } else {
          expect(row.reviewStartedAt).toBeNull();
          expect(meta(decisions[0]!).fromStatus).toBe("SUBMITTED");
        }
        expect(logs).toHaveLength(2 + review.length);
        expect(logs.map((l) => l.actorUserId).filter((u) => u === null)).toHaveLength(0);
      }
    });
  });

  describe("M2 — separation of duties (admin vs the claim's own professional profile)", () => {
    /** A professional who is ALSO an administrator. */
    async function newProfessionalAdmin() {
      const pro = await newProfessional();
      const role = await prisma.role.upsert({ where: { key: "ADMIN" }, update: {}, create: { key: "ADMIN", name: "ADMIN" } });
      await prisma.userRole.create({ data: { userId: pro.userId, roleId: role.id } });
      return pro;
    }
    const message = async (p: Promise<unknown>) => {
      try {
        await p;
      } catch (e) {
        return e instanceof LeadQualityClaimRejectedError ? `${e.reason}|${e.message}` : `OTHER:${(e as Error).message}`;
      }
      return null;
    };

    it("an admin who owns the claim's professional profile can neither start its review nor approve nor reject it, and nothing changes", async () => {
      const owner = await newProfessionalAdmin();
      const claim = await submitUc().execute(owner.userId, body(await purchaseFor(owner.profileId)));
      const before = await prisma.leadQualityClaim.findUniqueOrThrow({ where: { id: claim.id } });
      expect(await rejection(startUc().execute(owner.userId, claim.id))).toBe("ACTOR_NOT_AUTHORIZED");
      for (const decision of ["APPROVED", "REJECTED"] as const) {
        expect(await rejection(decideUc().execute(owner.userId, { claimId: claim.id, decision, explanation: "My own claim." }))).toBe("ACTOR_NOT_AUTHORIZED");
      }
      expect(await prisma.leadQualityClaim.findUniqueOrThrow({ where: { id: claim.id } })).toEqual(before);
      expect(await prisma.auditLog.count({ where: { entityType: "LeadQualityClaim", entityId: claim.id } })).toBe(1);
    });

    it("the refusal is the generic authorization error — identical to a non-admin's — in every claim state (nothing leaks about ownership or state)", async () => {
      const owner = await newProfessionalAdmin();
      const stranger = await newAdmin("CUSTOMER"); // not an admin at all
      const other = await newAdmin();
      const claim = await submitUc().execute(owner.userId, body(await purchaseFor(owner.profileId)));
      const generic = await message(startUc().execute(stranger, claim.id));
      expect(generic).toMatch(/^ACTOR_NOT_AUTHORIZED\|/);
      expect(await message(startUc().execute(owner.userId, claim.id))).toBe(generic);
      await startUc().execute(other, claim.id); // another admin moves it along
      await decideUc().execute(other, { claimId: claim.id, decision: "APPROVED", explanation: "Fine." });
      // now decided: the owner still gets the SAME error, not INVALID_TRANSITION
      expect(await message(startUc().execute(owner.userId, claim.id))).toBe(generic);
      expect(await message(decideUc().execute(owner.userId, { claimId: claim.id, decision: "REJECTED", explanation: "Again." }))).toBe(generic);
    });

    it("ownership is read from persisted records, also for a soft-deleted profile", async () => {
      const owner = await newProfessionalAdmin();
      const claim = await submitUc().execute(owner.userId, body(await purchaseFor(owner.profileId)));
      await prisma.professionalProfile.update({ where: { id: owner.profileId }, data: { deletedAt: new Date() } });
      expect(await rejection(startUc().execute(owner.userId, claim.id))).toBe("ACTOR_NOT_AUTHORIZED");
      expect((await prisma.leadQualityClaim.findUniqueOrThrow({ where: { id: claim.id } })).status).toBe("SUBMITTED");
    });

    it("an admin who is also a professional can still review and decide OTHER professionals' claims", async () => {
      const adminPro = await newProfessionalAdmin();
      const other = await newProfessional();
      const claim = await submitUc().execute(other.userId, body(await purchaseFor(other.profileId)));
      expect((await startUc().execute(adminPro.userId, claim.id)).status).toBe("UNDER_REVIEW");
      expect((await decideUc().execute(adminPro.userId, { claimId: claim.id, decision: "REJECTED", explanation: "Reachable." })).status).toBe("REJECTED");
    });

    it("the database backstop refuses a review-start or decision recorded for the claim owner, even when the use case is bypassed", async () => {
      const owner = await newProfessionalAdmin();
      const claim = await submitUc().execute(owner.userId, body(await purchaseFor(owner.profileId)));
      expect(await sqlError(prisma.leadQualityClaim.update({ where: { id: claim.id }, data: { status: "UNDER_REVIEW", reviewStartedAt: new Date(), reviewStartedByUserId: owner.userId } }))).toMatch(/separation of duties/);
      expect(await sqlError(prisma.leadQualityClaim.update({ where: { id: claim.id }, data: { status: "APPROVED", decidedAt: new Date(), decidedByUserId: owner.userId, decisionExplanation: "Self-approved." } }))).toMatch(/separation of duties/);
      expect((await prisma.leadQualityClaim.findUniqueOrThrow({ where: { id: claim.id } })).status).toBe("SUBMITTED");
    });
  });
});
