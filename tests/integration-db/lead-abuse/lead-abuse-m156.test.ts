/**
 * Module 156 — Lead Marketplace Fraud & Abuse Controls against REAL PostgreSQL.
 *
 * Proves what mocks cannot: the migration's DDL (enums, CHECKs, partial unique indexes, triggers), idempotent signal recording and
 * decision creation under genuinely concurrent callers, the status / immutability / no-delete triggers, atomicity of a decision with
 * its audit entry, the read-only facts reader over REAL M123/M135/M155 rows (leads, purchases, disputes, revocations), the guards
 * end to end, the real M138/M139 contact authorization path with the observer attached (DISPUTED / REVOKED stay denied, a risk
 * level never grants), and that no purchase / dispute / revocation / ledger / invoice / credit-note / refund row is ever changed or
 * created. Run with `npm run test:integration:db` (requires the guarded test database — see tests/test-utils/db).
 */
import { describe, expect, it, vi } from "vitest";

import type { StripePaymentWebhookEvent } from "@/application/ports/stripe-payment-webhook-verifier";
import { ImposeLeadAbuseBlockUseCase, LiftLeadAbuseDecisionUseCase } from "@/application/use-cases/lead-abuse/admin-lead-abuse.use-cases";
import { EvaluateLeadAbuseUseCase } from "@/application/use-cases/lead-abuse/evaluate-lead-abuse.use-case";
import {
  LeadAbuseGuardedInitiatePurchase,
  LeadAbuseGuardedPublishLead,
  LeadAbuseObservedGetLeadContact,
  LeadAbuseRuntime,
} from "@/application/use-cases/lead-abuse/lead-abuse-guards";
import { GetLeadContactUseCase } from "@/application/use-cases/lead-contact/get-lead-contact.use-case";
import { ProcessLeadFeeDisputeWebhookUseCase } from "@/application/use-cases/lead-fee-dispute/process-lead-fee-dispute-webhook.use-case";
import { RevokeLeadPurchaseUseCase } from "@/application/use-cases/lead-fee-dispute/revoke-lead-purchase.use-case";
import { ProcessLeadFeePaymentWebhookUseCase } from "@/application/use-cases/lead-fee-payment/process-lead-fee-payment-webhook.use-case";
import { ConfirmLeadPurchaseUseCase } from "@/application/use-cases/lead-purchase/confirm-lead-purchase.use-case";
import { TransitionLeadPurchaseUseCase } from "@/application/use-cases/lead-purchase/transition-lead-purchase.use-case";
import { AccountRestrictedError } from "@/domain/errors/domain-error";
import { LeadContactAccessDeniedError } from "@/domain/services/lead-contact-access-policy";
import { LeadNotPurchasableError } from "@/domain/services/lead-purchase";
import {
  LeadAbuseControlRejectedError,
  defaultLeadAbuseControlConfig,
  type LeadAbuseControlConfig,
  type LeadAbuseMode,
} from "@/domain/services/lead-abuse-controls";
import { prisma } from "@/infrastructure/database/prisma/client";
import type * as AuditRepositoryModule from "@/infrastructure/database/prisma/repositories/prisma-admin-audit-log-repository";
import { recordAdminAuditLogWithin } from "@/infrastructure/database/prisma/repositories/prisma-admin-audit-log-repository";
import { PrismaAdminRepository } from "@/infrastructure/database/prisma/repositories/prisma-admin-repository";
import { PrismaExternalWebhookEventRepository } from "@/infrastructure/database/prisma/repositories/prisma-external-webhook-event-repository";
import { PrismaLeadAbuseControlRepository, PrismaLeadAbuseFactsReader } from "@/infrastructure/database/prisma/repositories/prisma-lead-abuse-control-repository";
import { PrismaLeadContactAuthorizationReader, PrismaLeadContactReader } from "@/infrastructure/database/prisma/repositories/prisma-lead-contact-access-repository";
import { PrismaLeadFeeDisputeRepository, PrismaLeadPurchaseRevocationRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-fee-dispute-repository";
import { PrismaLeadPurchaseRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-purchase-repository";
import { PrismaLeadRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-repository";
import { PrismaProfessionalRepository } from "@/infrastructure/database/prisma/repositories/prisma-professional-repository";
import { PrismaServiceRequestRepository } from "@/infrastructure/database/prisma/repositories/prisma-service-request-repository";
import { PrismaUserRepository } from "@/infrastructure/database/prisma/repositories/prisma-user-repository";

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

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe("Module 156 — lead fraud & abuse controls (real PostgreSQL)", () => {
  setupDbTestLifecycle();

  const leads = new PrismaLeadRepository();
  const purchases = new PrismaLeadPurchaseRepository();
  const disputes = new PrismaLeadFeeDisputeRepository();
  const revocations = new PrismaLeadPurchaseRevocationRepository();
  const control = new PrismaLeadAbuseControlRepository();
  const facts = new PrismaLeadAbuseFactsReader();
  const admins = new PrismaAdminRepository();
  const getContact = new GetLeadContactUseCase(new PrismaUserRepository(), new PrismaProfessionalRepository(), new PrismaLeadContactAuthorizationReader(), new PrismaLeadContactReader());
  let seq = 0;
  let evt = 0;

  // ---------------------------------------------------------------------------------------------------- builders

  const user = (label: string) => {
    seq += 1;
    return createUser(prisma, { name: `${label} ${seq}`, email: `m156-${label.toLowerCase()}-${seq}@test.maestroya.invalid` });
  };

  async function newAdmin(roleKey = "ADMIN") {
    const u = await user("Admin");
    const role = await prisma.role.upsert({ where: { key: roleKey }, update: {}, create: { key: roleKey, name: roleKey } });
    await prisma.userRole.create({ data: { userId: u.id, roleId: role.id } });
    return u.id;
  }

  async function newCustomer() {
    const u = await user("Customer");
    await prisma.user.update({ where: { id: u.id }, data: { phone: `+3461000${String(seq).padStart(4, "0")}` } });
    const address = await createAddress(prisma, u.id);
    const profile = await createCustomerProfile(prisma, u.id);
    const category = await createServiceCategory(prisma);
    return { userId: u.id, customerId: profile.id, addressId: address.id, categoryId: category.id };
  }
  type Customer = Awaited<ReturnType<typeof newCustomer>>;

  async function newProfessional() {
    const u = await user("Pro");
    const profile = await createProfessionalProfile(prisma, u.id);
    return { userId: u.id, profileId: profile.id };
  }
  type Pro = Awaited<ReturnType<typeof newProfessional>>;

  async function request(c: Customer, o: { title?: string; description?: string; publish?: boolean } = {}) {
    seq += 1;
    const sr = await createServiceRequest(prisma, { customerId: c.customerId, categoryId: c.categoryId, addressId: c.addressId }, { title: o.title ?? `Request ${seq}` });
    await prisma.serviceRequest.update({ where: { id: sr.id }, data: { flowVersion: "LEAD_V1", description: o.description ?? `Unique description number ${seq}` } });
    const draft = await leads.create({ serviceRequestId: sr.id });
    if (o.publish === false) return { requestId: sr.id, leadId: draft.id };
    const lead = (await leads.publish(draft.id, { ...SNAPSHOT_DATA, price: "100.00", maxBuyers: 50 }))!;
    return { requestId: sr.id, leadId: lead.id };
  }

  const confirmer = () => new ConfirmLeadPurchaseUseCase(purchases, leads, new PrismaServiceRequestRepository());
  const paymentWebhook = () =>
    new ProcessLeadFeePaymentWebhookUseCase(purchases, leads, confirmer(), new TransitionLeadPurchaseUseCase(purchases), new PrismaExternalWebhookEventRepository(), undefined, undefined, {
      reconcile: (id: string) => disputes.reconcilePurchase(id, new Date()),
    });
  const disputeWebhook = () => new ProcessLeadFeeDisputeWebhookUseCase(purchases, leads, disputes, new PrismaExternalWebhookEventRepository());

  const paymentEvent = (reference: string, amount: number): StripePaymentWebhookEvent => ({
    id: `evt_m156_pay_${++evt}`,
    type: "payment_intent.succeeded",
    createdAt: new Date(),
    paymentIntent: { paymentIntentId: reference, lastPaymentErrorMessage: null, amountMinorUnits: amount, currency: "eur", flow: "LEAD_V1", leadPurchaseId: null, leadId: null },
    chargeRefunded: null,
    dispute: null,
    chargeUpdated: null,
  });
  const disputeEvent = (reference: string, o: { type?: string; status?: string; disputeId: string }): StripePaymentWebhookEvent => ({
    id: `evt_m156_dp_${++evt}`,
    type: o.type ?? "charge.dispute.created",
    createdAt: new Date(),
    paymentIntent: null,
    chargeRefunded: null,
    chargeUpdated: null,
    dispute: {
      disputeId: o.disputeId,
      chargeId: `ch_${o.disputeId}`,
      paymentIntentId: reference,
      amount: 121,
      amountMinorUnits: 12100,
      currency: "eur",
      reason: "fraudulent",
      status: o.status ?? "needs_response",
      evidenceDueBy: new Date("2026-11-01T00:00:00Z"),
    },
  });

  /** A real purchase of a fresh lead by `pro`; PENDING_PAYMENT unless `confirm`. */
  async function purchaseFor(pro: Pro, o: { confirm?: boolean } = {}) {
    const c = await newCustomer();
    const { leadId } = await request(c);
    const p = await purchases.initiate({ leadId, professionalProfileId: pro.profileId });
    seq += 1;
    const reference = `pi_m156_${seq}`;
    await purchases.recordPaymentReference(p.id, reference);
    if (o.confirm) expect((await paymentWebhook().execute(paymentEvent(reference, 12100))).outcome).toBe("confirmed");
    return { purchaseId: p.id, leadId, reference, customerUserId: c.userId };
  }

  const cfg = (mode: LeadAbuseMode, over: Partial<Record<string, { flagAt: number; blockAt: number | null }>> = {}): LeadAbuseControlConfig => {
    const base = defaultLeadAbuseControlConfig(mode);
    return { ...base, thresholds: { ...base.thresholds, ...over } as LeadAbuseControlConfig["thresholds"] };
  };
  const SMALL = {
    PUBLICATION_BURST: { flagAt: 2, blockAt: 4 },
    PURCHASE_INITIATION_BURST: { flagAt: 2, blockAt: 4 },
    DUPLICATE_REQUEST_CONTENT: { flagAt: 3, blockAt: null },
    CONTACT_ACCESS_DENIED_PROBING: { flagAt: 3, blockAt: null },
    PURCHASE_REJECTED_PROBING: { flagAt: 3, blockAt: null },
  };
  const evaluateWith = (config: LeadAbuseControlConfig) => new EvaluateLeadAbuseUseCase(facts, control, config);
  const runtimeWith = (config: LeadAbuseControlConfig) => new LeadAbuseRuntime(config.mode, evaluateWith(config), control, null);

  const sqlError = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (error) {
      return String((error as Error).message);
    }
    throw new Error("expected a database error");
  };
  const auditOf = (entityId: string) => prisma.auditLog.findMany({ where: { entityType: "LeadAbuseDecision", entityId }, orderBy: { createdAt: "asc" } });
  const adminActionOf = (a: { metadata: unknown }) => (a.metadata as { adminAction?: string } | null)?.adminAction;

  async function moneyAndPurchaseSnapshot() {
    return {
      ledger: await prisma.leadFeeLedgerEntry.count(),
      invoices: await prisma.leadFeeInvoice.count(),
      creditNotes: await prisma.leadFeeCreditNote.count(),
      refunds: await prisma.leadFeeRefund.count(),
      payments: await prisma.payment.count(),
      commissions: await prisma.commission.count(),
      payouts: await prisma.payout.count(),
      disputes: await prisma.leadFeeDispute.findMany({ orderBy: { id: "asc" }, select: { id: true, status: true, updatedAt: true } }),
      revocations: await prisma.leadPurchaseRevocation.count(),
      purchases: await prisma.leadPurchase.findMany({ orderBy: { id: "asc" }, select: { id: true, status: true, updatedAt: true } }),
      webhookEvents: await prisma.externalWebhookEvent.count(),
    };
  }

  const automatedFlag = (subjectUserId: string, over: Record<string, unknown> = {}) => ({
    subjectUserId,
    action: "FLAG_FOR_REVIEW" as const,
    restrictedAction: null,
    ruleKey: "PUBLICATION_BURST" as const,
    ruleVersion: "m156.v1",
    expiresAt: null,
    decidedAt: new Date(),
    observedCount: 12,
    threshold: 10,
    ...over,
  });
  const automatedBlock = (subjectUserId: string, over: Record<string, unknown> = {}) => ({
    ...automatedFlag(subjectUserId),
    action: "TEMPORARY_BLOCK" as const,
    restrictedAction: "LEAD_PUBLICATION" as const,
    expiresAt: new Date(Date.now() + HOUR),
    ...over,
  });

  // ---------------------------------------------------------------------------------------------------- DDL

  describe("migration DDL", () => {
    it("creates the two tables, the partial unique indexes, the dedupe unique index and the triggers", async () => {
      const tables = await prisma.$queryRaw<{ t: string }[]>`SELECT tablename::text AS t FROM pg_tables WHERE tablename LIKE 'lead_abuse_%' ORDER BY 1`;
      expect(tables.map((r) => r.t)).toEqual(["lead_abuse_decisions", "lead_abuse_signals"]);
      const indexes = await prisma.$queryRaw<{ n: string; d: string }[]>`SELECT indexname::text AS n, indexdef::text AS d FROM pg_indexes WHERE tablename LIKE 'lead_abuse_%'`;
      const names = indexes.map((i) => i.n);
      expect(names).toEqual(expect.arrayContaining(["lead_abuse_decisions_one_active_flag", "lead_abuse_decisions_one_active_block", "lead_abuse_signals_dedupeKey_key"]));
      expect(indexes.find((i) => i.n === "lead_abuse_decisions_one_active_block")!.d).toMatch(/UNIQUE.*WHERE.*ACTIVE.*TEMPORARY_BLOCK/s);
      const triggers = await prisma.$queryRaw<{ n: string }[]>`SELECT tgname::text AS n FROM pg_trigger WHERE NOT tgisinternal AND tgname LIKE 'lead_abuse_%' ORDER BY 1`;
      expect(triggers.map((t) => t.n)).toEqual(["lead_abuse_decisions_guard_update_trg", "lead_abuse_decisions_no_delete_trg", "lead_abuse_signals_append_only_trg", "lead_abuse_signals_event_cap_trg"]);
    });

    it("leaves every pre-existing M155 object in place (additive migration)", async () => {
      const rows = await prisma.$queryRaw<{ n: string }[]>`SELECT indexname::text AS n FROM pg_indexes WHERE indexname = 'lead_purchases_one_active_per_lead_professional'`;
      expect(rows).toHaveLength(1);
      const guard = await prisma.$queryRaw<{ n: string }[]>`SELECT proname::text AS n FROM pg_proc WHERE proname = 'lead_purchases_dispute_guard'`;
      expect(guard).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------------------------------- signals

  describe("signals: append-only evidence, idempotent by dedupeKey", () => {
    const draft = (subjectUserId: string, over: Record<string, unknown> = {}) => ({
      subjectUserId,
      signalType: "PUBLICATION_BURST" as const,
      reliability: "HEURISTIC" as const,
      severity: "MEDIUM" as const,
      ruleVersion: "m156.v1",
      dedupeKey: `m156.v1:PUBLICATION_BURST:${subjectUserId}:1`,
      targetLeadId: null,
      observedCount: 12,
      threshold: 10,
      windowSeconds: 3600,
      occurredAt: new Date(),
      ...over,
    });

    it("recording the same key sequentially or by 25 concurrent callers inserts exactly one row", async () => {
      const u = await user("Subject");
      expect(await control.recordSignal(draft(u.id))).toBe(true);
      expect(await control.recordSignal(draft(u.id))).toBe(false);
      const key = `m156.v1:PUBLICATION_BURST:${u.id}:2`;
      const results = await Promise.all(Array.from({ length: 25 }, () => control.recordSignal(draft(u.id, { dedupeKey: key }))));
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(await prisma.leadAbuseSignal.count({ where: { subjectUserId: u.id } })).toBe(2);
    });

    it("rows can neither be updated nor deleted", async () => {
      const u = await user("Subject");
      await control.recordSignal(draft(u.id));
      const row = await prisma.leadAbuseSignal.findFirstOrThrow({ where: { subjectUserId: u.id } });
      expect(await sqlError(prisma.leadAbuseSignal.update({ where: { id: row.id }, data: { severity: "LOW" } }))).toMatch(/append-only/);
      expect(await sqlError(prisma.leadAbuseSignal.delete({ where: { id: row.id } }))).toMatch(/append-only/);
      expect(await sqlError(prisma.$executeRaw`UPDATE "lead_abuse_signals" SET "observedCount" = 0`)).toMatch(/append-only/);
    });

    it("the shape CHECK separates raw events (lead, no counters) from rule hits (counters, no lead)", async () => {
      const u = await user("Subject");
      const lead = "99999999-9999-4999-8999-999999999999"; // not a real lead: probing a non-existent id must still be recordable
      expect(await control.recordSignal(draft(u.id, { signalType: "CONTACT_ACCESS_DENIED_EVENT", dedupeKey: "e1", targetLeadId: lead, observedCount: null, threshold: null, windowSeconds: null }))).toBe(true);
      expect(await sqlError(control.recordSignal(draft(u.id, { signalType: "CONTACT_ACCESS_DENIED_EVENT", dedupeKey: "e2", targetLeadId: null, observedCount: null, threshold: null, windowSeconds: null })))).toMatch(/shape_check/);
      expect(await sqlError(control.recordSignal(draft(u.id, { dedupeKey: "r1", targetLeadId: lead })))).toMatch(/shape_check/);
      expect(await sqlError(control.recordSignal(draft(u.id, { dedupeKey: "r2", observedCount: -1 })))).toMatch(/counts_check|violates check/);
      expect(await sqlError(control.recordSignal(draft(u.id, { dedupeKey: "r3", threshold: 0 })))).toMatch(/counts_check|violates check/);
    });

    it("a signal needs a real subject (foreign key)", async () => {
      expect(await sqlError(control.recordSignal(draft("99999999-9999-4999-8999-999999999998")))).toMatch(/foreign key|violates/i);
    });
  });

  // ---------------------------------------------------------------------------------------------------- decisions

  describe("decisions: constraints, uniqueness, immutability", () => {
    it("every block must expire; automated within 24 h, administrator within 30 days; a flag never expires", async () => {
      const u = await user("Subject");
      const admin = await newAdmin();
      const base = { subjectUserId: u.id, action: "TEMPORARY_BLOCK" as const, restrictedAction: "LEAD_PUBLICATION" as const, reasonCode: "X", decidedAt: new Date("2026-10-12T10:00:00Z") };
      const auto = { ...base, origin: "AUTOMATED" as const, ruleKey: "PUBLICATION_BURST" as const, ruleVersion: "m156.v1" };
      const adm = { ...base, origin: "ADMIN" as const, createdByUserId: admin, explanation: "why" };
      const create = (data: Record<string, unknown>) => prisma.leadAbuseDecision.create({ data: data as never });

      expect(await sqlError(create({ ...auto, expiresAt: null }))).toMatch(/block_expiry_check/); // permanent
      expect(await sqlError(create({ ...auto, expiresAt: new Date("2026-10-13T10:00:01Z") }))).toMatch(/block_expiry_check/); // 24 h + 1 s
      expect(await sqlError(create({ ...auto, expiresAt: new Date("2026-10-12T10:00:00Z") }))).toMatch(/block_expiry_check/); // not after decision
      expect(await sqlError(create({ ...adm, expiresAt: new Date("2026-11-11T10:00:01Z") }))).toMatch(/block_expiry_check/); // 30 d + 1 s
      await create({ ...auto, expiresAt: new Date("2026-10-13T10:00:00Z"), restrictedAction: "LEAD_PURCHASE_INITIATION" }); // exactly 24 h is allowed
      await create({ ...adm, expiresAt: new Date("2026-11-11T10:00:00Z") }); // exactly 30 d is allowed
      expect(await sqlError(create({ ...auto, action: "FLAG_FOR_REVIEW", restrictedAction: null, expiresAt: new Date("2026-10-12T11:00:00Z") }))).toMatch(/flag_no_expiry_check/);
    });

    it("shape CHECKs: a block names its action, a flag none; automated rows have a rule and no human; admin rows a human and an explanation", async () => {
      const u = await user("Subject");
      const admin = await newAdmin();
      const t0 = new Date("2026-10-12T10:00:00Z");
      const t1 = new Date("2026-10-12T11:00:00Z");
      const create = (data: Record<string, unknown>) => prisma.leadAbuseDecision.create({ data: { subjectUserId: u.id, reasonCode: "X", decidedAt: t0, ...data } as never });
      expect(await sqlError(create({ action: "TEMPORARY_BLOCK", restrictedAction: null, origin: "AUTOMATED", ruleKey: "PUBLICATION_BURST", ruleVersion: "v", expiresAt: t1 }))).toMatch(/action_shape_check/);
      expect(await sqlError(create({ action: "FLAG_FOR_REVIEW", restrictedAction: "LEAD_PUBLICATION", origin: "AUTOMATED", ruleKey: "PUBLICATION_BURST", ruleVersion: "v" }))).toMatch(/action_shape_check/);
      expect(await sqlError(create({ action: "FLAG_FOR_REVIEW", origin: "AUTOMATED", ruleKey: null, ruleVersion: null }))).toMatch(/origin_check/);
      expect(await sqlError(create({ action: "FLAG_FOR_REVIEW", origin: "AUTOMATED", ruleKey: "PUBLICATION_BURST", ruleVersion: "v", createdByUserId: admin }))).toMatch(/origin_check/);
      expect(await sqlError(create({ action: "TEMPORARY_BLOCK", restrictedAction: "LEAD_PUBLICATION", origin: "ADMIN", createdByUserId: null, explanation: "x", expiresAt: t1 }))).toMatch(/origin_check/);
      expect(await sqlError(create({ action: "TEMPORARY_BLOCK", restrictedAction: "LEAD_PUBLICATION", origin: "ADMIN", createdByUserId: admin, explanation: null, expiresAt: t1 }))).toMatch(/origin_check/);
      expect(await sqlError(create({ action: "FLAG_FOR_REVIEW", origin: "ADMIN", createdByUserId: admin, explanation: "x" }))).toMatch(/origin_check/); // administrators impose blocks, not flags
      expect(await sqlError(create({ action: "FLAG_FOR_REVIEW", origin: "AUTOMATED", ruleKey: "PUBLICATION_BURST", ruleVersion: "v", status: "LIFTED" }))).toMatch(/status_check/);
    });

    it("at most one ACTIVE flag and one ACTIVE block per (subject, action); after a lift a new one can be created", async () => {
      const u = await user("Subject");
      const first = await control.applyAutomatedDecision(automatedFlag(u.id));
      expect(first.created).toBe(true);
      const second = await sqlError(prisma.leadAbuseDecision.create({ data: { subjectUserId: u.id, action: "FLAG_FOR_REVIEW", origin: "AUTOMATED", ruleKey: "PUBLICATION_BURST", ruleVersion: "v", reasonCode: "X", decidedAt: new Date() } }));
      expect(second).toMatch(/one_active_flag|Unique constraint/);
      const admin = await newAdmin();
      await control.lift(first.decision.id, admin, "reviewed", new Date());
      expect((await control.applyAutomatedDecision(automatedFlag(u.id))).created).toBe(true);

      // blocks are unique per restricted action, independent of each other
      expect((await control.applyAutomatedDecision(automatedBlock(u.id))).created).toBe(true);
      expect((await control.applyAutomatedDecision(automatedBlock(u.id, { restrictedAction: "LEAD_PURCHASE_INITIATION" }))).created).toBe(true);
      expect((await control.applyAutomatedDecision(automatedBlock(u.id))).created).toBe(false);
    });

    it("identity and decision columns are immutable; status moves ACTIVE -> LIFTED|EXPIRED only; rows are never deleted", async () => {
      const u = await user("Subject");
      const other = await user("Other");
      const admin = await newAdmin();
      const { decision } = await control.applyAutomatedDecision(automatedBlock(u.id));
      const upd = (data: Record<string, unknown>) => prisma.leadAbuseDecision.update({ where: { id: decision.id }, data: data as never });
      for (const data of [
        { subjectUserId: other.id },
        { action: "FLAG_FOR_REVIEW" },
        { restrictedAction: "LEAD_PURCHASE_INITIATION" },
        { origin: "ADMIN" },
        { ruleKey: "PURCHASE_INITIATION_BURST" },
        { reasonCode: "OTHER" },
        { expiresAt: new Date(Date.now() + 10 * HOUR) },
        { decidedAt: new Date(0) },
        { explanation: "edited" },
        { createdByUserId: admin },
      ]) {
        expect(await sqlError(upd(data)), JSON.stringify(data)).toMatch(/immutable|check/);
      }
      expect(await sqlError(prisma.leadAbuseDecision.delete({ where: { id: decision.id } }))).toMatch(/never deleted/);
      expect(await sqlError(prisma.$executeRaw`DELETE FROM "lead_abuse_decisions"`)).toMatch(/never deleted/);

      await upd({ status: "LIFTED", liftedAt: new Date(), liftedByUserId: admin, resolutionNote: "ok" });
      for (const to of ["ACTIVE", "EXPIRED"]) expect(await sqlError(upd({ status: to, liftedAt: null, liftedByUserId: null, resolutionNote: null }))).toMatch(/not allowed|check|write-once/);
      expect(await sqlError(upd({ resolutionNote: "rewritten" }))).toMatch(/write-once|check/);

      // a LIFTED status without an administrator and a note violates the CHECK
      const { decision: d2 } = await control.applyAutomatedDecision(automatedBlock(u.id, { restrictedAction: "LEAD_PURCHASE_INITIATION" }));
      expect(await sqlError(prisma.leadAbuseDecision.update({ where: { id: d2.id }, data: { status: "LIFTED", liftedAt: new Date() } }))).toMatch(/status_check/);
      // an EXPIRED status carries no human
      await prisma.leadAbuseDecision.update({ where: { id: d2.id }, data: { status: "EXPIRED" } });
    });
  });

  // ---------------------------------------------------------------------------------------------------- concurrency

  describe("concurrency and races", () => {
    it("25 concurrent identical automated flags create ONE row, ONE winner and ONE audit entry", async () => {
      const u = await user("Subject");
      const outcomes = await Promise.all(Array.from({ length: 25 }, () => control.applyAutomatedDecision(automatedFlag(u.id))));
      expect(outcomes.filter((o) => o.created)).toHaveLength(1);
      expect(new Set(outcomes.map((o) => o.decision.id)).size).toBe(1);
      expect(await prisma.leadAbuseDecision.count({ where: { subjectUserId: u.id } })).toBe(1);
      const entries = await auditOf(outcomes[0]!.decision.id);
      expect(entries.map(adminActionOf)).toEqual(["LEAD_ABUSE_FLAGGED"]);
      expect(entries[0]!.actorUserId).toBeNull();
    });

    it("25 concurrent automated blocks create ONE block (and no second ACTIVE row ever exists)", async () => {
      const u = await user("Subject");
      const outcomes = await Promise.all(Array.from({ length: 25 }, () => control.applyAutomatedDecision(automatedBlock(u.id))));
      expect(outcomes.filter((o) => o.created)).toHaveLength(1);
      expect(await prisma.leadAbuseDecision.count({ where: { subjectUserId: u.id, status: "ACTIVE", action: "TEMPORARY_BLOCK" } })).toBe(1);
    });

    it("an expired ACTIVE block is moved to EXPIRED and replaced; concurrent replacements still yield one ACTIVE block", async () => {
      const u = await user("Subject");
      const t0 = new Date(Date.now() - 3 * HOUR);
      expect((await control.applyAutomatedDecision(automatedBlock(u.id, { decidedAt: t0, expiresAt: new Date(t0.getTime() + HOUR) }))).created).toBe(true);
      expect(await control.findBlockInForce(u.id, "LEAD_PUBLICATION", new Date())).toBeNull(); // expired rows never restrict
      const outcomes = await Promise.all(Array.from({ length: 10 }, () => control.applyAutomatedDecision(automatedBlock(u.id))));
      expect(outcomes.filter((o) => o.created)).toHaveLength(1);
      const rows = await prisma.leadAbuseDecision.findMany({ where: { subjectUserId: u.id, action: "TEMPORARY_BLOCK" }, orderBy: { decidedAt: "asc" } });
      expect(rows.map((r) => r.status)).toEqual(["EXPIRED", "ACTIVE"]);
      expect(await control.findBlockInForce(u.id, "LEAD_PUBLICATION", new Date())).not.toBeNull();
    });

    it("8 racing administrator lifts: exactly one wins, one audit entry, the others are INVALID_STATE", async () => {
      const u = await user("Subject");
      const adminId = await newAdmin();
      const lift = new LiftLeadAbuseDecisionUseCase(admins, control);
      const { decision } = await control.applyAutomatedDecision(automatedBlock(u.id));
      const results = await Promise.all(Array.from({ length: 8 }, (_, i) => lift.execute(adminId, { decisionId: decision.id, note: `n${i}` }).then(() => "ok", (e: unknown) => (e instanceof LeadAbuseControlRejectedError ? e.reason : String(e)))));
      expect(results.filter((r) => r === "ok")).toHaveLength(1);
      expect(results.filter((r) => r === "INVALID_STATE")).toHaveLength(7);
      expect((await auditOf(decision.id)).map(adminActionOf)).toEqual(["LEAD_ABUSE_BLOCK_APPLIED", "LEAD_ABUSE_DECISION_LIFTED"]);
      const row = await prisma.leadAbuseDecision.findUniqueOrThrow({ where: { id: decision.id } });
      expect(row).toMatchObject({ status: "LIFTED", liftedByUserId: adminId });
    });

    it("a lift racing an automated re-apply never leaves two ACTIVE blocks", async () => {
      const u = await user("Subject");
      const adminId = await newAdmin();
      const { decision } = await control.applyAutomatedDecision(automatedBlock(u.id));
      await Promise.all([control.lift(decision.id, adminId, "go", new Date()), ...Array.from({ length: 6 }, () => control.applyAutomatedDecision(automatedBlock(u.id)))]);
      expect(await prisma.leadAbuseDecision.count({ where: { subjectUserId: u.id, status: "ACTIVE", action: "TEMPORARY_BLOCK" } })).toBeLessThanOrEqual(1);
    });

    it("10 concurrent evaluations of one subject in ENFORCE create one flag, one block, two audit entries", async () => {
      const c = await newCustomer();
      for (let i = 0; i < 4; i += 1) await request(c);
      const evaluate = evaluateWith(cfg("ENFORCE", SMALL));
      await Promise.all(Array.from({ length: 10 }, () => evaluate.execute({ subjectUserId: c.userId, trigger: "PUBLICATION" })));
      const decisions = await prisma.leadAbuseDecision.findMany({ where: { subjectUserId: c.userId } });
      expect(decisions.map((d) => d.action).sort()).toEqual(["FLAG_FOR_REVIEW", "TEMPORARY_BLOCK"]);
      const audits = await prisma.auditLog.count({ where: { entityType: "LeadAbuseDecision", entityId: { in: decisions.map((d) => d.id) } } });
      expect(audits).toBe(2);
      expect(await prisma.leadAbuseSignal.count({ where: { subjectUserId: c.userId, signalType: "PUBLICATION_BURST" } })).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------------------------------- audit atomicity

  describe("atomic audit", () => {
    it("a failing audit insert rolls the decision back and the error reaches the caller; the retry then succeeds", async () => {
      const u = await user("Subject");
      vi.mocked(recordAdminAuditLogWithin).mockImplementationOnce(() => Promise.reject(new Error("audit store down")));
      await expect(control.applyAutomatedDecision(automatedFlag(u.id))).rejects.toThrow("audit store down");
      expect(await prisma.leadAbuseDecision.count({ where: { subjectUserId: u.id } })).toBe(0);
      expect((await control.applyAutomatedDecision(automatedFlag(u.id))).created).toBe(true);
    });

    it("a failing audit insert rolls a lift back: the decision stays ACTIVE", async () => {
      const u = await user("Subject");
      const adminId = await newAdmin();
      const { decision } = await control.applyAutomatedDecision(automatedBlock(u.id));
      vi.mocked(recordAdminAuditLogWithin).mockImplementationOnce(() => Promise.reject(new Error("audit store down")));
      await expect(control.lift(decision.id, adminId, "note", new Date())).rejects.toThrow("audit store down");
      expect((await prisma.leadAbuseDecision.findUniqueOrThrow({ where: { id: decision.id } })).status).toBe("ACTIVE");
      expect(await control.lift(decision.id, adminId, "note", new Date())).not.toBeNull();
    });

    it("audit entries carry ids and action names, never the explanation / note text", async () => {
      const u = await user("Subject");
      const adminId = await newAdmin();
      const dto = await new ImposeLeadAbuseBlockUseCase(admins, control).execute(adminId, { subjectUserId: u.id, restrictedAction: "LEAD_PURCHASE_INITIATION", durationMs: 2 * HOUR, explanation: "SECRET-EXPLANATION-TEXT" });
      await new LiftLeadAbuseDecisionUseCase(admins, control).execute(adminId, { decisionId: dto.id, note: "SECRET-NOTE-TEXT" });
      const entries = await auditOf(dto.id);
      expect(entries.map(adminActionOf)).toEqual(["LEAD_ABUSE_BLOCK_APPLIED", "LEAD_ABUSE_DECISION_LIFTED"]);
      expect(entries.every((e) => e.actorUserId === adminId)).toBe(true);
      expect(JSON.stringify(entries)).not.toMatch(/SECRET-/);
    });
  });

  // ---------------------------------------------------------------------------------------------------- administrator path on real roles

  describe("administrator authorization on real roles", () => {
    it("an ordinary user, a suspended administrator and the subject themselves cannot impose; an ADMIN and a SUPER_ADMIN can", async () => {
      const subject = await user("Subject");
      const impose = new ImposeLeadAbuseBlockUseCase(admins, control);
      const input = { subjectUserId: subject.id, restrictedAction: "LEAD_PUBLICATION" as const, durationMs: HOUR, explanation: "because" };
      const reason = (p: Promise<unknown>) => p.then(() => "ok", (e: unknown) => (e instanceof LeadAbuseControlRejectedError ? e.reason : String(e)));

      const ordinary = await user("Ordinary");
      expect(await reason(impose.execute(ordinary.id, input))).toBe("ACTOR_NOT_AUTHORIZED");
      const customerRole = await prisma.role.upsert({ where: { key: "CUSTOMER" }, update: {}, create: { key: "CUSTOMER", name: "CUSTOMER" } });
      await prisma.userRole.create({ data: { userId: ordinary.id, roleId: customerRole.id } });
      expect(await reason(impose.execute(ordinary.id, input))).toBe("ACTOR_NOT_AUTHORIZED");

      const suspended = await newAdmin("ADMIN");
      await prisma.user.update({ where: { id: suspended }, data: { status: "SUSPENDED" } });
      expect(await reason(impose.execute(suspended, input))).toBe("ACTOR_NOT_AUTHORIZED");
      expect(await prisma.leadAbuseDecision.count()).toBe(0);

      expect(await reason(impose.execute(await newAdmin("SUPER_ADMIN"), input))).toBe("ok");
      expect(await reason(impose.execute(await newAdmin("ADMIN"), input))).toBe("INVALID_STATE"); // already blocked
      const selfAdmin = await newAdmin("ADMIN");
      expect(await reason(impose.execute(selfAdmin, { ...input, subjectUserId: selfAdmin }))).toBe("ACTOR_NOT_AUTHORIZED");
    });

    it("an administrator-imposed block restricts only the named action and only while in force", async () => {
      const subject = await user("Subject");
      const adminId = await newAdmin();
      await new ImposeLeadAbuseBlockUseCase(admins, control).execute(adminId, { subjectUserId: subject.id, restrictedAction: "LEAD_PURCHASE_INITIATION", durationMs: HOUR, explanation: "chargebacks" });
      const rt = runtimeWith(cfg("ENFORCE"));
      const inner = { execute: vi.fn(async () => "ok") };
      await expect(new LeadAbuseGuardedInitiatePurchase(inner, rt).execute(subject.id, "11111111-1111-4111-8111-111111111111")).rejects.toBeInstanceOf(AccountRestrictedError);
      await expect(new LeadAbuseGuardedPublishLead(inner, rt).execute(subject.id, "11111111-1111-4111-8111-111111111111")).resolves.toBe("ok");
      expect(inner.execute).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------------------------------- facts over real rows

  describe("facts reader over real M123/M135/M155 rows", () => {
    it("counts LEAD_V1 publications of the customer inside the window only", async () => {
      const c = await newCustomer();
      const other = await newCustomer();
      const a = await request(c);
      await request(c);
      await request(c, { publish: false }); // a DRAFT lead is not a publication
      await request(other);
      expect(await facts.countPublicationsByCustomer(c.userId, new Date(Date.now() - HOUR))).toBe(2);
      expect(await facts.countPublicationsByCustomer(other.userId, new Date(Date.now() - HOUR))).toBe(1);
      expect(await facts.countPublicationsByCustomer(c.userId, new Date(Date.now() + 1000))).toBe(0);
      expect(a.leadId).toBeTruthy(); // publishedAt is immutable (M123 snapshot trigger): the window edge is exercised via `since`
    });

    it("a legacy-flow request is never counted (LEAD_V1 isolation)", async () => {
      const c = await newCustomer();
      const r = await request(c);
      await prisma.serviceRequest.update({ where: { id: r.requestId }, data: { flowVersion: "LEGACY_QUOTE_PAYMENT" } });
      expect(await facts.countPublicationsByCustomer(c.userId, new Date(Date.now() - HOUR))).toBe(0);
      expect(await facts.maxIdenticalRequestGroupByCustomer(c.userId, new Date(Date.now() - DAY))).toBe(0);
    });

    it("near-duplicate content: whitespace and case are normalised, different text is not grouped, deleted requests are ignored", async () => {
      const c = await newCustomer();
      await request(c, { title: "Fix  the leaking TAP", description: "Kitchen   tap leaks\nsince Monday" });
      await request(c, { title: "fix the leaking tap", description: "kitchen tap leaks since monday" });
      const third = await request(c, { title: " Fix the leaking tap ", description: "Kitchen tap leaks since Monday " });
      await request(c, { title: "Paint a wall", description: "Completely different" });
      expect(await facts.maxIdenticalRequestGroupByCustomer(c.userId, new Date(Date.now() - DAY))).toBe(3);
      await prisma.serviceRequest.update({ where: { id: third.requestId }, data: { deletedAt: new Date() } });
      expect(await facts.maxIdenticalRequestGroupByCustomer(c.userId, new Date(Date.now() - DAY))).toBe(2);
      const lonely = await newCustomer();
      expect(await facts.maxIdenticalRequestGroupByCustomer(lonely.userId, new Date(Date.now() - DAY))).toBe(0);
    });

    it("counts purchases created by the professional (any status) inside the window", async () => {
      const pro = await newProfessional();
      const other = await newProfessional();
      await purchaseFor(pro);
      await purchaseFor(pro);
      await purchaseFor(pro, { confirm: true });
      await purchaseFor(other);
      expect(await facts.countPurchaseInitiationsByProfessional(pro.userId, new Date(Date.now() - HOUR))).toBe(3);
      expect(await facts.countPurchaseInitiationsByProfessional(other.userId, new Date(Date.now() - HOUR))).toBe(1);
      expect(await facts.countPurchaseInitiationsByProfessional(pro.userId, new Date(Date.now() + 1000))).toBe(0);
    });

    it("counts M155 disputes (opened / lost) and revocations of the professional, read-only", async () => {
      const pro = await newProfessional();
      const stranger = await newProfessional();
      const since = new Date(Date.now() - 90 * DAY);
      const p1 = await purchaseFor(pro, { confirm: true });
      const p2 = await purchaseFor(pro, { confirm: true });
      const p3 = await purchaseFor(pro, { confirm: true });
      await purchaseFor(stranger, { confirm: true });

      await disputeWebhook().execute(disputeEvent(p1.reference, { disputeId: "dp_m156_1" }));
      await disputeWebhook().execute(disputeEvent(p2.reference, { disputeId: "dp_m156_2" }));
      await disputeWebhook().execute(disputeEvent(p2.reference, { disputeId: "dp_m156_2", type: "charge.dispute.closed", status: "lost" }));
      const revoked = await new RevokeLeadPurchaseUseCase(purchases, revocations, admins).execute({ actorUserId: await newAdmin(), leadPurchaseId: p3.purchaseId, explanation: "policy breach", evidenceReference: "case-1" });
      expect(revoked.revoked).toBe(true);

      const before = await moneyAndPurchaseSnapshot();
      expect(await facts.countDisputesOpenedByProfessional(pro.userId, since)).toBe(2);
      expect(await facts.countDisputesLostByProfessional(pro.userId, since)).toBe(1);
      expect(await facts.countRevocationsByProfessional(pro.userId, since)).toBe(2); // p2 revoked by the lost chargeback, p3 by the administrator
      expect(await facts.countDisputesOpenedByProfessional(stranger.userId, since)).toBe(0);
      expect(await facts.countDisputesOpenedByProfessional(pro.userId, new Date(Date.now() + 1000))).toBe(0);
      expect(await moneyAndPurchaseSnapshot()).toEqual(before); // reading changes nothing
    });

    it("distinct probed leads: repeated hits on one lead inside an hour are ONE row; non-existent lead ids are recorded; windows apply", async () => {
      const u = await user("Prober");
      const rt = runtimeWith(cfg("SHADOW"));
      const ids = Array.from({ length: 5 }, (_, i) => `00000000-0000-4000-b000-00000000000${i}`);
      for (let round = 0; round < 3; round += 1) for (const id of ids) await rt.recordEvent(u.id, id, "CONTACT_ACCESS_DENIED_EVENT");
      await Promise.all(Array.from({ length: 20 }, () => rt.recordEvent(u.id, ids[0], "PURCHASE_REJECTED_EVENT")));
      expect(await prisma.leadAbuseSignal.count({ where: { subjectUserId: u.id, signalType: "CONTACT_ACCESS_DENIED_EVENT" } })).toBe(5);
      expect(await prisma.leadAbuseSignal.count({ where: { subjectUserId: u.id, signalType: "PURCHASE_REJECTED_EVENT" } })).toBe(1);
      expect(await facts.countDistinctEventLeads(u.id, "CONTACT_ACCESS_DENIED_EVENT", new Date(Date.now() - HOUR))).toBe(5);
      expect(await facts.countDistinctEventLeads(u.id, "PURCHASE_REJECTED_EVENT", new Date(Date.now() - HOUR))).toBe(1);
      expect(await facts.countDistinctEventLeads(u.id, "CONTACT_ACCESS_DENIED_EVENT", new Date(Date.now() + 1000))).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------------------------------- end to end

  describe("end to end on real rows", () => {
    it("publication burst: FLAG mode flags only; SHADOW records only; ENFORCE blocks the next publication, and lifting restores it", async () => {
      const shadow = await newCustomer();
      for (let i = 0; i < 4; i += 1) await request(shadow);
      await evaluateWith(cfg("SHADOW", SMALL)).execute({ subjectUserId: shadow.userId, trigger: "PUBLICATION" });
      expect(await prisma.leadAbuseSignal.count({ where: { subjectUserId: shadow.userId } })).toBe(1);
      expect(await prisma.leadAbuseDecision.count({ where: { subjectUserId: shadow.userId } })).toBe(0);

      const flag = await newCustomer();
      for (let i = 0; i < 4; i += 1) await request(flag);
      await evaluateWith(cfg("FLAG", SMALL)).execute({ subjectUserId: flag.userId, trigger: "PUBLICATION" });
      expect((await prisma.leadAbuseDecision.findMany({ where: { subjectUserId: flag.userId } })).map((d) => d.action)).toEqual(["FLAG_FOR_REVIEW"]);

      const enforce = await newCustomer();
      for (let i = 0; i < 4; i += 1) await request(enforce);
      const config = cfg("ENFORCE", SMALL);
      const inner = { execute: vi.fn(async () => "published") };
      const guard = new LeadAbuseGuardedPublishLead(inner, runtimeWith(config));
      await expect(guard.execute(enforce.userId, "11111111-1111-4111-8111-111111111111")).resolves.toBe("published");
      await expect(guard.execute(enforce.userId, "11111111-1111-4111-8111-111111111111")).rejects.toBeInstanceOf(AccountRestrictedError);
      expect(inner.execute).toHaveBeenCalledTimes(1);
      const block = await prisma.leadAbuseDecision.findFirstOrThrow({ where: { subjectUserId: enforce.userId, action: "TEMPORARY_BLOCK" } });
      expect(block).toMatchObject({ origin: "AUTOMATED", restrictedAction: "LEAD_PUBLICATION", ruleKey: "PUBLICATION_BURST" });
      expect(block.expiresAt!.getTime() - block.decidedAt.getTime()).toBeLessThanOrEqual(DAY);

      // another customer is unaffected; lifting restores the action
      const innocent = await newCustomer();
      await expect(new LeadAbuseGuardedPublishLead(inner, runtimeWith(config)).execute(innocent.userId, "11111111-1111-4111-8111-111111111111")).resolves.toBe("published");
      await new LiftLeadAbuseDecisionUseCase(admins, control).execute(await newAdmin(), { decisionId: block.id, note: "false positive" });
      await expect(new LeadAbuseGuardedPublishLead(inner, runtimeWith(cfg("ENFORCE"))).execute(enforce.userId, "11111111-1111-4111-8111-111111111111")).resolves.toBe("published");
    });

    it("purchase probing and initiation burst: a rejected purchase attempt is recorded once per lead/hour and never flags or blocks; a burst blocks initiation", async () => {
      const pro = await newProfessional();
      const config = cfg("ENFORCE", SMALL);
      const rt = runtimeWith(config);
      const refusal = new LeadNotPurchasableError();
      const guardRefusing = new LeadAbuseGuardedInitiatePurchase({ execute: async () => Promise.reject(refusal) }, rt);
      const leadIds = Array.from({ length: 3 }, (_, i) => `00000000-0000-4000-c000-00000000000${i}`);
      for (const id of leadIds) await expect(guardRefusing.execute(pro.userId, id)).rejects.toBe(refusal);
      await expect(guardRefusing.execute(pro.userId, leadIds[0]!)).rejects.toBe(refusal);
      expect(await prisma.leadAbuseSignal.count({ where: { subjectUserId: pro.userId, signalType: "PURCHASE_REJECTED_EVENT" } })).toBe(3);
      const flags = await prisma.leadAbuseDecision.findMany({ where: { subjectUserId: pro.userId } });
      // PURCHASE_REJECTED_PROBING is record-only (hardening pass): evidence is stored, nothing is flagged or blocked
      expect(flags).toEqual([]);
      expect(await prisma.leadAbuseSignal.count({ where: { subjectUserId: pro.userId, signalType: "PURCHASE_REJECTED_PROBING" } })).toBe(1);

      // initiation burst: four real purchase rows, then the next initiation is refused before the use case runs
      for (let i = 0; i < 4; i += 1) await purchaseFor(pro);
      const inner = { execute: vi.fn(async () => "pending") };
      const guard = new LeadAbuseGuardedInitiatePurchase(inner, rt);
      await expect(guard.execute(pro.userId, leadIds[0]!)).resolves.toBe("pending"); // evaluates after success -> block
      await expect(guard.execute(pro.userId, leadIds[0]!)).rejects.toBeInstanceOf(AccountRestrictedError);
      expect(inner.execute).toHaveBeenCalledTimes(1);
    });

    it("repeated disputes / revocations FLAG for review and never block in ENFORCE", async () => {
      const pro = await newProfessional();
      for (const n of [1, 2]) {
        const p = await purchaseFor(pro, { confirm: true });
        await disputeWebhook().execute(disputeEvent(p.reference, { disputeId: `dp_m156_flag_${n}` }));
        await disputeWebhook().execute(disputeEvent(p.reference, { disputeId: `dp_m156_flag_${n}`, type: "charge.dispute.closed", status: "lost" }));
      }
      const before = await moneyAndPurchaseSnapshot();
      const assessment = await evaluateWith(cfg("ENFORCE")).execute({ subjectUserId: pro.userId, trigger: "PURCHASE" });
      expect(assessment?.hits.map((h) => h.rule).sort()).toEqual(["REPEATED_DISPUTES_LOST", "REPEATED_DISPUTES_OPENED", "REPEATED_REVOCATIONS"]);
      const decisions = await prisma.leadAbuseDecision.findMany({ where: { subjectUserId: pro.userId } });
      expect(decisions.map((d) => d.action)).toEqual(["FLAG_FOR_REVIEW"]);
      expect(await prisma.leadAbuseSignal.count({ where: { subjectUserId: pro.userId, reliability: "RELIABLE" } })).toBe(3);
      expect(await moneyAndPurchaseSnapshot()).toEqual(before);
    });

    it("OFF writes nothing at all; evaluation never creates or changes a purchase, dispute, revocation or money row", async () => {
      const c = await newCustomer();
      for (let i = 0; i < 4; i += 1) await request(c);
      const pro = await newProfessional();
      const p = await purchaseFor(pro, { confirm: true });
      await disputeWebhook().execute(disputeEvent(p.reference, { disputeId: "dp_m156_off" }));
      const before = await moneyAndPurchaseSnapshot();
      expect(await evaluateWith(cfg("OFF", SMALL)).execute({ subjectUserId: c.userId, trigger: "PUBLICATION" })).toBeNull();
      expect(await prisma.leadAbuseSignal.count()).toBe(0);
      for (const mode of ["SHADOW", "FLAG", "ENFORCE"] as const) {
        await evaluateWith(cfg(mode, SMALL)).execute({ subjectUserId: c.userId, trigger: "PUBLICATION" });
        await evaluateWith(cfg(mode, SMALL)).execute({ subjectUserId: pro.userId, trigger: "PURCHASE" });
      }
      expect(await moneyAndPurchaseSnapshot()).toEqual(before);
    });
  });

  // ---------------------------------------------------------------------------------------------------- M139 / M155 regression

  describe("M138/M139 contact protection and M155 access revocation are preserved", () => {
    const observed = (mode: LeadAbuseMode) => new LeadAbuseObservedGetLeadContact(getContact, runtimeWith(cfg(mode, SMALL)));

    it("CONFIRMED purchase: contact is granted exactly as before, no event is recorded", async () => {
      const pro = await newProfessional();
      const p = await purchaseFor(pro, { confirm: true });
      const direct = await getContact.execute(pro.userId, p.leadId);
      expect(await observed("ENFORCE").execute(pro.userId, p.leadId)).toEqual(direct);
      expect(await prisma.leadAbuseSignal.count()).toBe(0);
    });

    it("PENDING_PAYMENT (no pre-purchase contact), no purchase, and another professional's lead are denied; the observer records probing", async () => {
      const pro = await newProfessional();
      const pending = await purchaseFor(pro);
      const stranger = await newProfessional();
      const bought = await purchaseFor(stranger, { confirm: true });
      for (const [userId, leadId] of [
        [pro.userId, pending.leadId],
        [pro.userId, bought.leadId],
        [pro.userId, "00000000-0000-4000-d000-000000000001"],
      ] as const) {
        await expect(observed("ENFORCE").execute(userId, leadId)).rejects.toBeInstanceOf(LeadContactAccessDeniedError);
      }
      expect(await prisma.leadAbuseSignal.count({ where: { subjectUserId: pro.userId, signalType: "CONTACT_ACCESS_DENIED_EVENT" } })).toBe(3);
      // reaching the probing threshold flags the account but contact access is still decided by the unchanged policy
      const flag = await prisma.leadAbuseDecision.findMany({ where: { subjectUserId: pro.userId } });
      expect(flag.map((f) => [f.action, f.ruleKey])).toEqual([["FLAG_FOR_REVIEW", "CONTACT_ACCESS_DENIED_PROBING"]]);
      await expect(observed("ENFORCE").execute(pro.userId, pending.leadId)).rejects.toBeInstanceOf(LeadContactAccessDeniedError);
    });

    it("M155: an open dispute (DISPUTED) denies contact at once; a LOST dispute (REVOKED) never returns it; a WON dispute restores it — risk never overrides", async () => {
      const pro = await newProfessional();
      const won = await purchaseFor(pro, { confirm: true });
      await expect(observed("ENFORCE").execute(pro.userId, won.leadId)).resolves.toMatchObject({ leadId: won.leadId });

      await disputeWebhook().execute(disputeEvent(won.reference, { disputeId: "dp_m156_won" }));
      expect((await prisma.leadPurchase.findUniqueOrThrow({ where: { id: won.purchaseId } })).status).toBe("DISPUTED");
      await expect(observed("ENFORCE").execute(pro.userId, won.leadId)).rejects.toBeInstanceOf(LeadContactAccessDeniedError);

      await disputeWebhook().execute(disputeEvent(won.reference, { disputeId: "dp_m156_won", type: "charge.dispute.closed", status: "won" }));
      await expect(observed("ENFORCE").execute(pro.userId, won.leadId)).resolves.toMatchObject({ leadId: won.leadId });

      const lost = await purchaseFor(pro, { confirm: true });
      await disputeWebhook().execute(disputeEvent(lost.reference, { disputeId: "dp_m156_lost" }));
      await disputeWebhook().execute(disputeEvent(lost.reference, { disputeId: "dp_m156_lost", type: "charge.dispute.closed", status: "lost" }));
      expect((await prisma.leadPurchase.findUniqueOrThrow({ where: { id: lost.purchaseId } })).status).toBe("REVOKED");
      // the account now carries a HIGH-risk flag and an administrator block - neither grants, neither revokes the rest
      await evaluateWith(cfg("ENFORCE")).execute({ subjectUserId: pro.userId, trigger: "PURCHASE" });
      await control.imposeAdminBlock({ subjectUserId: pro.userId, restrictedAction: "LEAD_PURCHASE_INITIATION", actorUserId: await newAdmin(), explanation: "x", decidedAt: new Date(), expiresAt: new Date(Date.now() + HOUR) });
      await expect(observed("ENFORCE").execute(pro.userId, lost.leadId)).rejects.toBeInstanceOf(LeadContactAccessDeniedError);
      await expect(observed("ENFORCE").execute(pro.userId, won.leadId)).resolves.toMatchObject({ leadId: won.leadId }); // authorization is unchanged by risk
      // a WON event replayed on the REVOKED purchase does not restore it
      await disputeWebhook().execute(disputeEvent(lost.reference, { disputeId: "dp_m156_lost", type: "charge.dispute.closed", status: "won" }));
      await expect(observed("ENFORCE").execute(pro.userId, lost.leadId)).rejects.toBeInstanceOf(LeadContactAccessDeniedError);
    });

    it("denial stays fail-closed when the abuse store is unavailable (the observer never changes the outcome)", async () => {
      const pro = await newProfessional();
      const p = await purchaseFor(pro);
      const broken = new LeadAbuseRuntime("ENFORCE", { execute: () => Promise.reject(new Error("down")) }, { findBlockInForce: () => Promise.reject(new Error("down")), recordSignal: () => Promise.reject(new Error("down")) }, null);
      await expect(new LeadAbuseObservedGetLeadContact(getContact, broken).execute(pro.userId, p.leadId)).rejects.toBeInstanceOf(LeadContactAccessDeniedError);
    });
  });
});
