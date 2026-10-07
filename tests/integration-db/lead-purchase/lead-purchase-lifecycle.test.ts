/**
 * Module 126 — LeadPurchase lifecycle against REAL PostgreSQL.
 *
 * Proves what mocks cannot: the lead-row lock + maxBuyers count, the partial
 * unique index under concurrency, status-conditional transitions, and that
 * Module 122's policy grants contact only for a CONFIRMED purchase.
 */
import { describe, expect, it } from "vitest";

import { prisma } from "@/infrastructure/database/prisma/client";
import { PrismaLeadContactAuthorizationReader } from "@/infrastructure/database/prisma/repositories/prisma-lead-contact-access-repository";
import { PrismaLeadPurchaseRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-purchase-repository";
import { PrismaLeadRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-repository";
import { PrismaServiceRequestRepository } from "@/infrastructure/database/prisma/repositories/prisma-service-request-repository";
import { ConfirmLeadPurchaseUseCase } from "@/application/use-cases/lead-purchase/confirm-lead-purchase.use-case";
import { TransitionLeadPurchaseUseCase } from "@/application/use-cases/lead-purchase/transition-lead-purchase.use-case";
import {
  DuplicateActiveLeadPurchaseError,
  InvalidLeadPurchaseTransitionError,
  LeadBuyerLimitReachedError,
  LeadNotPurchasableError,
} from "@/domain/services/lead-purchase";
import { canProfessionalAccessLeadContact } from "@/domain/services/lead-contact-access-policy";

import { SNAPSHOT_DATA } from "../../test-utils/lead-publication-fixtures";
import { setupDbTestLifecycle } from "../../test-utils/db/db-test-lifecycle";
import {
  createAddress,
  createCustomerProfile,
  createProfessionalProfile,
  createServiceCategory,
  createServiceRequest,
  createUser,
} from "../../test-utils/db/seed-helpers";

describe("Module 126 — LeadPurchase lifecycle (real PostgreSQL)", () => {
  setupDbTestLifecycle();

  const leads = new PrismaLeadRepository();
  const purchases = new PrismaLeadPurchaseRepository();
  const serviceRequests = new PrismaServiceRequestRepository();

  async function publishedLead(maxBuyers: number | null = null) {
    const customerUser = await createUser(prisma, { name: "Customer" });
    const address = await createAddress(prisma, customerUser.id);
    const customer = await createCustomerProfile(prisma, customerUser.id);
    const category = await createServiceCategory(prisma);
    const request = await createServiceRequest(prisma, { customerId: customer.id, categoryId: category.id, addressId: address.id });
    await prisma.serviceRequest.update({ where: { id: request.id }, data: { flowVersion: "LEAD_V1" } });
    const draft = await leads.create({ serviceRequestId: request.id, maxBuyers });
    // Module 133: a Lead is only ever published WITH a snapshot (incl. a buyer policy), so `null` here means "effectively uncapped" (100), not NULL maxBuyers.
    const lead = await leads.publish(draft.id, { ...SNAPSHOT_DATA, maxBuyers: maxBuyers ?? 100 });
    return { lead: lead!, request };
  }

  async function professional() {
    const user = await createUser(prisma, { name: "Pro" });
    return createProfessionalProfile(prisma, user.id);
  }

  /** The Module 122 decision fed by the real Module 138 adapter (facts from the DB). */
  async function contactDecision(leadId: string, professionalProfileId: string) {
    const facts = await new PrismaLeadContactAuthorizationReader().findFacts(leadId, professionalProfileId);
    return canProfessionalAccessLeadContact(facts, professionalProfileId);
  }

  const confirmUc = () => new ConfirmLeadPurchaseUseCase(purchases, leads, serviceRequests);
  const transitionUc = () => new TransitionLeadPurchaseUseCase(purchases);

  it("initiate -> PENDING_PAYMENT (no contact) -> confirm -> CONFIRMED (contact allowed by Module 122) -> revoke -> denied", async () => {
    const { lead } = await publishedLead();
    const pro = await professional();

    const pending = await purchases.initiate({ leadId: lead.id, professionalProfileId: pro.id });
    expect(pending.status).toBe("PENDING_PAYMENT");
    expect(pending.confirmedAt).toBeNull();
    expect(await contactDecision(lead.id, pro.id)).toMatchObject({ allowed: false });

    const confirmed = await confirmUc().execute(pending.id);
    expect(confirmed.status).toBe("CONFIRMED");
    expect(confirmed.confirmedAt).toBeInstanceOf(Date);
    expect(await contactDecision(lead.id, pro.id)).toEqual({ allowed: true });

    const revoked = await transitionUc().execute(pending.id, "REVOKED");
    expect(revoked.status).toBe("REVOKED");
    expect(await contactDecision(lead.id, pro.id)).toMatchObject({ allowed: false });
  });

  it.each(["FAILED", "CANCELLED"] as const)("PENDING_PAYMENT -> %s: no contact, cannot be confirmed afterwards", async (terminal) => {
    const { lead } = await publishedLead();
    const pro = await professional();
    const p = await purchases.initiate({ leadId: lead.id, professionalProfileId: pro.id });
    await transitionUc().execute(p.id, terminal);
    expect(await contactDecision(lead.id, pro.id)).toMatchObject({ allowed: false });
    await expect(confirmUc().execute(p.id)).rejects.toBeInstanceOf(InvalidLeadPurchaseTransitionError);
    expect((await purchases.findById(p.id))!.status).toBe(terminal);
  });

  it("CONFIRMED -> REFUNDED: no contact, stamps refundedAt, cannot be re-confirmed", async () => {
    const { lead } = await publishedLead();
    const pro = await professional();
    const p = await purchases.initiate({ leadId: lead.id, professionalProfileId: pro.id });
    await confirmUc().execute(p.id);
    await transitionUc().execute(p.id, "REFUNDED");
    const row = (await purchases.findById(p.id))!;
    expect(row.status).toBe("REFUNDED");
    expect(row.refundedAt).toBeInstanceOf(Date);
    expect(await contactDecision(lead.id, pro.id)).toMatchObject({ allowed: false });
    await expect(confirmUc().execute(p.id)).rejects.toBeInstanceOf(InvalidLeadPurchaseTransitionError);
  });

  it("confirm is idempotent: second call keeps the same confirmedAt and one row", async () => {
    const { lead } = await publishedLead();
    const pro = await professional();
    const p = await purchases.initiate({ leadId: lead.id, professionalProfileId: pro.id });
    const first = await confirmUc().execute(p.id);
    await new Promise((r) => setTimeout(r, 20));
    const second = await confirmUc().execute(p.id);
    expect(second.confirmedAt).toEqual(first.confirmedAt);
    expect(await prisma.leadPurchase.count({ where: { leadId: lead.id } })).toBe(1);
  });

  it("duplicate race: concurrent initiations by the same professional create exactly one active purchase", async () => {
    const { lead } = await publishedLead();
    const pro = await professional();
    const outcomes = await Promise.allSettled(
      Array.from({ length: 6 }, () => purchases.initiate({ leadId: lead.id, professionalProfileId: pro.id })),
    );
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    for (const o of outcomes) if (o.status === "rejected") expect(o.reason).toBeInstanceOf(DuplicateActiveLeadPurchaseError);
    expect(await prisma.leadPurchase.count({ where: { leadId: lead.id, status: { in: ["PENDING_PAYMENT", "CONFIRMED"] } } })).toBe(1);
  });

  it("maxBuyers race: concurrent purchases by different professionals never exceed the limit", async () => {
    const { lead } = await publishedLead(2);
    const pros = await Promise.all(Array.from({ length: 6 }, () => professional()));
    const outcomes = await Promise.allSettled(pros.map((p) => purchases.initiate({ leadId: lead.id, professionalProfileId: p.id })));
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(2);
    for (const o of outcomes) if (o.status === "rejected") expect(o.reason).toBeInstanceOf(LeadBuyerLimitReachedError);
    expect(await prisma.leadPurchase.count({ where: { leadId: lead.id, status: { in: ["PENDING_PAYMENT", "CONFIRMED"] } } })).toBe(2);
  });

  it("maxBuyers: a FAILED/CANCELLED purchase frees a slot; an uncapped (100) lead is not limited", async () => {
    const { lead } = await publishedLead(1);
    const [a, b] = await Promise.all([professional(), professional()]);
    const first = await purchases.initiate({ leadId: lead.id, professionalProfileId: a.id });
    await expect(purchases.initiate({ leadId: lead.id, professionalProfileId: b.id })).rejects.toBeInstanceOf(LeadBuyerLimitReachedError);
    await transitionUc().execute(first.id, "CANCELLED");
    await expect(purchases.initiate({ leadId: lead.id, professionalProfileId: b.id })).resolves.toMatchObject({ status: "PENDING_PAYMENT" });

    const open = await publishedLead(null);
    const many = await Promise.all(Array.from({ length: 4 }, () => professional()));
    await Promise.all(many.map((p) => purchases.initiate({ leadId: open.lead.id, professionalProfileId: p.id })));
    expect(await prisma.leadPurchase.count({ where: { leadId: open.lead.id } })).toBe(4);
  });

  it("confirmation race: concurrent confirmations transition once and all return CONFIRMED", async () => {
    const { lead } = await publishedLead();
    const pro = await professional();
    const p = await purchases.initiate({ leadId: lead.id, professionalProfileId: pro.id });
    const results = await Promise.all(Array.from({ length: 6 }, () => confirmUc().execute(p.id)));
    for (const r of results) expect(r.status).toBe("CONFIRMED");
    expect(new Set(results.map((r) => r.confirmedAt?.getTime())).size).toBe(1);
  });

  it("invalid-transition race: cancel vs confirm - exactly one wins and the terminal state never becomes CONFIRMED", async () => {
    const { lead } = await publishedLead();
    const pro = await professional();
    const p = await purchases.initiate({ leadId: lead.id, professionalProfileId: pro.id });
    const outcomes = await Promise.allSettled([confirmUc().execute(p.id), transitionUc().execute(p.id, "CANCELLED")]);
    const final = (await purchases.findById(p.id))!;
    expect(["CONFIRMED", "CANCELLED"]).toContain(final.status);
    expect(outcomes.filter((o) => o.status === "fulfilled").length).toBeGreaterThanOrEqual(1);
    if (final.status === "CANCELLED") expect(final.confirmedAt).toBeNull();
    // a terminal row can never be pushed back to CONFIRMED
    if (final.status === "CANCELLED") await expect(purchases.transition(p.id, "CANCELLED", "CONFIRMED", new Date())).rejects.toBeInstanceOf(InvalidLeadPurchaseTransitionError);
  });

  it("re-purchase is allowed after FAILED (partial index only covers active states) but not while active", async () => {
    const { lead } = await publishedLead();
    const pro = await professional();
    const a = await purchases.initiate({ leadId: lead.id, professionalProfileId: pro.id });
    await expect(purchases.initiate({ leadId: lead.id, professionalProfileId: pro.id })).rejects.toBeInstanceOf(DuplicateActiveLeadPurchaseError);
    await transitionUc().execute(a.id, "FAILED");
    const b = await purchases.initiate({ leadId: lead.id, professionalProfileId: pro.id });
    expect(b.id).not.toBe(a.id);
  });

  it("initiate refuses a lead that is not PUBLISHED (draft / closed), enforced inside the locked transaction", async () => {
    const { lead } = await publishedLead();
    const pro = await professional();
    await prisma.lead.update({ where: { id: lead.id }, data: { status: "CLOSED" } });
    await expect(purchases.initiate({ leadId: lead.id, professionalProfileId: pro.id })).rejects.toBeInstanceOf(LeadNotPurchasableError);
    expect(await prisma.leadPurchase.count()).toBe(0);
  });

  it("confirm refuses when the lead is no longer PUBLISHED (purchase stays PENDING_PAYMENT, no contact)", async () => {
    const { lead } = await publishedLead();
    const pro = await professional();
    const p = await purchases.initiate({ leadId: lead.id, professionalProfileId: pro.id });
    await prisma.lead.update({ where: { id: lead.id }, data: { status: "CANCELLED" } });
    await expect(confirmUc().execute(p.id)).rejects.toBeInstanceOf(LeadNotPurchasableError);
    expect((await purchases.findById(p.id))!.status).toBe("PENDING_PAYMENT");
    expect(await contactDecision(lead.id, pro.id)).toMatchObject({ allowed: false });
  });

  it("database constraints still hold: negative price rejected by CHECK, and creates no legacy financial rows", async () => {
    const { lead } = await publishedLead();
    const pro = await professional();
    await expect(prisma.$executeRawUnsafe(
      `INSERT INTO lead_purchases (id, "leadId", "professionalProfileId", status, price, currency, "updatedAt") VALUES (gen_random_uuid(), '${lead.id}', '${pro.id}', 'PENDING_PAYMENT', -1, 'EUR', now())`,
    )).rejects.toBeDefined();
    await purchases.initiate({ leadId: lead.id, professionalProfileId: pro.id });
    expect(await prisma.payment.count()).toBe(0);
    expect(await prisma.commission.count()).toBe(0);
    expect(await prisma.payout.count()).toBe(0);
  });
});
