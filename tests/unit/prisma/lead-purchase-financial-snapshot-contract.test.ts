import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Module 135 — static contract for the LeadPurchase financial snapshot and
 * idempotency foundation. The DB-level behaviour is proven by
 * tests/integration-db/lead-purchase/lead-purchase-financial-snapshot.test.ts
 * (real PostgreSQL); this file guards the shape of the schema, the migration and the code boundary.
 */
const root = path.resolve(__dirname, "../../..");
const read = (f: string) => readFileSync(path.join(root, f), "utf8");
const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const MIGRATION_DIR = readdirSync(path.join(root, "prisma/migrations")).find((n) => /_module_135_lead_purchase_financial_snapshot$/.test(n));
const sql = () => read(`prisma/migrations/${MIGRATION_DIR}/migration.sql`);
const sqlCode = () => sql().replace(/^\s*--.*$/gm, "");
const schema = read("prisma/schema.prisma");
const model = schema.slice(schema.indexOf("model LeadPurchase {"), schema.indexOf('@@map("lead_purchases")'));

const REPO = "src/core/infrastructure/database/prisma/repositories/prisma-lead-purchase-repository.ts";
const USE_CASE = "src/core/application/use-cases/lead-purchase/initiate-lead-purchase.use-case.ts";

describe("Module 135 schema", () => {
  it("adds exact Decimal(10,2) tax/total placeholders and nullable provenance, never Float/Int money", () => {
    expect(model).toMatch(/pricingConfigVersion\s+String\?/);
    expect(model).toMatch(/pricingRuleVersion\s+String\?/);
    expect(model).toMatch(/leadPublishedAt\s+DateTime\?/);
    expect(model).toMatch(/taxAmount\s+Decimal\?\s+@db\.Decimal\(10, 2\)/);
    expect(model).toMatch(/totalAmount\s+Decimal\?\s+@db\.Decimal\(10, 2\)/);
    expect(model).toMatch(/price\s+Decimal\s+@db\.Decimal\(10, 2\)/); // existing fee column, unchanged precision
    expect(model).not.toMatch(/\b(Float|Int)\b/);
    expect(model.replace(/^\s*\/\/\/.*$/gm, "")).not.toMatch(/(paymentId|stripe|commission|payout|invoice|vat|iva)/i); // doc comments may mention IVA (Module 136)
  });

  it("does not add idempotency-key or unique columns: the natural (lead, professional, active) boundary already exists", () => {
    const columns = model.replace(/^\s*\/\/\/.*$/gm, "");
    expect(columns).not.toMatch(/idempotency/i);
    expect(columns).not.toMatch(/@@unique/);
    // Module 140's write-once provider payment reference is the ONLY unique column since Module 135.
    expect([...columns.matchAll(/^\s*(\w+)\s+\S+\s+@unique\b/gm)].map((m) => m[1])).toEqual(["paymentReference"]);
  });
});

describe("Module 135 migration", () => {
  it("exists, is additive and only touches lead_purchases", () => {
    expect(MIGRATION_DIR).toBeDefined();
    const body = sqlCode();
    expect(body).not.toMatch(/\b(DROP\s+(TABLE|COLUMN|INDEX|CONSTRAINT)|DELETE|TRUNCATE|UPDATE\s+"|INSERT|RENAME)\b/i);
    expect(body).not.toMatch(/ALTER COLUMN|SET NOT NULL|SET DEFAULT/i); // no rewrite / no fabricated backfill
    const alters = [...body.matchAll(/ALTER TABLE "([^"]+)"/g)].map((m) => m[1]);
    for (const t of alters) expect(t).toBe("lead_purchases");
    expect(body).not.toMatch(/"(service_requests|quotes|payments|commissions|payouts|invoices|leads)"/);
  });

  it("adds exactly the five nullable columns", () => {
    const cols = [...sqlCode().matchAll(/ADD COLUMN "([^"]+)" ([A-Z0-9()]+(?:,\d+\))?)/g)].map((m) => `${m[1]} ${m[2]}`);
    expect(cols).toEqual([
      "pricingConfigVersion TEXT",
      "pricingRuleVersion TEXT",
      "leadPublishedAt TIMESTAMP(3)",
      "taxAmount DECIMAL(10,2)",
      "totalAmount DECIMAL(10,2)",
    ]);
    expect(sqlCode()).not.toMatch(/ADD COLUMN[^;]*NOT NULL/);
  });

  it("creates no new index and leaves the active-purchase partial unique index alone", () => {
    expect(sqlCode()).not.toMatch(/CREATE\s+(UNIQUE\s+)?INDEX/i);
    expect(sqlCode()).not.toMatch(/lead_purchases_one_active_per_lead_professional/);
  });

  it("defines the three CHECKs and the immutability trigger", () => {
    const body = sqlCode();
    expect(body).toContain("lead_purchases_snapshot_all_or_nothing");
    expect(body).toContain('num_nonnulls("pricingConfigVersion", "pricingRuleVersion", "leadPublishedAt") IN (0, 3)');
    expect(body).toContain("lead_purchases_snapshot_fee_valid");
    expect(body).toContain("lead_purchases_tax_total_consistent");
    expect(body).toContain('"totalAmount" = "price" + "taxAmount"');
    expect(body).toContain("CREATE TRIGGER lead_purchases_financial_immutable_trg");
    expect(body).toMatch(/BEFORE UPDATE ON "lead_purchases"/);
  });

  it("the trigger protects every fee/provenance column and treats tax/total as write-once", () => {
    const fn = sqlCode().slice(sqlCode().indexOf("CREATE FUNCTION"));
    for (const c of ["leadId", "professionalProfileId", "price", "currency", "pricingConfigVersion", "pricingRuleVersion", "leadPublishedAt", "createdAt"]) {
      expect(fn).toContain(`NEW."${c}" IS DISTINCT FROM OLD."${c}"`);
    }
    expect(fn).toContain('OLD."taxAmount" IS NOT NULL AND NEW."taxAmount" IS DISTINCT FROM OLD."taxAmount"');
    expect(fn).toContain('OLD."totalAmount" IS NOT NULL AND NEW."totalAmount" IS DISTINCT FROM OLD."totalAmount"');
    // status and the confirmation/refund/revoke timestamps stay mutable
    for (const c of ["status", "confirmedAt", "failedAt", "cancelledAt", "refundedAt", "revokedAt", "updatedAt"]) expect(fn).not.toContain(`NEW."${c}"`);
  });

  it("contains no tax policy (no rate, no IVA/VAT literal)", () => {
    expect(sqlCode()).not.toMatch(/0\.21|21\s*%|\biva\b|\bvat\b/i);
  });
});

describe("Module 135 code boundary", () => {
  it("the purchase fee is never written by a transition: updateMany touches status and stamps only", () => {
    const src = code(REPO);
    const update = src.slice(src.indexOf("updateMany"), src.indexOf("return this.findById(id)"));
    expect(update).toContain("status: to");
    expect(update).not.toMatch(/price|currency|pricingConfigVersion|pricingRuleVersion|leadPublishedAt|taxAmount|totalAmount/);
  });

  it("no code path updates the money/provenance columns of an existing purchase", () => {
    expect(code(REPO)).not.toMatch(/leadPurchase\.(update|upsert)\(/);
  });

  it("initiate copies the fee from the locked lead row and takes no price input", () => {
    const src = code(REPO);
    const initiate = src.slice(src.indexOf("async initiate("), src.indexOf("async transition("));
    expect(initiate).toContain("FOR UPDATE");
    expect(initiate).toContain("financialSnapshotFromLockedLead");
    expect(initiate).toMatch(/price: snapshot\.feeAmount/);
    expect(initiate).not.toMatch(/data\.price/);
    // Module 136: tax comes from the pure policy via the snapshot, never computed in the repository
    expect(initiate).toMatch(/taxAmount: snapshot\.taxAmount/);
    expect(initiate).toMatch(/totalAmount: snapshot\.totalAmount/);
    expect(initiate).toMatch(/taxPolicyVersion: snapshot\.taxPolicyVersion/);
    expect(initiate).not.toMatch(/Number\(|parseFloat|\*\s*0\./); // no float money arithmetic
  });

  it("the use case still requires isLeadMarketplaceReady before the purchase path and has no pricing dependency", () => {
    const src = code(USE_CASE);
    expect(src).toContain("isLeadMarketplaceReady(");
    expect(src.indexOf("isLeadMarketplaceReady(")).toBeLessThan(src.indexOf("this.purchases.initiate"));
    expect(src.indexOf("isLeadMarketplaceReady(")).toBeLessThan(src.indexOf("findActiveByLeadAndProfessional"));
    expect(src).not.toMatch(/LeadPurchasePriceProvider|getPriceForLead|lead-pricing|pricing-config/);
    expect(src).not.toMatch(/stripe|invoice|\b(tax|iva|vat)\b|payments?\//i); // tax lives in the domain snapshot, not the use case
  });
});

describe("Module 136 migration & schema boundary", () => {
  const DIR = readdirSync(path.join(root, "prisma/migrations")).find((n) => /_module_136_lead_fee_tax_snapshot$/.test(n));
  const m136 = () => read(`prisma/migrations/${DIR}/migration.sql`).replace(/^\s*--.*$/gm, "");

  it("is forward-only and additive: one nullable column, no backfill, no index change", () => {
    expect(DIR).toBeDefined();
    const body = m136();
    expect([...body.matchAll(/ADD COLUMN "([^"]+)" (\w+)/g)].map((m) => `${m[1]} ${m[2]}`)).toEqual(["taxPolicyVersion TEXT"]);
    expect(body).not.toMatch(/\b(DROP\s+(TABLE|COLUMN|INDEX)|DELETE|TRUNCATE|UPDATE\s+"|INSERT|RENAME)\b/i);
    expect(body).not.toMatch(/SET NOT NULL|SET DEFAULT|ALTER COLUMN/i);
    expect(body).not.toMatch(/CREATE\s+(UNIQUE\s+)?INDEX|lead_purchases_one_active_per_lead_professional/i);
    for (const t of [...body.matchAll(/ALTER TABLE "([^"]+)"/g)].map((m) => m[1])) expect(t).toBe("lead_purchases");
    expect(body).not.toMatch(/0\.21|2100|21\s*%/); // the rate lives in the domain policy only
  });

  it("adds the all-or-nothing + provenance CHECKs and extends (never weakens) the immutability function", () => {
    const body = m136();
    expect(body).toContain('num_nonnulls("taxAmount", "totalAmount", "taxPolicyVersion") IN (0, 3)');
    expect(body).toContain("lead_purchases_tax_snapshot_provenance");
    const fn = body.slice(body.indexOf("CREATE OR REPLACE FUNCTION"));
    for (const c of ["leadId", "professionalProfileId", "price", "currency", "pricingConfigVersion", "pricingRuleVersion", "leadPublishedAt", "createdAt"]) {
      expect(fn).toContain(`NEW."${c}" IS DISTINCT FROM OLD."${c}"`);
    }
    for (const c of ["taxAmount", "totalAmount", "taxPolicyVersion"]) expect(fn).toContain(`OLD."${c}" IS NOT NULL AND NEW."${c}" IS DISTINCT FROM OLD."${c}"`);
    expect(body).not.toMatch(/CREATE TRIGGER|DROP TRIGGER/); // M135's trigger is reused, not replaced
  });

  it("schema: taxPolicyVersion is a nullable String next to the tax columns", () => {
    expect(model).toMatch(/taxPolicyVersion\s+String\?/);
  });

  it("the 21% rate is defined in exactly one source file", () => {
    const hits = readdirSync(path.join(root, "src/core/domain/services")).filter((f) => /lead-fee|lead-purchase/.test(f) && /LEAD_FEE_IVA_RATE_BPS\s*=/.test(read(`src/core/domain/services/${f}`)));
    expect(hits).toEqual(["lead-fee-tax-policy.ts"]);
    expect(code(REPO)).not.toMatch(/0\.21|2100|LEAD_FEE_IVA_RATE_BPS/);
    expect(code(USE_CASE)).not.toMatch(/0\.21|2100|LEAD_FEE_IVA_RATE_BPS/);
  });
});

describe("Module 137 lifecycle timestamps migration", () => {
  const DIR = readdirSync(path.join(root, "prisma/migrations")).find((n) => /_module_137_lead_purchase_lifecycle_timestamps$/.test(n));
  const m137 = () => read(`prisma/migrations/${DIR}/migration.sql`).replace(/^\s*--.*$/gm, "");

  it("is additive: two nullable columns + two CHECKs, no backfill, no destructive or index/trigger change", () => {
    expect(DIR).toBeDefined();
    const sql137 = m137();
    expect(sql137).toContain('ADD COLUMN "failedAt" TIMESTAMP(3), ADD COLUMN "cancelledAt" TIMESTAMP(3)');
    expect(sql137).not.toMatch(/NOT NULL|UPDATE\s|INSERT\s|DELETE\s|DROP\s|CREATE\s+(UNIQUE\s+)?INDEX|TRIGGER|FUNCTION/i);
  });

  it("a lifecycle timestamp can only exist in the matching status", () => {
    expect(m137()).toContain(`"failedAt" IS NULL OR "status" = 'FAILED'`);
    expect(m137()).toContain(`"cancelledAt" IS NULL OR "status" = 'CANCELLED'`);
  });

  it("the Prisma model declares both columns as optional", () => {
    const schema = read("prisma/schema.prisma");
    expect(schema).toMatch(/failedAt\s+DateTime\?/);
    expect(schema).toMatch(/cancelledAt\s+DateTime\?/);
  });
});
