/**
 * Module 135 — LeadPurchase financial snapshot & idempotency against REAL PostgreSQL.
 *
 * Proves what mocks cannot: the fee is copied from the lead's M133 snapshot under the lead
 * row lock, the migration's CHECKs and immutability trigger hold at the database, and
 * concurrent identical initiations produce exactly one active purchase.
 */
import { describe, expect, it } from "vitest";

import { prisma } from "@/infrastructure/database/prisma/client";
import { PrismaLeadPurchaseRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-purchase-repository";
import { PrismaLeadRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-repository";
import { DuplicateActiveLeadPurchaseError, LeadBuyerLimitReachedError } from "@/domain/services/lead-purchase";

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

describe("Module 135 — LeadPurchase financial snapshot & idempotency (real PostgreSQL)", () => {
  setupDbTestLifecycle();

  const leads = new PrismaLeadRepository();
  const purchases = new PrismaLeadPurchaseRepository();

  async function publishedLead(maxBuyers = 2, patch: Partial<typeof SNAPSHOT_DATA> = {}) {
    const customerUser = await createUser(prisma, { name: "Customer" });
    const address = await createAddress(prisma, customerUser.id);
    const customer = await createCustomerProfile(prisma, customerUser.id);
    const category = await createServiceCategory(prisma);
    const request = await createServiceRequest(prisma, { customerId: customer.id, categoryId: category.id, addressId: address.id });
    await prisma.serviceRequest.update({ where: { id: request.id }, data: { flowVersion: "LEAD_V1" } });
    const draft = await leads.create({ serviceRequestId: request.id });
    return (await leads.publish(draft.id, { ...SNAPSHOT_DATA, ...patch, maxBuyers }))!;
  }

  const professional = async () => createProfessionalProfile(prisma, (await createUser(prisma, { name: "Pro" })).id);

  /** Run a statement that the database must reject, returning the error text. */
  async function rejected(sql: string): Promise<string> {
    try {
      await prisma.$executeRawUnsafe(sql);
    } catch (error) {
      return String((error as Error).message);
    }
    throw new Error(`expected the database to reject: ${sql}`);
  }

  describe("financial snapshot", () => {
    it("copies the agreed fee, currency and provenance from the lead's publication snapshot (exact decimals)", async () => {
      const lead = await publishedLead(2, { price: "18.05" });
      const pro = await professional();
      const created = await purchases.initiate({ leadId: lead.id, professionalProfileId: pro.id });
      expect(created.financialSnapshot).toEqual({
        feeAmount: "18.05",
        currency: "EUR",
        taxAmount: "3.79",
        totalAmount: "21.84",
        taxPolicyVersion: "lead-fee-tax-policy-v1",
        pricingConfigVersion: SNAPSHOT_DATA.pricingConfigVersion,
        pricingRuleVersion: SNAPSHOT_DATA.pricingRuleVersion,
        leadPublishedAt: lead.publication!.publishedAt,
      });
      const row = await prisma.leadPurchase.findUniqueOrThrow({ where: { id: created.id } });
      expect(row.price.toString()).toBe("18.05");
      expect(row.taxAmount?.toString()).toBe("3.79"); // 18.05 x 21% = 3.7905 -> 3.79
      expect(row.totalAmount?.toString()).toBe("21.84");
      expect(row.taxPolicyVersion).toBe("lead-fee-tax-policy-v1");
    });

    it("the purchase keeps its fee even though the lead's own snapshot can never be re-priced (M133 trigger)", async () => {
      const lead = await publishedLead();
      const pro = await professional();
      const created = await purchases.initiate({ leadId: lead.id, professionalProfileId: pro.id });
      await expect(prisma.lead.update({ where: { id: lead.id }, data: { publicationPrice: "99.00" } })).rejects.toBeDefined();
      expect((await purchases.findById(created.id))!.financialSnapshot.feeAmount).toBe("18.00");
    });

    it.each([
      ["price", `price = 1.00`],
      ["currency", `currency = 'USD'`],
      ["pricingConfigVersion", `"pricingConfigVersion" = 'other'`],
      ["pricingRuleVersion", `"pricingRuleVersion" = 'other'`],
      ["leadPublishedAt", `"leadPublishedAt" = now()`],
      ["createdAt", `"createdAt" = now() + interval '1 day'`],
    ])("the database rejects changing %s after insert", async (_c, assignment) => {
      const lead = await publishedLead();
      const pro = await professional();
      const created = await purchases.initiate({ leadId: lead.id, professionalProfileId: pro.id });
      const message = await rejected(`UPDATE lead_purchases SET ${assignment} WHERE id = '${created.id}'`);
      expect(message).toMatch(/immutable|check/i);
      expect((await purchases.findById(created.id))!.financialSnapshot.feeAmount).toBe("18.00");
    });

    it("the database rejects re-pointing a purchase to another lead or professional", async () => {
      const lead = await publishedLead();
      const other = await publishedLead();
      const pro = await professional();
      const created = await purchases.initiate({ leadId: lead.id, professionalProfileId: pro.id });
      expect(await rejected(`UPDATE lead_purchases SET "leadId" = '${other.id}' WHERE id = '${created.id}'`)).toMatch(/immutable/i);
      expect(await rejected(`UPDATE lead_purchases SET "professionalProfileId" = '${(await professional()).id}' WHERE id = '${created.id}'`)).toMatch(/immutable/i);
    });

    it("status transitions and their timestamps remain mutable and never touch the snapshot", async () => {
      const lead = await publishedLead();
      const pro = await professional();
      const created = await purchases.initiate({ leadId: lead.id, professionalProfileId: pro.id });
      const confirmed = await purchases.transition(created.id, "PENDING_PAYMENT", "CONFIRMED", new Date());
      expect(confirmed!.status).toBe("CONFIRMED");
      const refunded = await purchases.transition(created.id, "CONFIRMED", "REFUNDED", new Date());
      expect(refunded!.financialSnapshot).toEqual(created.financialSnapshot);
    });

    it.each([
      ["5.00", "1.05", "6.05"],
      ["100.00", "21.00", "121.00"],
      ["150.00", "31.50", "181.50"],
      ["12.34", "2.59", "14.93"],
    ])("Module 136: net fee %s persists IVA %s and total %s (exact Decimal, 21%%)", async (price, tax, total) => {
      const lead = await publishedLead(2, { price });
      const pro = await professional();
      const created = await purchases.initiate({ leadId: lead.id, professionalProfileId: pro.id });
      expect(created.financialSnapshot).toMatchObject({ feeAmount: price, taxAmount: tax, totalAmount: total, taxPolicyVersion: "lead-fee-tax-policy-v1" });
      const reread = await purchases.findById(created.id);
      expect(reread!.financialSnapshot).toEqual(created.financialSnapshot);
    });

    it("Module 136: the tax snapshot is complete at insert, consistent (total = price + tax) and write-once", async () => {
      const lead = await publishedLead(2, { price: "100.00" });
      const pro = await professional();
      const created = await purchases.initiate({ leadId: lead.id, professionalProfileId: pro.id });
      expect(await rejected(`UPDATE lead_purchases SET "taxAmount" = 0 WHERE id = '${created.id}'`)).toMatch(/immutable|check/i);
      expect(await rejected(`UPDATE lead_purchases SET "taxAmount" = 20.00, "totalAmount" = 121.00 WHERE id = '${created.id}'`)).toMatch(/immutable|check/i);
      expect(await rejected(`UPDATE lead_purchases SET "totalAmount" = 150.00 WHERE id = '${created.id}'`)).toMatch(/immutable|check/i);
      expect(await rejected(`UPDATE lead_purchases SET "taxPolicyVersion" = 'other' WHERE id = '${created.id}'`)).toMatch(/immutable|check/i);
      expect(await rejected(`UPDATE lead_purchases SET "taxAmount" = NULL, "totalAmount" = NULL, "taxPolicyVersion" = NULL WHERE id = '${created.id}'`)).toMatch(/immutable|check/i);
      expect((await purchases.findById(created.id))!.financialSnapshot).toMatchObject({ taxAmount: "21.00", totalAmount: "121.00", taxPolicyVersion: "lead-fee-tax-policy-v1" });
    });

    it("Module 136: the database rejects inconsistent or half-written tax snapshots on insert", async () => {
      const lead = await publishedLead();
      const pro = await professional();
      const provenance = `"pricingConfigVersion", "pricingRuleVersion", "leadPublishedAt"`;
      const insert = (cols: string, vals: string) =>
        `INSERT INTO lead_purchases (id, "leadId", "professionalProfileId", status, price, currency, ${cols}, "updatedAt") VALUES (gen_random_uuid(), '${lead.id}', '${pro.id}', 'FAILED', ${vals}, now())`;
      // total != price + tax
      expect(await rejected(insert(`${provenance}, "taxAmount", "totalAmount", "taxPolicyVersion"`, `100.00, 'EUR', 'c', 'r', now(), 21.00, 120.00, 'v'`))).toMatch(/lead_purchases_tax_total_consistent|check/i);
      // negative tax
      expect(await rejected(insert(`${provenance}, "taxAmount", "totalAmount", "taxPolicyVersion"`, `100.00, 'EUR', 'c', 'r', now(), -1.00, 99.00, 'v'`))).toMatch(/lead_purchases_tax_total_consistent|check/i);
      // tax without a policy version / version without tax
      expect(await rejected(insert(`${provenance}, "taxAmount", "totalAmount"`, `100.00, 'EUR', 'c', 'r', now(), 21.00, 121.00`))).toMatch(/lead_purchases_tax_snapshot_all_or_nothing|check/i);
      expect(await rejected(insert(`${provenance}, "taxPolicyVersion"`, `100.00, 'EUR', 'c', 'r', now(), 'v'`))).toMatch(/lead_purchases_tax_snapshot_all_or_nothing|check/i);
      // blank version
      expect(await rejected(insert(`${provenance}, "taxAmount", "totalAmount", "taxPolicyVersion"`, `100.00, 'EUR', 'c', 'r', now(), 21.00, 121.00, '  '`))).toMatch(/lead_purchases_tax_snapshot_provenance|check/i);
      // tax snapshot on a purchase with no M133 fee provenance
      expect(await rejected(insert(`"taxAmount", "totalAmount", "taxPolicyVersion"`, `100.00, 'EUR', 21.00, 121.00, 'v'`))).toMatch(/lead_purchases_tax_snapshot_provenance|check/i);
    });

    it("Module 136: a pre-M136 purchase keeps NULL tax (nothing invented), stays valid and a retry gets a fresh snapshot", async () => {
      const lead = await publishedLead(2, { price: "100.00" });
      const pro = await professional();
      const id = "00000000-0000-4000-8000-000000000136";
      await prisma.$executeRawUnsafe(
        `INSERT INTO lead_purchases (id, "leadId", "professionalProfileId", status, price, currency, "pricingConfigVersion", "pricingRuleVersion", "leadPublishedAt", "updatedAt") VALUES ('${id}', '${lead.id}', '${pro.id}', 'PENDING_PAYMENT', 100.00, 'EUR', 'c', 'r', now(), now())`,
      );
      const legacy = (await purchases.findById(id))!;
      expect(legacy.financialSnapshot).toMatchObject({ feeAmount: "100.00", taxAmount: null, totalAmount: null, taxPolicyVersion: null });
      expect((await purchases.transition(id, "PENDING_PAYMENT", "FAILED", new Date()))!.financialSnapshot.taxAmount).toBeNull();
      const fresh = await purchases.initiate({ leadId: lead.id, professionalProfileId: pro.id });
      expect(fresh.financialSnapshot).toMatchObject({ taxAmount: "21.00", totalAmount: "121.00", taxPolicyVersion: "lead-fee-tax-policy-v1" });
    });

    it("provenance is all-or-nothing and a snapshotted purchase must carry a positive EUR fee", async () => {
      const lead = await publishedLead();
      const pro = await professional();
      const insert = (cols: string, vals: string) =>
        `INSERT INTO lead_purchases (id, "leadId", "professionalProfileId", status, price, currency, ${cols}, "updatedAt") VALUES (gen_random_uuid(), '${lead.id}', '${pro.id}', 'FAILED', ${vals}, now())`;
      expect(await rejected(insert(`"pricingConfigVersion"`, `18.00, 'EUR', 'cfg'`))).toMatch(/lead_purchases_snapshot_all_or_nothing|check/i);
      expect(await rejected(insert(`"pricingConfigVersion", "pricingRuleVersion", "leadPublishedAt"`, `0.00, 'EUR', 'c', 'r', now()`))).toMatch(/lead_purchases_snapshot_fee_valid|check/i);
      expect(await rejected(insert(`"pricingConfigVersion", "pricingRuleVersion", "leadPublishedAt"`, `5.00, 'USD', 'c', 'r', now()`))).toMatch(/lead_purchases_snapshot_fee_valid|check/i);
    });

    it("a pre-M135 purchase (no provenance) stays valid, keeps its fee and can still transition; nothing is fabricated", async () => {
      const lead = await publishedLead();
      const pro = await professional();
      const id = "00000000-0000-4000-8000-000000000135";
      await prisma.$executeRawUnsafe(
        `INSERT INTO lead_purchases (id, "leadId", "professionalProfileId", status, price, currency, "updatedAt") VALUES ('${id}', '${lead.id}', '${pro.id}', 'PENDING_PAYMENT', 4.50, 'EUR', now())`,
      );
      const legacy = (await purchases.findById(id))!;
      expect(legacy.financialSnapshot).toMatchObject({ feeAmount: "4.50", pricingConfigVersion: null, pricingRuleVersion: null, leadPublishedAt: null, taxAmount: null, totalAmount: null });
      expect((await purchases.transition(id, "PENDING_PAYMENT", "CANCELLED", new Date()))!.status).toBe("CANCELLED");
      expect(await rejected(`UPDATE lead_purchases SET price = 1.00 WHERE id = '${id}'`)).toMatch(/immutable/i);
    });
  });

  describe("idempotency & concurrency", () => {
    it("concurrent identical initiations create exactly one active purchase; every loser is a typed duplicate", async () => {
      const lead = await publishedLead(2);
      const pro = await professional();
      const outcomes = await Promise.allSettled(Array.from({ length: 8 }, () => purchases.initiate({ leadId: lead.id, professionalProfileId: pro.id })));
      expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
      for (const o of outcomes) if (o.status === "rejected") expect(o.reason).toBeInstanceOf(DuplicateActiveLeadPurchaseError);
      expect(await prisma.leadPurchase.count({ where: { leadId: lead.id, status: { in: ["PENDING_PAYMENT", "CONFIRMED"] } } })).toBe(1);
    });

    it("on an exclusive lead (maxBuyers 1) the buyer's own concurrent retries are duplicates, never 'limit reached'", async () => {
      const lead = await publishedLead(1);
      const pro = await professional();
      const outcomes = await Promise.allSettled(Array.from({ length: 6 }, () => purchases.initiate({ leadId: lead.id, professionalProfileId: pro.id })));
      expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
      for (const o of outcomes) {
        if (o.status === "rejected") {
          expect(o.reason).toBeInstanceOf(DuplicateActiveLeadPurchaseError);
          expect(o.reason).not.toBeInstanceOf(LeadBuyerLimitReachedError);
        }
      }
    });

    it("different professionals purchase the same lead independently while the lead's buyer policy allows it, each with the same snapshot fee", async () => {
      const lead = await publishedLead(3);
      const pros = await Promise.all([professional(), professional(), professional(), professional()]);
      const outcomes = await Promise.allSettled(pros.map((p) => purchases.initiate({ leadId: lead.id, professionalProfileId: p.id })));
      const ok = outcomes.filter((o): o is PromiseFulfilledResult<Awaited<ReturnType<typeof purchases.initiate>>> => o.status === "fulfilled");
      expect(ok).toHaveLength(3); // the buyer policy stays authoritative
      for (const o of outcomes) if (o.status === "rejected") expect(o.reason).toBeInstanceOf(LeadBuyerLimitReachedError);
      expect(new Set(ok.map((o) => o.value.financialSnapshot.feeAmount))).toEqual(new Set(["18.00"]));
      expect(new Set(ok.map((o) => o.value.financialSnapshot.totalAmount))).toEqual(new Set(["21.78"]));
    });

    it("a retry after FAILED is a NEW purchase with the SAME snapshot fee; history is kept", async () => {
      const lead = await publishedLead();
      const pro = await professional();
      const first = await purchases.initiate({ leadId: lead.id, professionalProfileId: pro.id });
      await purchases.transition(first.id, "PENDING_PAYMENT", "FAILED", new Date());
      const second = await purchases.initiate({ leadId: lead.id, professionalProfileId: pro.id });
      expect(second.id).not.toBe(first.id);
      expect(second.financialSnapshot).toEqual(first.financialSnapshot); // incl. taxAmount / totalAmount / taxPolicyVersion
      expect(second.financialSnapshot.taxAmount).toBe("3.78");
      expect(await prisma.leadPurchase.count({ where: { leadId: lead.id } })).toBe(2);
    });

    it("the Module 123 partial unique index is still the final arbiter below the repository", async () => {
      const lead = await publishedLead();
      const pro = await professional();
      await purchases.initiate({ leadId: lead.id, professionalProfileId: pro.id });
      const message = await rejected(
        `INSERT INTO lead_purchases (id, "leadId", "professionalProfileId", status, price, currency, "updatedAt") VALUES (gen_random_uuid(), '${lead.id}', '${pro.id}', 'PENDING_PAYMENT', 18.00, 'EUR', now())`,
      );
      // Prisma formats a raw-query unique violation differently depending on the engine/driver: the
      // native engine reports `Key ("leadId", "professionalProfileId")=(...) already exists`, the
      // driver-adapter path reports the constraint name. Both carry the authoritative PostgreSQL code
      // 23505, so assert it plus evidence of WHICH key was violated (either form), not the literal text.
      expect(message).toMatch(/23505/);
      const identifiesKey =
        message.includes("lead_purchases_one_active_per_lead_professional") ||
        (message.includes("leadId") && message.includes("professionalProfileId"));
      expect(identifiesKey, message).toBe(true);
      // ...and prove the authority is still the M123 partial unique index, unchanged.
      const [index] = await prisma.$queryRaw<Array<{ indexdef: string }>>`
        SELECT indexdef FROM pg_indexes WHERE tablename = 'lead_purchases' AND indexname = 'lead_purchases_one_active_per_lead_professional'`;
      expect(index?.indexdef).toMatch(/CREATE UNIQUE INDEX/);
      expect(index?.indexdef).toContain('("leadId", "professionalProfileId")');
      expect(index?.indexdef).toMatch(/WHERE.*status.*(PENDING_PAYMENT).*(CONFIRMED)/s);
    });
  });
});
