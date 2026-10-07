import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { ACTIVE_LEAD_PURCHASE_STATUSES, LEAD_PURCHASE_STATUSES } from "@/domain/services/lead-purchase";
import { LEAD_STATUSES } from "@/domain/services/lead";

/**
 * Module 123 — static contract tests for the additive Lead / LeadPurchase
 * schema + migration, and the boundaries it must not cross.
 */
const root = path.resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");
const schema = read("prisma/schema.prisma");

function block(kind: "model" | "enum", name: string): string {
  const m = schema.match(new RegExp(`^${kind} ${name} \\{[\\s\\S]*?^\\}`, "m"));
  expect(m, `${kind} ${name} must exist`).not.toBeNull();
  return m![0];
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const migrationDir = readdirSync(path.join(root, "prisma/migrations")).find((d) => d.endsWith("add_module_123_lead_and_lead_purchase"));
const migration = migrationDir ? read(`prisma/migrations/${migrationDir}/migration.sql`) : "";
const sql = migration.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

describe("Module 123 schema contract", () => {
  it("Lead: one-per-ServiceRequest, FK restrict, DRAFT default, no stored flowVersion, no customer data", () => {
    const lead = block("model", "Lead");
    expect(lead).toMatch(/serviceRequestId\s+String\s+@unique\s+@db\.Uuid/);
    expect(lead).toMatch(/status\s+LeadStatus\s+@default\(DRAFT\)/);
    expect(lead).toMatch(/maxBuyers\s+Int\?/);
    expect(lead).toMatch(/references: \[id\], onDelete: Restrict/);
    expect(lead).not.toMatch(/^\s*flowVersion\s/m);
    expect(lead).not.toMatch(/^\s*(email|phone|address|addressLine|customerName|title|description)\b/im);
    expect(lead).toContain('@@map("leads")');
  });

  it("LeadPurchase: ProfessionalProfile identity, Decimal(10,2) price, EUR default, PENDING_PAYMENT default", () => {
    const p = block("model", "LeadPurchase");
    expect(p).toMatch(/professionalProfileId\s+String\s+@db\.Uuid/);
    expect(p).toMatch(/professional\s+ProfessionalProfile\s+@relation\(.*onDelete: Restrict/);
    expect(p).toMatch(/lead\s+Lead\s+@relation\(.*onDelete: Restrict/);
    expect(p).toMatch(/price\s+Decimal\s+@db\.Decimal\(10, 2\)/);
    expect(p).toMatch(/currency\s+String\s+@default\("EUR"\)/);
    expect(p).toMatch(/status\s+LeadPurchaseStatus\s+@default\(PENDING_PAYMENT\)/);
    expect(p).not.toMatch(/(paymentId|stripe|commission|payout|invoice)/i);
    expect(p).toContain('@@map("lead_purchases")');
  });

  it("Prisma enums match the domain constants exactly", () => {
    const names = (b: string) => b.split("\n").slice(1, -1).map((l) => l.trim()).filter((l) => l && !l.startsWith("//"));
    expect(names(block("enum", "LeadStatus"))).toEqual([...LEAD_STATUSES]);
    expect(names(block("enum", "LeadPurchaseStatus"))).toEqual([...LEAD_PURCHASE_STATUSES]);
  });

  it("ServiceRequest keeps its Module 121 flowVersion default and gains only an optional Lead back-relation", () => {
    const sr = block("model", "ServiceRequest");
    expect(sr).toMatch(/flowVersion\s+TransactionFlowVersion\s+@default\(LEGACY_QUOTE_PAYMENT\)/);
    expect(sr).toMatch(/lead\s+Lead\?/);
  });

  it("legacy financial models are not related to Lead / LeadPurchase", () => {
    for (const legacy of ["Payment", "Commission", "Payout", "Quote", "Invoice", "CreditNote"]) {
      const b = block("model", legacy);
      expect(b).not.toMatch(/\bLead(Purchase)?\b/);
    }
  });
});

describe("Module 123 migration contract", () => {
  it("exists", () => expect(migrationDir).toBeDefined());

  it("is additive: no DROP/DELETE/TRUNCATE/UPDATE/RENAME/INSERT", () => {
    // Referential actions (ON DELETE RESTRICT / ON UPDATE CASCADE) are DDL clauses, not data changes.
    const withoutRefActions = sql.replace(/ON (DELETE|UPDATE) (RESTRICT|CASCADE)/g, "");
    expect(withoutRefActions).not.toMatch(/\b(DROP|DELETE|TRUNCATE|UPDATE|RENAME|INSERT)\b/i);
  });

  it("only creates new objects; every ALTER TABLE targets a new table; legacy tables are never named as ALTER targets", () => {
    const alters = [...sql.matchAll(/ALTER TABLE "([^"]+)"/g)].map((m) => m[1]);
    expect(alters.length).toBeGreaterThan(0);
    for (const t of alters) expect(["leads", "lead_purchases"]).toContain(t);
    expect([...sql.matchAll(/CREATE TABLE "([^"]+)"/g)].map((m) => m[1]).sort()).toEqual(["lead_purchases", "leads"]);
    expect(sql).not.toMatch(/ALTER TABLE "(service_requests|quotes|payments|commissions|payouts|invoices)"/);
  });

  it("enforces one Lead per ServiceRequest at the database level", () => {
    expect(sql).toContain('CREATE UNIQUE INDEX "leads_serviceRequestId_key" ON "leads"("serviceRequestId")');
  });

  it("uses RESTRICT foreign keys (history is never cascaded away)", () => {
    const fks = sql.match(/ADD CONSTRAINT "[^"]+_fkey"[^;]+;/g) ?? [];
    expect(fks).toHaveLength(3);
    for (const fk of fks) expect(fk).toContain("ON DELETE RESTRICT");
  });

  it("adds CHECKs: price >= 0 and maxBuyers null-or-positive", () => {
    expect(sql).toContain('CHECK ("price" >= 0)');
    expect(sql).toContain('CHECK ("maxBuyers" IS NULL OR "maxBuyers" >= 1)');
  });

  it("partial unique index covers exactly the domain's ACTIVE statuses", () => {
    const m = sql.match(/lead_purchases_one_active_per_lead_professional"\s+ON "lead_purchases" \("leadId", "professionalProfileId"\)\s+WHERE "status" IN \(([^)]+)\)/);
    expect(m).not.toBeNull();
    const statuses = m![1]!.split(",").map((s) => s.trim().replace(/'/g, ""));
    expect(statuses).toEqual([...ACTIVE_LEAD_PURCHASE_STATUSES]);
  });

  it("does not hard-code an exclusivity policy (no unique on leadId alone)", () => {
    expect(sql).not.toMatch(/UNIQUE INDEX "[^"]+" ON "lead_purchases"\s*\("leadId"\)/);
    expect(sql).not.toMatch(/maxBuyers" (=|<=) 1/);
  });
});

describe("Module 123 code boundaries", () => {
  const files = walk(path.join(root, "src")).map((f) => path.relative(root, f).split(path.sep).join("/"));
  const content = (f: string) => readFileSync(path.join(root, f), "utf8");

  it("PrismaLeadRepository is the only writer of the leads table", () => {
    const writers = files.filter((f) => /\.lead\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(|\blead\.(create|createMany|upsert)\(/.test(content(f)));
    expect(writers).toEqual(["src/core/infrastructure/database/prisma/repositories/prisma-lead-repository.ts"]);
  });

  it("PrismaLeadPurchaseRepository is the only writer of the lead_purchases table", () => {
    const writers = files.filter((f) => /leadPurchase\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/.test(content(f)));
    expect(writers).toEqual(["src/core/infrastructure/database/prisma/repositories/prisma-lead-purchase-repository.ts"]);
  });

  it("lead repositories never touch legacy financial models", () => {
    for (const f of [
      "src/core/infrastructure/database/prisma/repositories/prisma-lead-repository.ts",
      "src/core/infrastructure/database/prisma/repositories/prisma-lead-purchase-repository.ts",
    ]) {
      expect(content(f)).not.toMatch(/prisma\.(quote|payment|commission|payout|invoice|creditNote|refund|financialLedgerEntry)\b|tx\.(quote|payment|commission|payout|invoice)\b/);
    }
  });

  it("no route, page or server action exposes Lead data yet (no contact endpoint)", () => {
    const exposed = files.filter((f) => f.startsWith("src/app/") && /PrismaLead|LeadRepository|LeadPurchaseRepository/.test(content(f)));
    expect(exposed).toEqual([]);
  });

  it("domain/ports for leads never import Prisma or reference contact columns", () => {
    for (const f of [
      "src/core/domain/services/lead.ts",
      "src/core/domain/services/lead-purchase.ts",
      "src/core/domain/repositories/lead-repository.ts",
      "src/core/domain/repositories/lead-purchase-repository.ts",
    ]) {
      const src = content(f).replace(/\/\*[\s\S]*?\*\//g, "");
      expect(src).not.toMatch(/@prisma\/client/);
      expect(src).not.toMatch(/\b(email|phone|addressLine|postalCode)\b/i);
    }
  });

  it("Module 138: the ONLY adapters of Module 122's contact ports live in the single reviewed Prisma file", () => {
    const readers = files.filter((f) => /implements\s+LeadContact(Reader|AuthorizationReader)/.test(content(f)));
    expect(readers).toEqual(["src/core/infrastructure/database/prisma/repositories/prisma-lead-contact-access-repository.ts"]);
  });
});
