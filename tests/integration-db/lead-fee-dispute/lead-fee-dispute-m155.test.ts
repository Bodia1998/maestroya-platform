/**
 * Module 155 — Chargebacks & Access Revocation against REAL PostgreSQL.
 *
 * Proves what mocks cannot: both migrations' DDL, the partial unique index swap (a DISPUTED purchase still blocks a re-purchase),
 * the dispute / purchase / revocation triggers and CHECKs, the real Prisma adapters, atomicity with the audit entry, genuinely
 * concurrent events, contact access through the REAL authorization path, and that no ledger / invoice / credit-note / refund row
 * is ever written. The provider is never contacted (events are test fixtures; the evidence gateway is an in-memory fake).
 * Run with `npm run test:integration:db` (requires the guarded test database — see tests/test-utils/db).
 */
import { describe, expect, it, vi } from "vitest";

import type { LeadFeeDisputeGateway } from "@/application/ports/lead-fee-dispute-gateway";
import type { StripePaymentWebhookEvent } from "@/application/ports/stripe-payment-webhook-verifier";
import { GetLeadContactUseCase } from "@/application/use-cases/lead-contact/get-lead-contact.use-case";
import { ProcessLeadFeeDisputeWebhookUseCase } from "@/application/use-cases/lead-fee-dispute/process-lead-fee-dispute-webhook.use-case";
import { RevokeLeadPurchaseUseCase } from "@/application/use-cases/lead-fee-dispute/revoke-lead-purchase.use-case";
import { SubmitLeadFeeDisputeEvidenceUseCase } from "@/application/use-cases/lead-fee-dispute/submit-lead-fee-dispute-evidence.use-case";
import { ProcessLeadFeePaymentWebhookUseCase } from "@/application/use-cases/lead-fee-payment/process-lead-fee-payment-webhook.use-case";
import { ConfirmLeadPurchaseUseCase } from "@/application/use-cases/lead-purchase/confirm-lead-purchase.use-case";
import { TransitionLeadPurchaseUseCase } from "@/application/use-cases/lead-purchase/transition-lead-purchase.use-case";
import { LeadContactAccessDeniedError } from "@/domain/services/lead-contact-access-policy";
import { prisma } from "@/infrastructure/database/prisma/client";
import { PrismaExternalWebhookEventRepository } from "@/infrastructure/database/prisma/repositories/prisma-external-webhook-event-repository";
import { PrismaLeadContactAuthorizationReader, PrismaLeadContactReader } from "@/infrastructure/database/prisma/repositories/prisma-lead-contact-access-repository";
import {
  PrismaLeadFeeDisputeRepository,
  PrismaLeadPurchaseRevocationRepository,
} from "@/infrastructure/database/prisma/repositories/prisma-lead-fee-dispute-repository";
import { PrismaLeadFeeRefundRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-fee-refund-repository";
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

describe("Module 155 — chargebacks & access revocation (real PostgreSQL)", () => {
  setupDbTestLifecycle();

  const leads = new PrismaLeadRepository();
  const purchases = new PrismaLeadPurchaseRepository();
  const disputes = new PrismaLeadFeeDisputeRepository();
  const revocations = new PrismaLeadPurchaseRevocationRepository();
  const getContact = new GetLeadContactUseCase(new PrismaUserRepository(), new PrismaProfessionalRepository(), new PrismaLeadContactAuthorizationReader(), new PrismaLeadContactReader());
  let seq = 0;
  let evt = 0;

  const confirmer = () => new ConfirmLeadPurchaseUseCase(purchases, leads, new PrismaServiceRequestRepository());
  const paymentWebhook = () =>
    new ProcessLeadFeePaymentWebhookUseCase(
      purchases,
      leads,
      confirmer(),
      new TransitionLeadPurchaseUseCase(purchases),
      new PrismaExternalWebhookEventRepository(),
      undefined, // event bus
      undefined, // revenue ledger (not under test: M155 must not need it)
      // Module 155 hook: a dispute that arrived BEFORE the confirmation is applied right after it.
      { reconcile: (id: string) => disputes.reconcilePurchase(id, new Date()) },
    );
  const disputeWebhook = () => new ProcessLeadFeeDisputeWebhookUseCase(purchases, leads, disputes, new PrismaExternalWebhookEventRepository());

  async function purchase(opts: { confirm?: boolean; price?: string } = {}) {
    seq += 1;
    const customerUser = await createUser(prisma, { name: "Ana Cliente", email: `m155-customer-${seq}@test.maestroya.invalid` });
    await prisma.user.update({ where: { id: customerUser.id }, data: { phone: `+3461000${String(seq).padStart(4, "0")}` } });
    const address = await createAddress(prisma, customerUser.id);
    const customer = await createCustomerProfile(prisma, customerUser.id);
    const category = await createServiceCategory(prisma);
    const request = await createServiceRequest(prisma, { customerId: customer.id, categoryId: category.id, addressId: address.id });
    await prisma.serviceRequest.update({ where: { id: request.id }, data: { flowVersion: "LEAD_V1" } });
    const draft = await leads.create({ serviceRequestId: request.id });
    const lead = (await leads.publish(draft.id, { ...SNAPSHOT_DATA, price: opts.price ?? "100.00", maxBuyers: 5 }))!;
    const proUser = await createUser(prisma, { name: "Pro" });
    const profile = await createProfessionalProfile(prisma, proUser.id);
    const p = await purchases.initiate({ leadId: lead.id, professionalProfileId: profile.id });
    const reference = `pi_m155_${seq}`;
    await purchases.recordPaymentReference(p.id, reference);
    const admin = await createUser(prisma, { name: "Admin" });
    const base = { purchaseId: p.id, leadId: lead.id, reference, proUserId: proUser.id, profileId: profile.id, adminId: admin.id, total: 12100 };
    if (opts.confirm !== false) {
      expect((await paymentWebhook().execute(paymentEvent(base.reference, base.total))).outcome).toBe("confirmed");
    }
    return base;
  }

  const paymentEvent = (reference: string, amount: number): StripePaymentWebhookEvent => ({
    id: `evt_m155_pay_${++evt}`,
    type: "payment_intent.succeeded",
    createdAt: new Date(),
    paymentIntent: { paymentIntentId: reference, lastPaymentErrorMessage: null, amountMinorUnits: amount, currency: "eur", flow: "LEAD_V1", leadPurchaseId: null, leadId: null },
    chargeRefunded: null,
    dispute: null,
    chargeUpdated: null,
  });

  function disputeEvent(base: { reference: string }, o: { id?: string; type?: string; status?: string; disputeId?: string; amount?: number; at?: Date; charge?: string; pi?: string } = {}): StripePaymentWebhookEvent {
    return {
      id: o.id ?? `evt_m155_dp_${++evt}`,
      type: o.type ?? "charge.dispute.created",
      createdAt: o.at ?? new Date(),
      paymentIntent: null,
      chargeRefunded: null,
      chargeUpdated: null,
      dispute: {
        disputeId: o.disputeId ?? "dp_m155_1",
        chargeId: o.charge ?? "ch_m155_1",
        paymentIntentId: o.pi ?? base.reference,
        amount: (o.amount ?? 12100) / 100,
        amountMinorUnits: o.amount ?? 12100,
        currency: "eur",
        reason: "fraudulent",
        status: o.status ?? "needs_response",
        evidenceDueBy: new Date("2026-11-01T00:00:00Z"),
      },
    };
  }

  const statusOf = async (id: string) => (await prisma.leadPurchase.findUniqueOrThrow({ where: { id } })).status;
  const denied = async (p: Promise<unknown>) => expect(await p.then(() => null, (e: unknown) => e)).toBeInstanceOf(LeadContactAccessDeniedError);
  const sqlError = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (error) {
      return String((error as Error).message);
    }
    throw new Error("expected a database error");
  };
  const audit = (entityType: string, entityId: string) => prisma.auditLog.findMany({ where: { entityType, entityId }, orderBy: { createdAt: "asc" } });

  async function moneySnapshot() {
    return {
      ledger: await prisma.leadFeeLedgerEntry.count(),
      invoices: await prisma.leadFeeInvoice.count(),
      creditNotes: await prisma.leadFeeCreditNote.count(),
      refunds: await prisma.leadFeeRefund.count(),
      payments: await prisma.payment.count(),
      commissions: await prisma.commission.count(),
      payouts: await prisma.payout.count(),
    };
  }

  // ------------------------------------------------------------------------------------------------ lifecycle

  it("open dispute suspends access at once; WON restores it with the ORIGINAL confirmedAt; no money row is written", async () => {
    const base = await purchase();
    const confirmedAt = (await prisma.leadPurchase.findUniqueOrThrow({ where: { id: base.purchaseId } })).confirmedAt;
    await expect(getContact.execute(base.proUserId, base.leadId)).resolves.toMatchObject({ leadId: base.leadId });
    const before = await moneySnapshot();

    expect(await disputeWebhook().execute(disputeEvent(base))).toEqual({ outcome: "recorded", purchaseEffect: "SUSPEND" });
    expect(await statusOf(base.purchaseId)).toBe("DISPUTED");
    await denied(getContact.execute(base.proUserId, base.leadId));

    expect(await disputeWebhook().execute(disputeEvent(base, { type: "charge.dispute.closed", status: "won" }))).toMatchObject({ outcome: "status-updated", purchaseEffect: "RESTORE" });
    const restored = await prisma.leadPurchase.findUniqueOrThrow({ where: { id: base.purchaseId } });
    expect(restored.status).toBe("CONFIRMED");
    expect(restored.confirmedAt).toEqual(confirmedAt);
    await expect(getContact.execute(base.proUserId, base.leadId)).resolves.toMatchObject({ leadId: base.leadId });

    expect(await moneySnapshot()).toEqual(before);
    const row = await prisma.leadFeeDispute.findFirstOrThrow({ where: { leadPurchaseId: base.purchaseId } });
    expect(row).toMatchObject({ status: "WON", currency: "EUR", providerDisputeId: "dp_m155_1" });
    expect(row.amount.toFixed(2)).toBe("121.00");
    expect(row.closedAt).not.toBeNull();
  });

  it("LOST revokes the purchase (never REFUNDED), writes the revocation record, denies access, and creates no refund / ledger / invoice / credit note", async () => {
    const base = await purchase();
    const before = await moneySnapshot();
    await disputeWebhook().execute(disputeEvent(base));
    expect(await disputeWebhook().execute(disputeEvent(base, { type: "charge.dispute.closed", status: "lost" }))).toMatchObject({ outcome: "status-updated", purchaseEffect: "REVOKE" });

    const p = await prisma.leadPurchase.findUniqueOrThrow({ where: { id: base.purchaseId } });
    expect(p.status).toBe("REVOKED");
    expect(p.revokedAt).not.toBeNull();
    expect(p.refundedAt).toBeNull();
    const rev = await prisma.leadPurchaseRevocation.findFirstOrThrow({ where: { leadPurchaseId: base.purchaseId } });
    expect(rev.source).toBe("DISPUTE_LOST");
    expect(rev.leadFeeDisputeId).not.toBeNull();
    await denied(getContact.execute(base.proUserId, base.leadId));
    expect(await moneySnapshot()).toEqual(before);
  });

  it("a REVOKED purchase never returns: later WON / replays change nothing", async () => {
    const base = await purchase();
    await disputeWebhook().execute(disputeEvent(base));
    await disputeWebhook().execute(disputeEvent(base, { type: "charge.dispute.closed", status: "lost" }));
    const late = await disputeWebhook().execute(disputeEvent(base, { type: "charge.dispute.closed", status: "won" }));
    expect(late.outcome).toBe("replay");
    expect(await statusOf(base.purchaseId)).toBe("REVOKED");
    expect(await prisma.leadPurchaseRevocation.count({ where: { leadPurchaseId: base.purchaseId } })).toBe(1);
  });

  // ------------------------------------------------------------------------------------------------ idempotency / ordering

  it("a duplicate event id is a no-op: one dispute row, one purchase transition, one audit trail", async () => {
    const base = await purchase();
    const e = disputeEvent(base, { id: "evt_dup_1" });
    expect((await disputeWebhook().execute(e)).outcome).toBe("recorded");
    expect((await disputeWebhook().execute(e)).outcome).toBe("duplicate");
    expect(await prisma.leadFeeDispute.count()).toBe(1);
    expect((await audit("LeadPurchase", base.purchaseId)).filter((a) => (a.metadata as { adminAction?: string })?.adminAction === "LEAD_PURCHASE_ACCESS_SUSPENDED")).toHaveLength(1);
  });

  it("a different event id carrying the same status is a replay (no second audit entry, no state change)", async () => {
    const base = await purchase();
    await disputeWebhook().execute(disputeEvent(base));
    const auditBefore = await prisma.auditLog.count();
    expect((await disputeWebhook().execute(disputeEvent(base, { type: "charge.dispute.updated", status: "needs_response" }))).outcome).toBe("replay");
    expect(await prisma.auditLog.count()).toBe(auditBefore);
    expect(await statusOf(base.purchaseId)).toBe("DISPUTED");
  });

  it("out of order: closed(won) delivered BEFORE created/updated converges on the terminal state and never moves back", async () => {
    const base = await purchase();
    expect((await disputeWebhook().execute(disputeEvent(base, { type: "charge.dispute.closed", status: "won" }))).outcome).toBe("recorded");
    expect(await statusOf(base.purchaseId)).toBe("CONFIRMED");
    expect((await disputeWebhook().execute(disputeEvent(base, { type: "charge.dispute.created", status: "needs_response" }))).outcome).toBe("replay");
    expect((await disputeWebhook().execute(disputeEvent(base, { type: "charge.dispute.updated", status: "under_review" }))).outcome).toBe("replay");
    expect(await statusOf(base.purchaseId)).toBe("CONFIRMED");
    expect((await prisma.leadFeeDispute.findFirstOrThrow()).status).toBe("WON");
    await expect(getContact.execute(base.proUserId, base.leadId)).resolves.toMatchObject({ leadId: base.leadId });
  });

  it("out of order: closed(lost) first revokes; a late created/updated cannot resurrect or re-suspend", async () => {
    const base = await purchase();
    await disputeWebhook().execute(disputeEvent(base, { type: "charge.dispute.closed", status: "lost" }));
    await disputeWebhook().execute(disputeEvent(base, { type: "charge.dispute.created" }));
    expect(await statusOf(base.purchaseId)).toBe("REVOKED");
    expect((await prisma.leadFeeDispute.findFirstOrThrow()).status).toBe("LOST");
  });

  it("a dispute that arrives BEFORE the payment is confirmed is applied right after the confirmation (reconcile hook)", async () => {
    const base = await purchase({ confirm: false });
    expect(await statusOf(base.purchaseId)).toBe("PENDING_PAYMENT");
    expect((await disputeWebhook().execute(disputeEvent(base))).purchaseEffect).toBe("NONE");
    expect(await statusOf(base.purchaseId)).toBe("PENDING_PAYMENT");
    expect((await paymentWebhook().execute(paymentEvent(base.reference, base.total))).outcome).toBe("confirmed");
    expect(await statusOf(base.purchaseId)).toBe("DISPUTED");
    await denied(getContact.execute(base.proUserId, base.leadId));
  });

  it("a dispute after contact was accessed still suspends: access is derived from persisted state on the next call", async () => {
    const base = await purchase();
    const dto = await getContact.execute(base.proUserId, base.leadId);
    expect(dto.leadId).toBe(base.leadId);
    await disputeWebhook().execute(disputeEvent(base));
    await denied(getContact.execute(base.proUserId, base.leadId));
    // The earlier access is history, not a stored flag: nothing about it was written, nothing is rolled back.
    expect(await prisma.leadFeeDispute.count()).toBe(1);
  });

  // ------------------------------------------------------------------------------------------------ validation / association

  it("rejects (no row, no state change) wrong currency, amount above the payment, unknown status, and an unrelated payment", async () => {
    const base = await purchase();
    const bad = [
      disputeEvent(base, { amount: 12101 }),
      disputeEvent(base, { status: "charge_refunded" }),
      { ...disputeEvent(base), dispute: { ...disputeEvent(base).dispute!, currency: "usd" } },
    ];
    for (const e of bad) expect((await disputeWebhook().execute(e)).outcome).toBe("rejected");
    expect((await disputeWebhook().execute(disputeEvent(base, { pi: "pi_not_a_lead_fee" }))).outcome).toBe("unmatched");
    expect(await prisma.leadFeeDispute.count()).toBe(0);
    expect(await statusOf(base.purchaseId)).toBe("CONFIRMED");
  });

  it("an existing dispute id can never be re-associated with another purchase (rejected, nothing written)", async () => {
    const a = await purchase();
    const b = await purchase();
    await disputeWebhook().execute(disputeEvent(a, { disputeId: "dp_shared" }));
    const r = await disputeWebhook().execute(disputeEvent(b, { disputeId: "dp_shared" }));
    expect(r).toEqual({ outcome: "rejected", rejection: "ASSOCIATION_CONFLICT" });
    expect(await statusOf(b.purchaseId)).toBe("CONFIRMED");
    expect((await prisma.leadFeeDispute.findFirstOrThrow({ where: { providerDisputeId: "dp_shared" } })).leadPurchaseId).toBe(a.purchaseId);
  });

  it("a partial dispute (less than the payment) is accepted and still suspends", async () => {
    const base = await purchase();
    expect((await disputeWebhook().execute(disputeEvent(base, { amount: 5000 }))).outcome).toBe("recorded");
    expect((await prisma.leadFeeDispute.findFirstOrThrow()).amount.toFixed(2)).toBe("50.00");
    expect(await statusOf(base.purchaseId)).toBe("DISPUTED");
  });

  // ------------------------------------------------------------------------------------------------ concurrency

  it("concurrent events for one dispute (created + updated + closed won, shuffled) converge to ONE row, one terminal state, consistent audit", async () => {
    const base = await purchase();
    const events = [
      disputeEvent(base, { type: "charge.dispute.created" }),
      disputeEvent(base, { type: "charge.dispute.updated", status: "under_review" }),
      disputeEvent(base, { type: "charge.dispute.closed", status: "won" }),
    ];
    const results = await Promise.allSettled(events.map((e) => disputeWebhook().execute(e)));
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    expect(await prisma.leadFeeDispute.count()).toBe(1);
    expect((await prisma.leadFeeDispute.findFirstOrThrow()).status).toBe("WON");
    expect(await statusOf(base.purchaseId)).toBe("CONFIRMED");
    const dispute = await prisma.leadFeeDispute.findFirstOrThrow();
    const trail = await audit("LeadFeeDispute", dispute.id);
    expect(trail.length).toBeGreaterThanOrEqual(1);
    expect(trail.filter((a) => (a.metadata as { adminAction?: string })?.adminAction === "LEAD_FEE_DISPUTE_RECORDED")).toHaveLength(1);
  });

  it("the same event delivered twice at once is claimed once", async () => {
    const base = await purchase();
    const e = disputeEvent(base, { id: "evt_race_1" });
    const [x, y] = await Promise.all([disputeWebhook().execute(e), disputeWebhook().execute(e)]);
    expect([x.outcome, y.outcome].sort()).toEqual(["duplicate", "recorded"]);
    expect(await prisma.leadFeeDispute.count()).toBe(1);
  });

  it("access checks racing a suspension never see a half-applied state (every read is either granted or denied, never an error)", async () => {
    const base = await purchase();
    const reads = Array.from({ length: 12 }, () => getContact.execute(base.proUserId, base.leadId).then(() => "granted", (e: unknown) => (e instanceof LeadContactAccessDeniedError ? "denied" : "ERROR")));
    const write = disputeWebhook().execute(disputeEvent(base));
    const outcomes = await Promise.all([...reads, write.then(() => "written")]);
    expect(outcomes.filter((o) => o === "ERROR")).toHaveLength(0);
    await denied(getContact.execute(base.proUserId, base.leadId));
  });

  // ------------------------------------------------------------------------------------------------ atomicity / audit

  it("a failing audit insert rolls the WHOLE event back (dispute row, purchase status, revocation) and the redelivery succeeds", async () => {
    const base = await purchase();
    // A REAL database failure of the audit INSERT (not a mock): a temporary trigger rejects audit rows about disputes.
    await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION m155_test_fail_audit() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'audit store unavailable (m155 test)'; END; $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER m155_test_fail_audit BEFORE INSERT ON "audit_logs" FOR EACH ROW WHEN (NEW."entityType" = 'LeadFeeDispute') EXECUTE FUNCTION m155_test_fail_audit()`);
    try {
      await expect(disputeWebhook().execute(disputeEvent(base, { id: "evt_audit_fail" }))).rejects.toThrow();
      expect(await prisma.leadFeeDispute.count()).toBe(0);
      expect(await statusOf(base.purchaseId)).toBe("CONFIRMED");
      await expect(getContact.execute(base.proUserId, base.leadId)).resolves.toMatchObject({ leadId: base.leadId });
      expect((await prisma.externalWebhookEvent.findFirstOrThrow({ where: { externalEventId: "evt_audit_fail" } })).status).toBe("FAILED");
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS m155_test_fail_audit ON "audit_logs"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS m155_test_fail_audit()`);
    }
    // The provider redelivers the SAME event id: the FAILED claim is re-claimable and now succeeds.
    expect((await disputeWebhook().execute(disputeEvent(base, { id: "evt_audit_fail" }))).outcome).toBe("recorded");
    expect(await statusOf(base.purchaseId)).toBe("DISPUTED");
    expect(await prisma.leadFeeDispute.count()).toBe(1);
  });

  // ------------------------------------------------------------------------------------------------ DB invariants

  it("the partial unique index now covers DISPUTED: no second purchase of the same lead while one is disputed", async () => {
    const base = await purchase();
    await disputeWebhook().execute(disputeEvent(base));
    expect(await statusOf(base.purchaseId)).toBe("DISPUTED");
    const err = await purchases.initiate({ leadId: base.leadId, professionalProfileId: base.profileId }).then(() => null, (e: unknown) => e);
    expect(err).not.toBeNull();
  });

  it("DB trigger: a purchase cannot be created as DISPUTED, and cannot become DISPUTED without an open dispute", async () => {
    const base = await purchase();
    const msg = await sqlError(prisma.$executeRaw`UPDATE "lead_purchases" SET "status" = 'DISPUTED' WHERE "id" = ${base.purchaseId}::uuid`);
    expect(msg).toMatch(/open dispute/);
    const create = await sqlError(
      prisma.$executeRaw`INSERT INTO "lead_purchases" ("id","leadId","professionalProfileId","status","price","currency","financialSnapshot","updatedAt")
        SELECT gen_random_uuid(), "leadId", "professionalProfileId", 'DISPUTED', "price", "currency", "financialSnapshot", now() FROM "lead_purchases" WHERE "id" = ${base.purchaseId}::uuid`,
    );
    expect(create.length).toBeGreaterThan(0);
    expect(await statusOf(base.purchaseId)).toBe("CONFIRMED");
  });

  it("DB trigger: DISPUTED cannot return to CONFIRMED while a dispute is open or lost", async () => {
    const base = await purchase();
    await disputeWebhook().execute(disputeEvent(base));
    expect(await sqlError(prisma.$executeRaw`UPDATE "lead_purchases" SET "status" = 'CONFIRMED' WHERE "id" = ${base.purchaseId}::uuid`)).toMatch(/cannot return to CONFIRMED/);
    expect(await sqlError(prisma.$executeRaw`UPDATE "lead_purchases" SET "status" = 'FAILED' WHERE "id" = ${base.purchaseId}::uuid`)).toMatch(/DISPUTED lead purchase can only become/);
  });

  it("DB trigger: dispute rows are forward-only, identity/money columns immutable, closedAt write-once, never deleted", async () => {
    const base = await purchase();
    await disputeWebhook().execute(disputeEvent(base));
    const d = await prisma.leadFeeDispute.findFirstOrThrow();
    expect(await sqlError(prisma.$executeRaw`UPDATE "lead_fee_disputes" SET "amount" = 1.00 WHERE "id" = ${d.id}::uuid`)).toMatch(/immutable/);
    expect(await sqlError(prisma.$executeRaw`UPDATE "lead_fee_disputes" SET "paymentReference" = 'pi_x' WHERE "id" = ${d.id}::uuid`)).toMatch(/immutable/);
    expect(await sqlError(prisma.$executeRaw`DELETE FROM "lead_fee_disputes" WHERE "id" = ${d.id}::uuid`)).toMatch(/never deleted/);
    await disputeWebhook().execute(disputeEvent(base, { type: "charge.dispute.closed", status: "lost" }));
    expect(await sqlError(prisma.$executeRaw`UPDATE "lead_fee_disputes" SET "status" = 'NEEDS_RESPONSE' WHERE "id" = ${d.id}::uuid`)).toMatch(/illegal status transition/);
    expect(await sqlError(prisma.$executeRaw`UPDATE "lead_fee_disputes" SET "status" = 'WON' WHERE "id" = ${d.id}::uuid`)).toMatch(/illegal status transition/);
  });

  it("DB trigger: a dispute row must match its purchase (payment reference / currency / amount ceiling)", async () => {
    const base = await purchase();
    const insert = (ref: string, amount: string, id: string) =>
      prisma.$executeRawUnsafe(
        `INSERT INTO "lead_fee_disputes" ("id","providerDisputeId","leadPurchaseId","paymentReference","providerChargeId","status","amount","currency","openedAt","lastProviderEventId","lastProviderEventAt","updatedAt")
         VALUES (gen_random_uuid(), '${id}', '${base.purchaseId}'::uuid, '${ref}', 'ch_x', 'NEEDS_RESPONSE', ${amount}, 'EUR', now(), 'evt_x', now(), now())`,
      );
    expect(await sqlError(insert("pi_wrong", "10.00", "dp_a"))).toMatch(/does not match the purchase snapshot/);
    expect(await sqlError(insert(base.reference, "121.01", "dp_b"))).toMatch(/does not match the purchase snapshot/);
    expect(await prisma.leadFeeDispute.count()).toBe(0);
  });

  it("DB trigger: revocation rows are append-only and require a REVOKED purchase (and a LOST dispute for DISPUTE_LOST)", async () => {
    const base = await purchase();
    const ins = (source: string) =>
      prisma.$executeRawUnsafe(
        `INSERT INTO "lead_purchase_revocations" ("id","leadPurchaseId","source","explanation","evidenceReference") VALUES (gen_random_uuid(), '${base.purchaseId}'::uuid, '${source}', 'x', 'REF')`,
      );
    expect(await sqlError(ins("ADMIN"))).toMatch(/requires a REVOKED purchase/);
    await revocations.revokeConfirmed({ leadPurchaseId: base.purchaseId, actorUserId: base.adminId, explanation: "Verified abuse", evidenceReference: "CASE-1", now: new Date() });
    const rev = await prisma.leadPurchaseRevocation.findFirstOrThrow();
    expect(await sqlError(prisma.$executeRaw`UPDATE "lead_purchase_revocations" SET "explanation" = 'changed' WHERE "id" = ${rev.id}::uuid`)).toMatch(/append-only/);
    expect(await sqlError(prisma.$executeRaw`DELETE FROM "lead_purchase_revocations" WHERE "id" = ${rev.id}::uuid`)).toMatch(/append-only/);
    expect(await sqlError(ins("DISPUTE_LOST"))).toMatch(/LOST dispute|unique|duplicate/i);
  });

  // ------------------------------------------------------------------------------------------------ admin revoke

  const admins = (roles: string[] = ["ADMIN"]) => ({
    getUserById: async (id: string) => ({ id, name: null, email: null, phone: null, status: "ACTIVE" as const, roles, hasProfessionalProfile: false, lastLoginAt: null, createdAt: new Date() }),
  });
  const revoke = () => new RevokeLeadPurchaseUseCase(purchases, revocations, admins(), () => new Date());

  it("admin revoke: CONFIRMED -> REVOKED, access denied, revocation + audit written, idempotent repeat, no money row", async () => {
    const base = await purchase();
    const before = await moneySnapshot();
    const input = { actorUserId: base.adminId, leadPurchaseId: base.purchaseId, explanation: "Verified policy violation by the professional", evidenceReference: "CASE-77" };
    expect(await revoke().execute(input)).toEqual({ leadPurchaseId: base.purchaseId, status: "REVOKED", revoked: true });
    await denied(getContact.execute(base.proUserId, base.leadId));
    const rev = await prisma.leadPurchaseRevocation.findFirstOrThrow();
    expect(rev).toMatchObject({ source: "ADMIN", actorUserId: base.adminId, evidenceReference: "CASE-77", leadFeeDisputeId: null });
    expect(rev.explanation).toBe(input.explanation);
    const trail = await audit("LeadPurchase", base.purchaseId);
    expect(trail).toHaveLength(1);
    expect(JSON.stringify(trail[0]!.metadata)).not.toContain(input.explanation); // the free text never reaches the audit log

    expect(await revoke().execute(input)).toEqual({ leadPurchaseId: base.purchaseId, status: "REVOKED", revoked: false });
    expect(await prisma.leadPurchaseRevocation.count()).toBe(1);
    expect(await audit("LeadPurchase", base.purchaseId)).toHaveLength(1);
    expect(await moneySnapshot()).toEqual(before);
  });

  it("admin revoke: concurrent calls produce exactly one revocation and one audit entry", async () => {
    const base = await purchase();
    const input = { actorUserId: base.adminId, leadPurchaseId: base.purchaseId, explanation: "Verified policy violation by the professional", evidenceReference: "CASE-78" };
    const results = await Promise.all([revoke().execute(input), revoke().execute(input), revoke().execute(input)]);
    expect(results.filter((r) => r.revoked)).toHaveLength(1);
    expect(await prisma.leadPurchaseRevocation.count()).toBe(1);
    expect(await audit("LeadPurchase", base.purchaseId)).toHaveLength(1);
  });

  it("admin revoke is rejected for a DISPUTED purchase and for an unauthorized actor, writing nothing", async () => {
    const base = await purchase();
    await disputeWebhook().execute(disputeEvent(base));
    const input = { actorUserId: base.adminId, leadPurchaseId: base.purchaseId, explanation: "Verified policy violation by the professional", evidenceReference: "CASE-79" };
    await expect(revoke().execute(input)).rejects.toMatchObject({ reason: "PURCHASE_NOT_CONFIRMED" });
    const customerOnly = new RevokeLeadPurchaseUseCase(purchases, revocations, admins(["CUSTOMER"]), () => new Date());
    await expect(customerOnly.execute(input)).rejects.toMatchObject({ reason: "ACTOR_NOT_AUTHORIZED" });
    expect(await prisma.leadPurchaseRevocation.count()).toBe(0);
    expect(await statusOf(base.purchaseId)).toBe("DISPUTED");
  });

  // ------------------------------------------------------------------------------------------------ evidence

  function evidenceGateway(): LeadFeeDisputeGateway & { sent: unknown[] } {
    const sent: unknown[] = [];
    return {
      sent,
      retrieveDispute: async (id: string) => ({ providerDisputeId: id, paymentReference: "", rawStatus: "needs_response", amountMinorUnits: 12100, currency: "eur", evidenceDueBy: null, pastDue: false, evidenceSubmissionCount: sent.length }),
      submitEvidence: async (input: unknown) => void sent.push(input),
    } as never;
  }

  it("evidence: blocked while the switch is off; with it on, claim -> provider -> SUBMITTED, once, with audit and no text in the audit entry", async () => {
    const base = await purchase();
    await disputeWebhook().execute(disputeEvent(base));
    const d = await prisma.leadFeeDispute.findFirstOrThrow();
    const gateway = evidenceGateway();
    (gateway as { retrieveDispute: unknown }).retrieveDispute = async (id: string) => ({ providerDisputeId: id, paymentReference: base.reference, rawStatus: "needs_response", amountMinorUnits: 12100, currency: "eur", evidenceDueBy: null, pastDue: false, evidenceSubmissionCount: gateway.sent.length });
    const make = (enabled: boolean) => new SubmitLeadFeeDisputeEvidenceUseCase(disputes, gateway, admins(), () => ({ status: "VALID", submissionEnabled: enabled }));
    const input = { actorUserId: base.adminId, disputeId: d.id, evidenceText: "Service delivered after verified payment.", evidenceReference: "CASE-5" };

    await expect(make(false).execute(input)).rejects.toMatchObject({ reason: "SWITCH_DISABLED" });
    expect(gateway.sent).toHaveLength(0);
    expect((await prisma.leadFeeDispute.findUniqueOrThrow({ where: { id: d.id } })).evidenceStatus).toBe("NOT_SUBMITTED");

    expect((await make(true).execute(input)).evidenceStatus).toBe("SUBMITTED");
    expect(gateway.sent).toHaveLength(1);
    expect(gateway.sent[0]).toMatchObject({ providerDisputeId: "dp_m155_1", idempotencyKey: `lead-fee-dispute-evidence:${d.id}` });
    expect((await make(true).execute(input)).evidenceStatus).toBe("SUBMITTED");
    expect(gateway.sent).toHaveLength(1);
    const trail = await audit("LeadFeeDispute", d.id);
    expect(JSON.stringify(trail.map((a) => a.metadata))).not.toContain("Service delivered");
    expect(await sqlError(prisma.$executeRaw`UPDATE "lead_fee_disputes" SET "evidenceText" = 'tampered' WHERE "id" = ${d.id}::uuid`)).toMatch(/evidence/);
  });

  // ------------------------------------------------------------------------------------------------ regression

  it("M153 regression: a DISPUTED purchase cannot be refunded (the M153 trigger requires CONFIRMED); an unrelated CONFIRMED purchase is unaffected", async () => {
    const disputed = await purchase();
    const other = await purchase();
    await disputeWebhook().execute(disputeEvent(disputed));
    const msg = await sqlError(
      prisma.$executeRawUnsafe(
        `INSERT INTO "lead_fee_refunds" ("id","leadPurchaseId","reasonCode","attemptNumber","status","amount","currency","refundedPaymentReference","purchasePaymentReference","idempotencyKey","actorUserId","explanation","evidenceReference","updatedAt")
         VALUES (gen_random_uuid(),'${disputed.purchaseId}'::uuid,'PLATFORM_ERROR',1,'REQUESTED',121.00,'EUR','${disputed.reference}','${disputed.reference}','k-${disputed.reference}','${disputed.adminId}'::uuid,'x','E',now())`,
      ),
    );
    expect(msg.length).toBeGreaterThan(0);
    expect(await prisma.leadFeeRefund.count()).toBe(0);
    expect(await statusOf(other.purchaseId)).toBe("CONFIRMED");
    await expect(getContact.execute(other.proUserId, other.leadId)).resolves.toMatchObject({ leadId: other.leadId });
  });

  // ------------------------------------------------------------------------------------------------ H1: refund / dispute concurrency

  describe("H1 — a platform-error refund and a dispute never restore contact access", () => {
    const refunds = new PrismaLeadFeeRefundRepository();
    type Base = Awaited<ReturnType<typeof purchase>>;
    const refundDraft = (base: Base, patch: Record<string, unknown> = {}) => ({
      leadPurchaseId: base.purchaseId,
      reasonCode: "PLATFORM_ERROR" as const,
      attemptNumber: 1,
      status: "REQUESTED" as const,
      amount: "121.00",
      currency: "EUR",
      refundedPaymentReference: base.reference,
      purchasePaymentReference: base.reference,
      idempotencyKey: `lead-fee-refund:${base.reference}:1`,
      actorUserId: base.adminId,
      explanation: "Verified platform defect.",
      evidenceReference: "INC-155",
      ...patch,
    });
    const closed = (base: Base, status: string) => disputeEvent(base, { type: "charge.dispute.closed", status, disputeId: `dp_${base.reference}` });
    const settle = async (id: string, path: Array<{ from: string[]; to: string }>) => {
      for (const step of path) await refunds.updateStatus(id, { from: step.from as never, to: step.to as never, ...(step.to === "SUCCEEDED" || step.to === "PROVIDER_PENDING" ? { providerRefundId: `re_${id.slice(0, 8)}` } : {}), ...(step.to === "FAILED" ? { failureCategory: "INVALID_REQUEST" as never } : {}) });
    };
    const refundSuccessPaths: Record<string, Array<{ from: string[]; to: string }>> = {
      "REQUESTED->SUCCEEDED": [{ from: ["REQUESTED"], to: "SUCCEEDED" }],
      "REQUESTED->PROVIDER_PENDING->SUCCEEDED": [{ from: ["REQUESTED"], to: "PROVIDER_PENDING" }, { from: ["PROVIDER_PENDING"], to: "SUCCEEDED" }],
      "REQUESTED->UNKNOWN->SUCCEEDED": [{ from: ["REQUESTED"], to: "UNKNOWN" }, { from: ["UNKNOWN"], to: "SUCCEEDED" }],
    };

    it.each(["won", "warning_closed"])("refund SUCCEEDED before the dispute resolves (%s): the purchase converges to REFUNDED, never CONFIRMED; access stays denied; no revocation", async (outcome) => {
      const base = await purchase();
      const refund = await refunds.createAttempt(refundDraft(base));
      await settle(refund.id, refundSuccessPaths["REQUESTED->SUCCEEDED"]!);
      // M153's completeSucceeded has not run: the purchase is still CONFIRMED when the dispute opens (the exact H1 precondition).
      expect(await statusOf(base.purchaseId)).toBe("CONFIRMED");
      await disputeWebhook().execute(disputeEvent(base, { disputeId: `dp_${base.reference}` }));
      expect(await statusOf(base.purchaseId)).toBe("DISPUTED");

      const result = await disputeWebhook().execute(closed(base, outcome));
      expect(result).toMatchObject({ outcome: "status-updated", purchaseEffect: "REFUND" });
      const p = await prisma.leadPurchase.findUniqueOrThrow({ where: { id: base.purchaseId } });
      expect(p.status).toBe("REFUNDED");
      expect(p.refundedAt).not.toBeNull();
      expect(p.revokedAt).toBeNull();
      await denied(getContact.execute(base.proUserId, base.leadId));
      expect(await prisma.leadPurchaseRevocation.count({ where: { leadPurchaseId: base.purchaseId } })).toBe(0);
      const trail = await audit("LeadPurchase", base.purchaseId);
      expect(JSON.stringify(trail)).toMatch(/LEAD_PURCHASE_REFUND_CONVERGED/);
    });

    it.each(["REQUESTED", "PROVIDER_PENDING", "UNKNOWN"] as const)("refund %s (in flight / uncertain) + dispute WON: the purchase stays DISPUTED, access denied, and a direct SQL restore is refused", async (state) => {
      const base = await purchase();
      const refund = await refunds.createAttempt(refundDraft(base));
      if (state === "PROVIDER_PENDING") await settle(refund.id, [{ from: ["REQUESTED"], to: "PROVIDER_PENDING" }]);
      if (state === "UNKNOWN") await settle(refund.id, [{ from: ["REQUESTED"], to: "UNKNOWN" }]);
      await disputeWebhook().execute(disputeEvent(base, { disputeId: `dp_${base.reference}` }));
      const result = await disputeWebhook().execute(closed(base, "won"));
      expect(result).toMatchObject({ outcome: "status-updated", purchaseEffect: "NONE" });
      expect(await statusOf(base.purchaseId)).toBe("DISPUTED");
      await denied(getContact.execute(base.proUserId, base.leadId));

      const message = await sqlError(prisma.$executeRaw`UPDATE "lead_purchases" SET "status" = 'CONFIRMED' WHERE "id" = ${base.purchaseId}::uuid`);
      expect(message).toMatch(/platform-error refund is in flight or succeeded/);
      expect(await statusOf(base.purchaseId)).toBe("DISPUTED");

      // The refund finishes later; any later converge (a replay under a NEW event id) reaches REFUNDED, still never CONFIRMED.
      await settle(refund.id, state === "REQUESTED" ? refundSuccessPaths["REQUESTED->SUCCEEDED"]! : state === "PROVIDER_PENDING" ? [{ from: ["PROVIDER_PENDING"], to: "SUCCEEDED" }] : [{ from: ["UNKNOWN"], to: "SUCCEEDED" }]);
      expect(await statusOf(base.purchaseId)).toBe("DISPUTED");
      await disputeWebhook().execute(closed(base, "won"));
      expect(await statusOf(base.purchaseId)).toBe("REFUNDED");
      await denied(getContact.execute(base.proUserId, base.leadId));
    });

    it("a FAILED refund is irrelevant: a won dispute still restores CONFIRMED and access (normal path preserved)", async () => {
      const base = await purchase();
      const refund = await refunds.createAttempt(refundDraft(base));
      await settle(refund.id, [{ from: ["REQUESTED"], to: "FAILED" }]);
      await disputeWebhook().execute(disputeEvent(base, { disputeId: `dp_${base.reference}` }));
      expect(await disputeWebhook().execute(closed(base, "won"))).toMatchObject({ purchaseEffect: "RESTORE" });
      expect(await statusOf(base.purchaseId)).toBe("CONFIRMED");
      await expect(getContact.execute(base.proUserId, base.leadId)).resolves.toMatchObject({ leadId: base.leadId });
    });

    it("a DUPLICATE_CHARGE refund is not a PLATFORM_ERROR refund and does not block the normal restore", async () => {
      const base = await purchase();
      const dupReference = `${base.reference}_dup`;
      await refunds.createAttempt(refundDraft(base, { reasonCode: "DUPLICATE_CHARGE", refundedPaymentReference: dupReference, idempotencyKey: `lead-fee-refund:${dupReference}:1` }));
      await disputeWebhook().execute(disputeEvent(base, { disputeId: `dp_${base.reference}` }));
      expect(await disputeWebhook().execute(closed(base, "won"))).toMatchObject({ purchaseEffect: "RESTORE" });
      expect(await statusOf(base.purchaseId)).toBe("CONFIRMED");
    });

    it("a LOST dispute with a SUCCEEDED refund still revokes (access denied); the refund row is untouched", async () => {
      const base = await purchase();
      const refund = await refunds.createAttempt(refundDraft(base));
      await settle(refund.id, refundSuccessPaths["REQUESTED->SUCCEEDED"]!);
      await disputeWebhook().execute(disputeEvent(base, { disputeId: `dp_${base.reference}` }));
      expect(await disputeWebhook().execute(closed(base, "lost"))).toMatchObject({ purchaseEffect: "REVOKE" });
      expect(await statusOf(base.purchaseId)).toBe("REVOKED");
      expect((await prisma.leadFeeRefund.findUniqueOrThrow({ where: { id: refund.id } })).status).toBe("SUCCEEDED");
      await denied(getContact.execute(base.proUserId, base.leadId));
    });

    it("the M155 path only READS refunds: normal dispute handling creates / changes no refund row", async () => {
      const base = await purchase();
      const before = await prisma.leadFeeRefund.count();
      await disputeWebhook().execute(disputeEvent(base, { disputeId: `dp_${base.reference}` }));
      await disputeWebhook().execute(closed(base, "won"));
      expect(await prisma.leadFeeRefund.count()).toBe(before);
    });

    it.each(Object.keys(refundSuccessPaths))("RACE: dispute closed-won vs refund %s, repeated: no interleaving ever leaves the purchase CONFIRMED with a succeeded refund", async (pathName) => {
      for (let round = 0; round < 4; round += 1) {
        const base = await purchase();
        const refund = await refunds.createAttempt(refundDraft(base));
        const path = refundSuccessPaths[pathName]!;
        await disputeWebhook().execute(disputeEvent(base, { disputeId: `dp_${base.reference}` }));
        const steps = path.slice(0, -1);
        await settle(refund.id, steps); // reach the state just before SUCCEEDED
        const last = path[path.length - 1]!;
        await Promise.all([
          disputeWebhook().execute(closed(base, "won")),
          refunds.updateStatus(refund.id, { from: last.from as never, to: "SUCCEEDED", providerRefundId: `re_${refund.id.slice(0, 8)}` }),
        ]);
        // whatever the interleaving, the refund is SUCCEEDED, so the purchase is never CONFIRMED / accessible
        expect((await prisma.leadFeeRefund.findUniqueOrThrow({ where: { id: refund.id } })).status).toBe("SUCCEEDED");
        expect(["DISPUTED", "REFUNDED"]).toContain(await statusOf(base.purchaseId));
        await denied(getContact.execute(base.proUserId, base.leadId));
        // a later converge settles on REFUNDED
        await disputeWebhook().execute(closed(base, "won"));
        expect(await statusOf(base.purchaseId)).toBe("REFUNDED");
      }
    });

    it("RACE: dispute opening vs a refund attempt: either the attempt is refused (purchase no longer CONFIRMED) or it exists and the purchase still ends DISPUTED; access never survives", async () => {
      for (let round = 0; round < 6; round += 1) {
        const base = await purchase();
        const [dispute, attempt] = await Promise.allSettled([
          disputeWebhook().execute(disputeEvent(base, { disputeId: `dp_${base.reference}` })),
          refunds.createAttempt(refundDraft(base)),
        ]);
        expect(dispute.status).toBe("fulfilled");
        expect(await statusOf(base.purchaseId)).toBe("DISPUTED");
        const rows = await prisma.leadFeeRefund.count({ where: { leadPurchaseId: base.purchaseId } });
        expect(rows).toBe(attempt.status === "fulfilled" ? 1 : 0);
        if (attempt.status === "rejected") expect(String((attempt.reason as Error).message)).toMatch(/does not match a CONFIRMED purchase/);
        await denied(getContact.execute(base.proUserId, base.leadId));
        // closing the dispute in our favour restores access only when no refund row exists
        await disputeWebhook().execute(closed(base, "won"));
        expect(await statusOf(base.purchaseId)).toBe(rows === 0 ? "CONFIRMED" : "DISPUTED");
      }
    });

    it("replay / idempotency / audit stay intact with a refund present: a duplicate event id is a replay with no second transition or audit entry", async () => {
      const base = await purchase();
      const refund = await refunds.createAttempt(refundDraft(base));
      await settle(refund.id, refundSuccessPaths["REQUESTED->SUCCEEDED"]!);
      await disputeWebhook().execute(disputeEvent(base, { disputeId: `dp_${base.reference}` }));
      const event = closed(base, "won");
      await disputeWebhook().execute(event);
      const trail = (await audit("LeadPurchase", base.purchaseId)).length;
      expect((await disputeWebhook().execute(event)).outcome).toBe("duplicate");
      expect(await statusOf(base.purchaseId)).toBe("REFUNDED");
      expect((await audit("LeadPurchase", base.purchaseId)).length).toBe(trail);
    });
  });
});
