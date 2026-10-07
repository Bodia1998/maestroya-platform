/**
 * Module 137 — LeadPurchase lifecycle v2 against REAL PostgreSQL.
 *
 * Proves: PENDING_PAYMENT -> CONFIRMED / FAILED / CANCELLED with auditable timestamps, the
 * competing-transition matrix (exactly one winner, never an impossible state), financial
 * immutability under every transition, and that the M123 partial unique index still decides
 * what is "active".
 */
import { describe, expect, it } from "vitest";

import { prisma } from "@/infrastructure/database/prisma/client";
import { PrismaLeadPurchaseRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-purchase-repository";
import { PrismaLeadRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-repository";
import { PrismaServiceRequestRepository } from "@/infrastructure/database/prisma/repositories/prisma-service-request-repository";
import { ConfirmLeadPurchaseUseCase } from "@/application/use-cases/lead-purchase/confirm-lead-purchase.use-case";
import { TransitionLeadPurchaseUseCase } from "@/application/use-cases/lead-purchase/transition-lead-purchase.use-case";
import { DuplicateActiveLeadPurchaseError, InvalidLeadPurchaseTransitionError } from "@/domain/services/lead-purchase";

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

describe("Module 137 — LeadPurchase lifecycle v2 (real PostgreSQL)", () => {
  setupDbTestLifecycle();

  const leads = new PrismaLeadRepository();
  const purchases = new PrismaLeadPurchaseRepository();
  const confirmUc = () => new ConfirmLeadPurchaseUseCase(purchases, leads, new PrismaServiceRequestRepository());
  const transitionUc = () => new TransitionLeadPurchaseUseCase(purchases);

  async function publishedLead(maxBuyers = 5) {
    const customerUser = await createUser(prisma, { name: "Customer" });
    const address = await createAddress(prisma, customerUser.id);
    const customer = await createCustomerProfile(prisma, customerUser.id);
    const category = await createServiceCategory(prisma);
    const request = await createServiceRequest(prisma, { customerId: customer.id, categoryId: category.id, addressId: address.id });
    await prisma.serviceRequest.update({ where: { id: request.id }, data: { flowVersion: "LEAD_V1" } });
    const draft = await leads.create({ serviceRequestId: request.id });
    return (await leads.publish(draft.id, { ...SNAPSHOT_DATA, maxBuyers }))!;
  }
  const professional = async () => createProfessionalProfile(prisma, (await createUser(prisma, { name: "Pro" })).id);

  async function pending() {
    const lead = await publishedLead();
    const pro = await professional();
    const purchase = await purchases.initiate({ leadId: lead.id, professionalProfileId: pro.id });
    return { lead, pro, purchase };
  }

  const raw = (id: string) => prisma.leadPurchase.findUniqueOrThrow({ where: { id } });
  const FINANCIAL = ["price", "currency", "taxAmount", "totalAmount", "taxPolicyVersion", "pricingConfigVersion", "pricingRuleVersion", "leadPublishedAt"] as const;
  const financialOf = (row: Awaited<ReturnType<typeof raw>>) => JSON.parse(JSON.stringify(Object.fromEntries(FINANCIAL.map((k) => [k, row[k]]))));

  describe("transitions and timestamps", () => {
    it("PENDING_PAYMENT -> CONFIRMED stamps confirmedAt only", async () => {
      const { purchase } = await pending();
      await confirmUc().execute(purchase.id);
      const row = await raw(purchase.id);
      expect(row.status).toBe("CONFIRMED");
      expect(row.confirmedAt).toBeInstanceOf(Date);
      expect([row.failedAt, row.cancelledAt, row.refundedAt, row.revokedAt]).toEqual([null, null, null, null]);
    });

    it("PENDING_PAYMENT -> FAILED stamps failedAt only; repeating does not move it", async () => {
      const { purchase } = await pending();
      const first = await transitionUc().execute(purchase.id, "FAILED");
      expect(first.failedAt).toBeInstanceOf(Date);
      await new Promise((r) => setTimeout(r, 20));
      const second = await transitionUc().execute(purchase.id, "FAILED");
      expect(second.failedAt).toEqual(first.failedAt);
      const row = await raw(purchase.id);
      expect([row.status, row.confirmedAt, row.cancelledAt]).toEqual(["FAILED", null, null]);
      expect(await prisma.leadPurchase.count()).toBe(1);
    });

    it("PENDING_PAYMENT -> CANCELLED stamps cancelledAt only; repeating does not move it", async () => {
      const { purchase } = await pending();
      const first = await transitionUc().execute(purchase.id, "CANCELLED");
      await new Promise((r) => setTimeout(r, 20));
      const second = await transitionUc().execute(purchase.id, "CANCELLED");
      expect(second.cancelledAt).toEqual(first.cancelledAt);
      const row = await raw(purchase.id);
      expect([row.status, row.confirmedAt, row.failedAt]).toEqual(["CANCELLED", null, null]);
    });

    it("repository.transition is conditional on the current status (stale event -> null, row unchanged)", async () => {
      const { purchase } = await pending();
      await purchases.transition(purchase.id, "PENDING_PAYMENT", "FAILED", new Date());
      expect(await purchases.transition(purchase.id, "PENDING_PAYMENT", "FAILED", new Date())).toBeNull();
      await expect(purchases.transition(purchase.id, "FAILED", "CONFIRMED", new Date())).rejects.toBeInstanceOf(InvalidLeadPurchaseTransitionError);
      expect((await raw(purchase.id)).status).toBe("FAILED");
    });

    it("CHECK constraints: a failure/cancel timestamp cannot exist on a purchase in another status", async () => {
      const { purchase } = await pending();
      await expect(prisma.$executeRawUnsafe(`UPDATE lead_purchases SET "failedAt" = now() WHERE id = '${purchase.id}'::uuid`)).rejects.toBeDefined();
      await expect(prisma.$executeRawUnsafe(`UPDATE lead_purchases SET "cancelledAt" = now(), status = 'FAILED' WHERE id = '${purchase.id}'::uuid`)).rejects.toBeDefined();
    });
  });

  describe("financial immutability", () => {
    it.each(["CONFIRMED", "FAILED", "CANCELLED"] as const)("PENDING_PAYMENT -> %s leaves every financial/provenance column untouched", async (target) => {
      const { purchase } = await pending();
      const before = financialOf(await raw(purchase.id));
      expect(before.taxAmount).not.toBeNull();
      expect(before.taxPolicyVersion).not.toBeNull();
      if (target === "CONFIRMED") await confirmUc().execute(purchase.id);
      else await transitionUc().execute(purchase.id, target);
      expect(financialOf(await raw(purchase.id))).toEqual(before);
    });

    it("the database refuses to alter the snapshot of a purchase in any lifecycle state", async () => {
      const { purchase } = await pending();
      await transitionUc().execute(purchase.id, "CANCELLED");
      for (const set of [`price = 1`, `"taxAmount" = 0`, `"totalAmount" = 1`, `"taxPolicyVersion" = 'x'`, `"pricingRuleVersion" = 'x'`]) {
        await expect(prisma.$executeRawUnsafe(`UPDATE lead_purchases SET ${set} WHERE id = '${purchase.id}'::uuid`)).rejects.toBeDefined();
      }
    });

    it("lifecycle transitions do not touch the Lead", async () => {
      const { lead, purchase } = await pending();
      const before = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
      await confirmUc().execute(purchase.id);
      const after = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
      expect(after).toEqual(before);
    });
  });

  describe("competing transitions on the same purchase", () => {
    const run = (ops: Array<() => Promise<unknown>>) => Promise.allSettled(ops.map((op) => op()));

    it("confirm vs confirm: one transition, every caller sees CONFIRMED, one confirmedAt", async () => {
      const { purchase } = await pending();
      const out = await run(Array.from({ length: 8 }, () => () => confirmUc().execute(purchase.id)));
      expect(out.every((o) => o.status === "fulfilled")).toBe(true);
      const row = await raw(purchase.id);
      expect(row.status).toBe("CONFIRMED");
      expect(new Set(out.map((o) => (o as PromiseFulfilledResult<{ confirmedAt: Date }>).value.confirmedAt.getTime())).size).toBe(1);
    });

    it.each([
      ["confirm vs fail", "FAILED"],
      ["confirm vs cancel", "CANCELLED"],
    ] as const)("%s: exactly one valid terminal outcome", async (_n, other) => {
      for (let i = 0; i < 5; i++) {
        const { purchase } = await pending();
        const out = await run([() => confirmUc().execute(purchase.id), () => transitionUc().execute(purchase.id, other)]);
        const row = await raw(purchase.id);
        expect(["CONFIRMED", other]).toContain(row.status);
        // exactly one side succeeded, the loser was rejected with the domain error
        expect(out.filter((o) => o.status === "fulfilled")).toHaveLength(1);
        const loser = out.find((o) => o.status === "rejected") as PromiseRejectedResult;
        expect(loser.reason).toBeInstanceOf(InvalidLeadPurchaseTransitionError);
        // timestamps are consistent with the winning status and never mixed
        if (row.status === "CONFIRMED") expect([row.confirmedAt !== null, row.failedAt, row.cancelledAt]).toEqual([true, null, null]);
        else expect(row.confirmedAt).toBeNull();
        expect(row.status === "FAILED" ? row.failedAt : row.status === "CANCELLED" ? row.cancelledAt : row.confirmedAt).not.toBeNull();
      }
    });

    it("fail vs cancel: exactly one wins and only its timestamp is set", async () => {
      for (let i = 0; i < 5; i++) {
        const { purchase } = await pending();
        const out = await run([() => transitionUc().execute(purchase.id, "FAILED"), () => transitionUc().execute(purchase.id, "CANCELLED")]);
        const row = await raw(purchase.id);
        expect(["FAILED", "CANCELLED"]).toContain(row.status);
        expect(out.filter((o) => o.status === "fulfilled")).toHaveLength(1);
        expect(row.status === "FAILED" ? [row.failedAt !== null, row.cancelledAt] : [row.cancelledAt !== null, row.failedAt]).toEqual([true, null]);
        expect(row.confirmedAt).toBeNull();
      }
    });

    it("fail vs fail and cancel vs cancel are idempotent", async () => {
      const a = await pending();
      const fails = await run(Array.from({ length: 6 }, () => () => transitionUc().execute(a.purchase.id, "FAILED")));
      expect(fails.every((o) => o.status === "fulfilled")).toBe(true);
      const b = await pending();
      const cancels = await run(Array.from({ length: 6 }, () => () => transitionUc().execute(b.purchase.id, "CANCELLED")));
      expect(cancels.every((o) => o.status === "fulfilled")).toBe(true);
      expect((await raw(a.purchase.id)).status).toBe("FAILED");
      expect((await raw(b.purchase.id)).status).toBe("CANCELLED");
    });
  });

  describe("active-purchase semantics (M123 partial unique index stays authoritative)", () => {
    it.each(["FAILED", "CANCELLED"] as const)("a %s purchase does not block a new purchase, and history is kept", async (terminal) => {
      const { lead, pro, purchase } = await pending();
      await transitionUc().execute(purchase.id, terminal);
      const next = await purchases.initiate({ leadId: lead.id, professionalProfileId: pro.id });
      expect(next.id).not.toBe(purchase.id);
      expect(await prisma.leadPurchase.count({ where: { leadId: lead.id } })).toBe(2);
      expect((await raw(purchase.id)).status).toBe(terminal);
    });

    it("PENDING_PAYMENT and CONFIRMED purchases still block a duplicate (application AND database)", async () => {
      const { lead, pro, purchase } = await pending();
      await expect(purchases.initiate({ leadId: lead.id, professionalProfileId: pro.id })).rejects.toBeInstanceOf(DuplicateActiveLeadPurchaseError);
      await confirmUc().execute(purchase.id);
      await expect(purchases.initiate({ leadId: lead.id, professionalProfileId: pro.id })).rejects.toBeInstanceOf(DuplicateActiveLeadPurchaseError);
      // the DB index refuses a second active row even when the application is bypassed
      await expect(
        prisma.$executeRawUnsafe(
          `INSERT INTO lead_purchases (id, "leadId", "professionalProfileId", status, price, currency, "updatedAt") VALUES (gen_random_uuid(), '${lead.id}', '${pro.id}', 'PENDING_PAYMENT', 5, 'EUR', now())`,
        ),
      ).rejects.toBeDefined();
    });
  });
});
