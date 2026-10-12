/**
 * Module 158 — GDPR / consent / retention for LEAD_V1 against REAL PostgreSQL.
 * Covers: the contact-sharing evidence table (DB-enforced invariants), consent record / withdraw, the contact gate (M138 readers),
 * the erased-customer sweep, bounded terminal-content minimization, idempotency / concurrency, and record preservation.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/infrastructure/database/prisma/client";
import { PrismaAdminAuditLogRepository } from "@/infrastructure/database/prisma/repositories/prisma-admin-audit-log-repository";
import { PrismaCustomerProfileRepository } from "@/infrastructure/database/prisma/repositories/prisma-customer-profile-repository";
import { PrismaLeadContactAuthorizationReader, PrismaLeadContactReader } from "@/infrastructure/database/prisma/repositories/prisma-lead-contact-access-repository";
import { PrismaLeadContactSharingRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-contact-sharing-repository";
import { PrismaLeadPrivacyRetentionRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-privacy-retention-repository";
import { PrismaLeadPurchaseRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-purchase-repository";
import { PrismaLeadRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-repository";
import { PrismaProfessionalRepository } from "@/infrastructure/database/prisma/repositories/prisma-professional-repository";
import { PrismaServiceRequestRepository } from "@/infrastructure/database/prisma/repositories/prisma-service-request-repository";
import { PrismaUserRepository } from "@/infrastructure/database/prisma/repositories/prisma-user-repository";
import { GetLeadContactUseCase } from "@/application/use-cases/lead-contact/get-lead-contact.use-case";
import { InitiateLeadPurchaseUseCase } from "@/application/use-cases/lead-purchase/initiate-lead-purchase.use-case";
import { LeadContactSharingPurchaseGate, guardLeadPurchaseByContactSharing } from "@/application/use-cases/lead-privacy/lead-contact-sharing-purchase-gate";
import { PrismaLeadPreviewRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-preview-repository";
import { LeadNotPurchasableError } from "@/domain/services/lead-purchase";
import type { ProfessionalDiscoveryRepository } from "@/domain/repositories/professional-discovery-repository";
import { eligibilityPolicy } from "../../test-utils/lead-purchase-eligibility-fixtures";
import { ConfirmLeadPurchaseUseCase } from "@/application/use-cases/lead-purchase/confirm-lead-purchase.use-case";
import { RecordLeadContactSharingUseCase } from "@/application/use-cases/lead-privacy/record-lead-contact-sharing.use-case";
import { RunLeadPrivacyRetentionUseCase } from "@/application/use-cases/lead-privacy/run-lead-privacy-retention.use-case";
import { WithdrawLeadContactSharingUseCase } from "@/application/use-cases/lead-privacy/withdraw-lead-contact-sharing.use-case";
import { LeadContactAccessDeniedError } from "@/domain/services/lead-contact-access-policy";
import { LEAD_REQUEST_ERASED_TEXT, UNCONFIGURED_LEAD_PRIVACY_POLICY, type LeadPrivacyPolicy } from "@/domain/services/lead-privacy";

import { SNAPSHOT_DATA } from "../../test-utils/lead-publication-fixtures";
import { M139_SECRET_EMAIL, M139_SECRET_NAME, M139_SECRET_PHONE } from "../../test-utils/contact-leak-sentinels";
import { setupDbTestLifecycle } from "../../test-utils/db/db-test-lifecycle";
import { createAddress, createCustomerProfile, createProfessionalProfile, createServiceCategory, createServiceRequest, createUser } from "../../test-utils/db/seed-helpers";

vi.mock("@/infrastructure/observability/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const CONSENT_POLICY: LeadPrivacyPolicy = { contactSharingBasis: "CONSENT", noticeVersion: "2026-10-v1", requestContentRetentionDays: null };
const OTHER_POLICY: LeadPrivacyPolicy = { contactSharingBasis: "OTHER_LAWFUL_BASIS", noticeVersion: "2026-10-v1", requestContentRetentionDays: null };
const SECRET_TITLE = "M158 secret request title";
const SECRET_DESCRIPTION = "M158 secret request description with details";

describe("Module 158 — lead privacy (real PostgreSQL)", () => {
  setupDbTestLifecycle();

  const leads = new PrismaLeadRepository();
  const purchases = new PrismaLeadPurchaseRepository();
  const serviceRequests = new PrismaServiceRequestRepository();
  const professionals = new PrismaProfessionalRepository();
  const users = new PrismaUserRepository();
  const sharing = new PrismaLeadContactSharingRepository();
  const retention = new PrismaLeadPrivacyRetentionRepository();
  const auditLog = new PrismaAdminAuditLogRepository();
  const confirm = new ConfirmLeadPurchaseUseCase(purchases, leads, serviceRequests);
  const deps = { leads, serviceRequests, customerProfiles: new PrismaCustomerProfileRepository(), sharing, auditLog };

  const contactFor = (policy: LeadPrivacyPolicy) =>
    new GetLeadContactUseCase(users, professionals, new PrismaLeadContactAuthorizationReader(() => policy), new PrismaLeadContactReader(() => policy));
  const recordFor = (policy: LeadPrivacyPolicy) => new RecordLeadContactSharingUseCase(deps, policy);
  const withdraw = new WithdrawLeadContactSharingUseCase(deps);
  const runner = (policy: LeadPrivacyPolicy = UNCONFIGURED_LEAD_PRIVACY_POLICY, now = () => new Date()) =>
    new RunLeadPrivacyRetentionUseCase(retention, policy, auditLog, null, undefined, now);

  let seq = 0;
  beforeEach(() => {
    seq = 0;
  });

  async function customerWithLead(opts: { leadFlow?: boolean; publish?: boolean } = {}) {
    const n = seq++;
    const user = await createUser(prisma, { name: `${M139_SECRET_NAME}-${n}`, email: n === 0 ? M139_SECRET_EMAIL : `m158-${n}@example.invalid` });
    await prisma.user.update({ where: { id: user.id }, data: { phone: n === 0 ? M139_SECRET_PHONE : `+3460000158${n}` } });
    const address = await createAddress(prisma, user.id);
    const customer = await createCustomerProfile(prisma, user.id);
    const category = await createServiceCategory(prisma);
    const request = await createServiceRequest(prisma, { customerId: customer.id, categoryId: category.id, addressId: address.id }, { title: SECRET_TITLE });
    await prisma.serviceRequest.update({
      where: { id: request.id },
      data: { flowVersion: opts.leadFlow === false ? "LEGACY_QUOTE_PAYMENT" : "LEAD_V1", description: SECRET_DESCRIPTION },
    });
    let lead = null as Awaited<ReturnType<typeof leads.create>> | null;
    if (opts.leadFlow !== false) {
      const draft = await leads.create({ serviceRequestId: request.id, maxBuyers: null });
      lead = opts.publish === false ? draft : (await leads.publish(draft.id, { ...SNAPSHOT_DATA, maxBuyers: 100 }))!;
    }
    return { user, customer, request, lead: lead!, address };
  }

  async function buyer() {
    const user = await createUser(prisma, { name: "Pro" });
    const profile = await createProfessionalProfile(prisma, user.id);
    return { user, profile };
  }

  async function sold(leadId: string, status: "CONFIRMED" | "PENDING_PAYMENT" = "CONFIRMED") {
    const pro = await buyer();
    const p = await purchases.initiate({ leadId, professionalProfileId: pro.profile.id });
    if (status === "CONFIRMED") await confirm.execute(p.id);
    return { pro, purchase: p };
  }

  const auditRows = (adminAction: string) => prisma.auditLog.findMany({ where: { metadata: { path: ["adminAction"], equals: adminAction } } });
  const text = async (requestId: string) => (await prisma.serviceRequest.findUniqueOrThrow({ where: { id: requestId } }));
  const denied = async (p: Promise<unknown>) => expect(await p.then(() => null, (e: unknown) => e)).toBeInstanceOf(LeadContactAccessDeniedError);
  const erase = (userId: string) => users.eraseAccount(userId);

  describe("evidence table — database-enforced invariants", () => {
    it("record is idempotent and concurrency-safe: exactly one row, one creator", async () => {
      const { user, lead } = await customerWithLead();
      const data = { leadId: lead.id, userId: user.id, basis: "CONSENT" as const, noticeVersion: "v1", recordedAt: new Date() };
      const results = await Promise.all(Array.from({ length: 6 }, () => sharing.record(data)));
      expect(results.filter((r) => r.created)).toHaveLength(1);
      expect(await prisma.leadContactSharingRecord.count({ where: { leadId: lead.id } })).toBe(1);
      // a replay with a DIFFERENT version never rewrites the original evidence
      const replay = await sharing.record({ ...data, noticeVersion: "v2" });
      expect(replay.created).toBe(false);
      expect(replay.record.noticeVersion).toBe("v1");
    });

    it("withdraw stamps once; a repeat changes nothing and keeps the first timestamp", async () => {
      const { user, lead } = await customerWithLead();
      await sharing.record({ leadId: lead.id, userId: user.id, basis: "CONSENT", noticeVersion: "v1", recordedAt: new Date(Date.now() - 1000) });
      const at = new Date();
      const first = await sharing.withdraw(lead.id, at);
      const second = await sharing.withdraw(lead.id, new Date(at.getTime() + 60_000));
      expect(first.changed).toBe(true);
      expect(second.changed).toBe(false);
      expect(second.record!.withdrawnAt!.getTime()).toBe(at.getTime());
    });

    it("withdraw on an unknown lead is a no-op (null record)", async () => {
      expect(await sharing.withdraw("00000000-0000-4000-8000-000000000000", new Date())).toEqual({ record: null, changed: false });
    });

    it("DB refuses: delete, evidence mutation, un-withdrawing, withdrawing a non-consent record, wrong-owner insert, pre-withdrawn insert, blank version", async () => {
      const a = await customerWithLead();
      const b = await customerWithLead();
      const rec = await prisma.leadContactSharingRecord.create({ data: { leadId: a.lead.id, userId: a.user.id, basis: "CONSENT", noticeVersion: "v1", recordedAt: new Date() } });
      await expect(prisma.leadContactSharingRecord.delete({ where: { id: rec.id } })).rejects.toThrow();
      await expect(prisma.leadContactSharingRecord.update({ where: { id: rec.id }, data: { noticeVersion: "v9" } })).rejects.toThrow();
      await expect(prisma.leadContactSharingRecord.update({ where: { id: rec.id }, data: { basis: "OTHER_LAWFUL_BASIS" } })).rejects.toThrow();
      await prisma.leadContactSharingRecord.update({ where: { id: rec.id }, data: { withdrawnAt: new Date() } });
      await expect(prisma.leadContactSharingRecord.update({ where: { id: rec.id }, data: { withdrawnAt: null } })).rejects.toThrow();
      await expect(prisma.leadContactSharingRecord.update({ where: { id: rec.id }, data: { withdrawnAt: new Date(Date.now() + 5000) } })).rejects.toThrow();

      // user does not own the lead
      await expect(prisma.leadContactSharingRecord.create({ data: { leadId: b.lead.id, userId: a.user.id, basis: "CONSENT", noticeVersion: "v1", recordedAt: new Date() } })).rejects.toThrow();
      // born withdrawn
      const c = await customerWithLead();
      await expect(
        prisma.leadContactSharingRecord.create({ data: { leadId: c.lead.id, userId: c.user.id, basis: "CONSENT", noticeVersion: "v1", recordedAt: new Date(), withdrawnAt: new Date() } }),
      ).rejects.toThrow();
      // blank notice version
      await expect(prisma.leadContactSharingRecord.create({ data: { leadId: c.lead.id, userId: c.user.id, basis: "CONSENT", noticeVersion: "  ", recordedAt: new Date() } })).rejects.toThrow();
      // withdrawal on a non-consent basis
      const d = await customerWithLead();
      const other = await prisma.leadContactSharingRecord.create({ data: { leadId: d.lead.id, userId: d.user.id, basis: "OTHER_LAWFUL_BASIS", noticeVersion: "v1", recordedAt: new Date() } });
      await expect(prisma.leadContactSharingRecord.update({ where: { id: other.id }, data: { withdrawnAt: new Date() } })).rejects.toThrow();
    });

    it("listByUser returns only that user's records, bounded", async () => {
      const a = await customerWithLead();
      const b = await customerWithLead();
      await sharing.record({ leadId: a.lead.id, userId: a.user.id, basis: "CONSENT", noticeVersion: "v1", recordedAt: new Date() });
      await sharing.record({ leadId: b.lead.id, userId: b.user.id, basis: "CONSENT", noticeVersion: "v1", recordedAt: new Date() });
      const mine = await sharing.listByUser(a.user.id, 10);
      expect(mine.map((r) => r.leadId)).toEqual([a.lead.id]);
    });
  });

  describe("record / withdraw use cases", () => {
    it("record: owner only; cross-user, unknown and legacy requests are one uniform not-found; audit has no PII", async () => {
      const owner = await customerWithLead();
      const other = await customerWithLead();
      const legacy = await customerWithLead({ leadFlow: false });
      const use = recordFor(CONSENT_POLICY);
      await expect(use.execute(other.user.id, owner.lead.id)).rejects.toMatchObject({ name: expect.stringMatching(/NotFound/) });
      await expect(use.execute(other.user.id, "00000000-0000-4000-8000-000000000000")).rejects.toMatchObject({ name: expect.stringMatching(/NotFound/) });
      await expect(use.execute(legacy.user.id, "not-a-uuid")).rejects.toMatchObject({ name: expect.stringMatching(/NotFound/) });
      expect(await prisma.leadContactSharingRecord.count()).toBe(0);

      const result = await use.execute(owner.user.id, owner.lead.id);
      expect(result).toMatchObject({ created: true });
      expect((await use.execute(owner.user.id, owner.lead.id)).created).toBe(false);
      const rows = await auditRows("GDPR_CONSENT_GRANTED");
      expect(rows).toHaveLength(1);
      const blob = JSON.stringify(rows);
      for (const s of [M139_SECRET_EMAIL, M139_SECRET_PHONE, M139_SECRET_NAME, SECRET_TITLE, SECRET_DESCRIPTION]) expect(blob).not.toContain(s);
    });

    it("record is refused while the policy is undecided (no silent consent) and writes nothing", async () => {
      const { user, lead } = await customerWithLead();
      await expect(recordFor(UNCONFIGURED_LEAD_PRIVACY_POLICY).execute(user.id, lead.id)).rejects.toMatchObject({ name: expect.stringMatching(/NotConfigured/) });
      expect(await prisma.leadContactSharingRecord.count()).toBe(0);
    });

    it("withdraw: owner only, cancels the request and lead, idempotent, audited without PII", async () => {
      const { user, lead, request } = await customerWithLead();
      const intruder = await customerWithLead();
      await recordFor(CONSENT_POLICY).execute(user.id, lead.id);
      await expect(withdraw.execute(intruder.user.id, lead.id)).rejects.toMatchObject({ name: expect.stringMatching(/NotFound/) });
      expect((await prisma.leadContactSharingRecord.findUniqueOrThrow({ where: { leadId: lead.id } })).withdrawnAt).toBeNull();

      await withdraw.execute(user.id, lead.id);
      await withdraw.execute(user.id, lead.id); // retry
      expect((await text(request.id)).status).toBe("CANCELLED");
      expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe("CANCELLED");
      expect((await auditRows("GDPR_CONSENT_WITHDRAWN")).length).toBe(1);
      expect(JSON.stringify(await auditRows("GDPR_CONSENT_WITHDRAWN"))).not.toContain(SECRET_TITLE);
    });

    it("withdraw is refused for a non-consent basis record", async () => {
      const { user, lead } = await customerWithLead();
      await recordFor(OTHER_POLICY).execute(user.id, lead.id);
      await expect(withdraw.execute(user.id, lead.id)).rejects.toMatchObject({ name: expect.stringMatching(/NotApplicable/) });
      expect((await prisma.leadContactSharingRecord.findUniqueOrThrow({ where: { leadId: lead.id } })).withdrawnAt).toBeNull();
    });
  });

  describe("contact access gate (M138 readers) — LEAD_V1 contact only for an authorised purchaser", () => {
    it("undecided policy: behaviour is unchanged (CONFIRMED buyer gets contact, no record needed) — no silent consent either way", async () => {
      const { lead } = await customerWithLead();
      const { pro } = await sold(lead.id);
      await expect(contactFor(UNCONFIGURED_LEAD_PRIVACY_POLICY).execute(pro.user.id, lead.id)).resolves.toMatchObject({ email: M139_SECRET_EMAIL });
      expect(await prisma.leadContactSharingRecord.count()).toBe(0);
    });

    it("CONSENT policy: no record -> denied; after recording -> allowed; after withdrawal -> denied again", async () => {
      const { user, lead } = await customerWithLead();
      const { pro } = await sold(lead.id);
      const get = contactFor(CONSENT_POLICY);
      await denied(get.execute(pro.user.id, lead.id));
      await recordFor(CONSENT_POLICY).execute(user.id, lead.id);
      await expect(get.execute(pro.user.id, lead.id)).resolves.toMatchObject({ email: M139_SECRET_EMAIL });
      await withdraw.execute(user.id, lead.id);
      await denied(get.execute(pro.user.id, lead.id));
    });

    it("a withdrawn consent denies even if the deployment later moves to the other basis (withdrawal always wins)", async () => {
      const { user, lead } = await customerWithLead();
      const { pro } = await sold(lead.id);
      await recordFor(CONSENT_POLICY).execute(user.id, lead.id);
      await withdraw.execute(user.id, lead.id);
      await denied(contactFor(OTHER_POLICY).execute(pro.user.id, lead.id));
    });

    it("OTHER_LAWFUL_BASIS needs no consent record", async () => {
      const { lead } = await customerWithLead();
      const { pro } = await sold(lead.id);
      await expect(contactFor(OTHER_POLICY).execute(pro.user.id, lead.id)).resolves.toMatchObject({ email: M139_SECRET_EMAIL });
    });

    it("an erased customer's contact is never released, even to a CONFIRMED buyer; the denial is the uniform one and leaks nothing", async () => {
      const { user, lead } = await customerWithLead();
      const { pro } = await sold(lead.id);
      await erase(user.id);
      const err = await contactFor(UNCONFIGURED_LEAD_PRIVACY_POLICY).execute(pro.user.id, lead.id).then(() => null, (e: unknown) => e);
      expect(err).toBeInstanceOf(LeadContactAccessDeniedError);
      expect(JSON.stringify({ m: (err as Error).message, n: (err as Error).name })).not.toMatch(/example\.invalid|Secret/);
    });

    it("a different professional with no purchase on a consented lead is still denied (consent is not access)", async () => {
      const { user, lead } = await customerWithLead();
      await recordFor(CONSENT_POLICY).execute(user.id, lead.id);
      const stranger = await buyer();
      await denied(contactFor(CONSENT_POLICY).execute(stranger.user.id, lead.id));
    });
  });


  describe("purchase initiation gate (M158)", () => {
    const discovery = { findCandidateById: async (id: string) => ({ id, categoryIds: [] as string[], latitude: 40.4168, longitude: -3.7038, serviceRadiusKm: 50 }) };
    const initiateWith = (policy: LeadPrivacyPolicy, categoryId: string) =>
      guardLeadPurchaseByContactSharing(new InitiateLeadPurchaseUseCase(
        professionals,
        { findCandidateById: async (id: string) => ({ ...(await discovery.findCandidateById(id)), categoryIds: [categoryId] }) } as unknown as ProfessionalDiscoveryRepository,
        leads,
        serviceRequests,
        new PrismaLeadPreviewRepository(),
        purchases,
        eligibilityPolicy(),
      ), new LeadContactSharingPurchaseGate(sharing, policy));
    const setCoords = (addressId: string) => prisma.address.update({ where: { id: addressId }, data: { latitude: 40.4168, longitude: -3.7038 } });

    it("CONSENT: no record -> not purchasable and no purchase row; recorded -> purchasable; withdrawn -> not purchasable again", async () => {
      const c = await customerWithLead();
      await setCoords(c.address.id);
      const pro = await buyer();
      const initiate = initiateWith(CONSENT_POLICY, c.request.categoryId);
      const err = await initiate.execute(pro.user.id, c.lead.id).then(() => null, (e: unknown) => e);
      expect(err).toBeInstanceOf(LeadNotPurchasableError);
      expect(await prisma.leadPurchase.count({ where: { leadId: c.lead.id } })).toBe(0);

      await recordFor(CONSENT_POLICY).execute(c.user.id, c.lead.id);
      await expect(initiate.execute(pro.user.id, c.lead.id)).resolves.toMatchObject({ status: "PENDING_PAYMENT" });

      await withdraw.execute(c.user.id, c.lead.id);
      await expect(initiate.execute(pro.user.id, c.lead.id)).rejects.toBeInstanceOf(LeadNotPurchasableError);
    });

    it("undecided policy: purchasable with no record (rollout-safe default)", async () => {
      const c = await customerWithLead();
      await setCoords(c.address.id);
      const pro = await buyer();
      await expect(initiateWith(UNCONFIGURED_LEAD_PRIVACY_POLICY, c.request.categoryId).execute(pro.user.id, c.lead.id)).resolves.toMatchObject({ status: "PENDING_PAYMENT" });
    });
  });

  describe("erased-customer sweep", () => {
    it("anonymizes the request text, soft-deletes it, cancels the lead, and preserves purchases / lead row / user row", async () => {
      const { user, lead, request } = await customerWithLead();
      const { purchase } = await sold(lead.id);
      await erase(user.id);
      const before = await prisma.leadPurchase.findUniqueOrThrow({ where: { id: purchase.id } });

      const res = await retention.anonymizeRequestsOfErasedCustomers({ limit: 50, dryRun: false });
      expect(res).toMatchObject({ eligible: 1, anonymized: 1 });
      const sr = await text(request.id);
      expect(sr.title).toBe(LEAD_REQUEST_ERASED_TEXT);
      expect(sr.description).toBe(LEAD_REQUEST_ERASED_TEXT);
      expect(sr.deletedAt).not.toBeNull();
      expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe("CANCELLED");
      // financial / purchase record is preserved untouched
      expect(await prisma.leadPurchase.findUniqueOrThrow({ where: { id: purchase.id } })).toEqual(before);
      expect(await prisma.user.count({ where: { id: user.id } })).toBe(1);
    });

    it("is idempotent: a second run finds nothing and changes nothing", async () => {
      const { user, request } = await customerWithLead();
      await erase(user.id);
      await retention.anonymizeRequestsOfErasedCustomers({ limit: 50, dryRun: false });
      const snap = await text(request.id);
      const again = await retention.anonymizeRequestsOfErasedCustomers({ limit: 50, dryRun: false });
      expect(again).toMatchObject({ eligible: 0, anonymized: 0 });
      expect(await text(request.id)).toEqual(snap);
    });

    it("dry-run counts but writes nothing", async () => {
      const { user, request } = await customerWithLead();
      await erase(user.id);
      const res = await retention.anonymizeRequestsOfErasedCustomers({ limit: 50, dryRun: true });
      expect(res).toMatchObject({ eligible: 1, anonymized: 0 });
      expect((await text(request.id)).title).toBe(SECRET_TITLE);
    });

    it("honours the batch bound and only touches erased customers' LEAD_V1 requests (others and legacy untouched)", async () => {
      const erased = [await customerWithLead(), await customerWithLead(), await customerWithLead()];
      const active = await customerWithLead();
      const legacy = await customerWithLead({ leadFlow: false });
      for (const e of erased) await erase(e.user.id);
      await erase(legacy.user.id);

      const first = await retention.anonymizeRequestsOfErasedCustomers({ limit: 2, dryRun: false });
      expect(first.anonymized).toBe(2);
      const second = await retention.anonymizeRequestsOfErasedCustomers({ limit: 2, dryRun: false });
      expect(second.anonymized).toBe(1);
      expect((await text(active.request.id)).title).toBe(SECRET_TITLE);
      expect((await text(legacy.request.id)).title).toBe(SECRET_TITLE); // legacy flow is out of M158 scope
    });

    it("scoped to one user when asked (account-erasure path)", async () => {
      const a = await customerWithLead();
      const b = await customerWithLead();
      await erase(a.user.id);
      await erase(b.user.id);
      await retention.anonymizeRequestsOfErasedCustomers({ limit: 50, dryRun: false, userId: a.user.id });
      expect((await text(a.request.id)).title).toBe(LEAD_REQUEST_ERASED_TEXT);
      expect((await text(b.request.id)).title).toBe(SECRET_TITLE);
    });

    it("concurrent sweeps never double-process", async () => {
      const rows = [await customerWithLead(), await customerWithLead(), await customerWithLead(), await customerWithLead()];
      for (const r of rows) await erase(r.user.id);
      const results = await Promise.all(Array.from({ length: 4 }, () => retention.anonymizeRequestsOfErasedCustomers({ limit: 50, dryRun: false })));
      expect(results.reduce((n, r) => n + r.anonymized, 0)).toBe(4);
      for (const r of rows) expect((await text(r.request.id)).title).toBe(LEAD_REQUEST_ERASED_TEXT);
    });

    it("leaves the evidence rows, claims-free audit history and other users' audit rows in place", async () => {
      const { user, lead } = await customerWithLead();
      await recordFor(CONSENT_POLICY).execute(user.id, lead.id);
      await erase(user.id);
      await retention.anonymizeRequestsOfErasedCustomers({ limit: 50, dryRun: false });
      expect(await prisma.leadContactSharingRecord.count({ where: { leadId: lead.id } })).toBe(1);
      expect((await auditRows("GDPR_CONSENT_GRANTED")).length).toBe(1);
    });
  });

  describe("terminal content minimization (policy-gated)", () => {
    const DAY = 86_400_000;
    async function terminalLead(ageDays: number, status: "CLOSED" | "EXPIRED" | "CANCELLED" = "EXPIRED", purchase?: "CONFIRMED" | "PENDING_PAYMENT") {
      const c = await customerWithLead();
      if (purchase) await sold(c.lead.id, purchase);
      await prisma.$executeRaw`UPDATE "leads" SET "status" = ${status}::"LeadStatus" WHERE "id" = ${c.lead.id}::uuid`;
      await prisma.$executeRaw`UPDATE "leads" SET "updatedAt" = ${new Date(Date.now() - ageDays * DAY)} WHERE "id" = ${c.lead.id}::uuid`;
      return c;
    }

    it("no approved retention period (null cutoff) -> nothing is ever eligible", async () => {
      const old = await terminalLead(4000);
      expect(await retention.minimizeTerminalLeadRequestContent({ limit: 50, dryRun: false, cutoff: null })).toMatchObject({ eligible: 0, anonymized: 0 });
      expect((await text(old.request.id)).title).toBe(SECRET_TITLE);
    });

    it("boundary: updatedAt exactly at the cutoff is eligible, one millisecond newer is not", async () => {
      const cutoff = new Date(Date.now() - 100 * DAY);
      const atCut = await terminalLead(0);
      const newer = await terminalLead(0);
      await prisma.$executeRaw`UPDATE "leads" SET "updatedAt" = ${cutoff} WHERE "id" = ${atCut.lead.id}::uuid`;
      await prisma.$executeRaw`UPDATE "leads" SET "updatedAt" = ${new Date(cutoff.getTime() + 1)} WHERE "id" = ${newer.lead.id}::uuid`;
      const res = await retention.minimizeTerminalLeadRequestContent({ limit: 50, dryRun: false, cutoff });
      expect(res.anonymized).toBe(1);
      expect((await text(atCut.request.id)).title).toBe(LEAD_REQUEST_ERASED_TEXT);
      expect((await text(newer.request.id)).title).toBe(SECRET_TITLE);
    });

    it("never minimizes an open lead, however old", async () => {
      const open = await customerWithLead();
      await prisma.$executeRaw`UPDATE "leads" SET "updatedAt" = ${new Date(Date.now() - 4000 * DAY)} WHERE "id" = ${open.lead.id}::uuid`;
      const res = await retention.minimizeTerminalLeadRequestContent({ limit: 50, dryRun: false, cutoff: new Date() });
      expect(res.anonymized).toBe(0);
      expect((await text(open.request.id)).title).toBe(SECRET_TITLE);
    });

    it("a CONFIRMED or PENDING_PAYMENT purchase blocks minimization (money / dispute window preserved); other purchase states do not", async () => {
      const confirmed = await terminalLead(400, "CLOSED", "CONFIRMED");
      const pending = await terminalLead(400, "CLOSED", "PENDING_PAYMENT");
      const free = await terminalLead(400, "CLOSED");
      const res = await retention.minimizeTerminalLeadRequestContent({ limit: 50, dryRun: false, cutoff: new Date(Date.now() - 100 * DAY) });
      expect(res.anonymized).toBe(1);
      expect((await text(confirmed.request.id)).title).toBe(SECRET_TITLE);
      expect((await text(pending.request.id)).title).toBe(SECRET_TITLE);
      expect((await text(free.request.id)).title).toBe(LEAD_REQUEST_ERASED_TEXT);
    });

    it("idempotent, dry-run writes nothing, bounded", async () => {
      const rows = [await terminalLead(400), await terminalLead(400), await terminalLead(400)];
      const cutoff = new Date(Date.now() - 100 * DAY);
      expect(await retention.minimizeTerminalLeadRequestContent({ limit: 50, dryRun: true, cutoff })).toMatchObject({ eligible: 3, anonymized: 0 });
      expect((await text(rows[0]!.request.id)).title).toBe(SECRET_TITLE);
      expect((await retention.minimizeTerminalLeadRequestContent({ limit: 2, dryRun: false, cutoff })).anonymized).toBe(2);
      expect((await retention.minimizeTerminalLeadRequestContent({ limit: 2, dryRun: false, cutoff })).anonymized).toBe(1);
      expect((await retention.minimizeTerminalLeadRequestContent({ limit: 2, dryRun: false, cutoff })).anonymized).toBe(0);
    });
  });

  describe("RunLeadPrivacyRetentionUseCase end to end", () => {
    it("runs both phases, reports counts, writes one PII-free GDPR_DELETION_EXECUTED audit, and a rerun is a clean no-op", async () => {
      const { user } = await customerWithLead();
      await erase(user.id);
      const old = await customerWithLead();
      await prisma.$executeRaw`UPDATE "leads" SET "status" = 'EXPIRED'::"LeadStatus" WHERE "id" = ${old.lead.id}::uuid`;
      await prisma.$executeRaw`UPDATE "leads" SET "updatedAt" = ${new Date(Date.now() - 400 * 86_400_000)} WHERE "id" = ${old.lead.id}::uuid`;
      const policy: LeadPrivacyPolicy = { ...UNCONFIGURED_LEAD_PRIVACY_POLICY, requestContentRetentionDays: 30 };

      const first = await runner(policy).execute({ batchSize: 50, dryRun: false });
      expect(first.outcome).toBe("completed");
      expect(first.erasedCustomerRequests.anonymized).toBe(1);
      expect(first.terminalRequestMinimization.anonymized).toBe(1);
      const audits = await auditRows("GDPR_DELETION_EXECUTED");
      expect(audits).toHaveLength(1);
      expect(JSON.stringify(audits)).not.toMatch(/Secret|example\.invalid|\[erased\]|M158/);

      const second = await runner(policy).execute({ batchSize: 50, dryRun: false });
      expect(second.erasedCustomerRequests.anonymized + second.terminalRequestMinimization.anonymized).toBe(0);
      expect((await auditRows("GDPR_DELETION_EXECUTED")).length).toBe(1);
    });

    it("dry-run changes nothing and writes no audit", async () => {
      const { user, request } = await customerWithLead();
      await erase(user.id);
      const res = await runner().execute({ batchSize: 50, dryRun: true });
      expect(res.dryRun).toBe(true);
      expect((await text(request.id)).title).toBe(SECRET_TITLE);
      expect((await auditRows("GDPR_DELETION_EXECUTED")).length).toBe(0);
    });

    it("reports open leads that have no sharing record (rollout visibility) without creating any", async () => {
      await customerWithLead();
      await customerWithLead();
      const res = await runner().execute({ batchSize: 50, dryRun: true });
      expect(res.openLeadsWithoutContactSharingRecord).toBe(2);
      expect(await prisma.leadContactSharingRecord.count()).toBe(0);
    });
  });
});
