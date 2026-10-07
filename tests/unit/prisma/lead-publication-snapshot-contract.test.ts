import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { LEAD_BUYER_POLICY_PILOT_V1 } from "@/infrastructure/lead-publication/lead-buyer-policy-pilot.v1";
import { isValidLeadBuyerPolicy } from "@/domain/services/lead-publication";

/**
 * Module 133 — static contracts: additive snapshot schema/migration, repository
 * boundaries, flow isolation and "nothing from later modules".
 */
const root = path.resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const schema = read("prisma/schema.prisma");
const lead = schema.match(/^model Lead \{[\s\S]*?^\}/m)![0];

const migrationDir = readdirSync(path.join(root, "prisma/migrations")).find((d) => d.endsWith("add_module_133_lead_publication_snapshot"));
const migration = migrationDir ? read(`prisma/migrations/${migrationDir}/migration.sql`) : "";
const sql = migration.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}
const rel = (f: string) => path.relative(root, f).split(path.sep).join("/");

describe("Module 133 schema", () => {
  it("snapshot columns are nullable, exact money types, and maxBuyers is reused (not duplicated)", () => {
    expect(lead).toMatch(/maxBuyers\s+Int\?/);
    expect(lead).toMatch(/publishedAt\s+DateTime\?/);
    expect(lead).toMatch(/publicationPrice\s+Decimal\?\s+@db\.Decimal\(10, 2\)/);
    expect(lead).toMatch(/publicationEstimatedJobValue\s+Decimal\?\s+@db\.Decimal\(10, 2\)/);
    expect(lead).toMatch(/publicationPricingRate\s+Decimal\?\s+@db\.Decimal\(8, 6\)/);
    for (const f of ["publicationCurrency", "publicationPricingConfidence", "publicationPricingConfigVersion", "publicationJobValueRuleVersion", "publicationPricingRuleVersion", "publicationBuyerPolicyVersion"]) {
      expect(lead).toMatch(new RegExp(`${f}\\s+String\\?`));
    }
    expect(lead).not.toMatch(/\bFloat\b/);
    expect(lead).not.toMatch(/maxBuyersSnapshot|publicationMaxBuyers/);
  });

  it("LeadStatus is unchanged (no new status) and Lead still stores no flowVersion / contact data", () => {
    const names = schema.match(/^enum LeadStatus \{[\s\S]*?^\}/m)![0].split("\n").slice(1, -1).map((l) => l.trim()).filter(Boolean);
    expect(names).toEqual(["DRAFT", "PUBLISHED", "CLOSED", "EXPIRED", "CANCELLED"]);
    expect(lead).not.toMatch(/^\s*flowVersion\s/m);
    expect(lead).not.toMatch(/^\s*(email|phone|address|customerName)\b/im);
  });

  it("LeadPurchase and legacy financial models are not modified by the snapshot", () => {
    const purchase = schema.match(/^model LeadPurchase \{[\s\S]*?^\}/m)![0];
    // Module 135 gave LeadPurchase its OWN snapshot provenance (leadPublishedAt, pricing*Version); it still has no publication* columns.
    expect(purchase).not.toMatch(/^\s*publication\w*\s/m);
    for (const legacy of ["Payment", "Commission", "Payout", "Quote", "Invoice", "CreditNote"]) {
      expect(schema.match(new RegExp(`^model ${legacy} \\{[\\s\\S]*?^\\}`, "m"))![0]).not.toMatch(/publication/i);
    }
  });
});

describe("Module 133 migration", () => {
  it("exists and only ALTERs the leads table (additive: no DROP TABLE/COLUMN, no data change, nothing else touched)", () => {
    expect(migrationDir).toBeDefined();
    expect([...sql.matchAll(/ALTER TABLE "([^"]+)"/g)].map((m) => m[1]).every((t) => t === "leads")).toBe(true);
    expect(sql).not.toMatch(/\b(DROP\s+(TABLE|COLUMN)|DELETE|TRUNCATE|RENAME|INSERT|SET NOT NULL)\b/i);
    expect(sql).not.toMatch(/lead_purchases|service_requests|"payments"|commissions|payouts|invoices/);
    expect(sql.match(/ADD COLUMN/g)?.length).toBe(10);
    // every new column is nullable (existing rows stay valid)
    expect(sql).not.toMatch(/ADD COLUMN[^,;]*NOT NULL/);
  });

  it("enforces all-or-nothing, valid values, published-requires-snapshot (NOT VALID for legacy rows) and immutability", () => {
    expect(sql).toContain("leads_publication_snapshot_all_or_nothing");
    expect(sql).toMatch(/num_nonnulls\([\s\S]*\) IN \(0, 10\)/);
    expect(sql).toContain("leads_publication_snapshot_values_valid");
    expect(sql).toMatch(/"publicationPrice" > 0/);
    expect(sql).toMatch(/"publicationCurrency" = 'EUR'/);
    expect(sql).toMatch(/leads_published_requires_snapshot[\s\S]*?NOT VALID/);
    expect(sql).toContain("BEFORE UPDATE ON \"leads\"");
    for (const col of ["publishedAt", "publicationPrice", "publicationPricingConfigVersion", "publicationBuyerPolicyVersion", "maxBuyers"]) {
      expect(sql).toContain(`NEW."${col}" IS DISTINCT FROM OLD."${col}"`);
    }
  });
});

describe("Module 133 boundaries", () => {
  it("the only writer of the snapshot is PrismaLeadRepository.publish (one persistence path)", () => {
    // Module 135: the LeadPurchase repository READS the snapshot (locked SELECT) to copy the fee; it never writes the leads table.
    const writers = walk(path.join(root, "src"))
      .filter((f) => rel(f) !== "src/core/infrastructure/database/prisma/repositories/prisma-lead-purchase-repository.ts")
      .filter((f) => /publicationPrice/.test(strip(read(rel(f)))) && /\.(updateMany|update|create|upsert)\(/.test(strip(read(rel(f)))));
    expect(writers.map(rel)).toEqual(["src/core/infrastructure/database/prisma/repositories/prisma-lead-repository.ts"]);
    const repo = strip(read("src/core/infrastructure/database/prisma/repositories/prisma-lead-repository.ts"));
    expect((repo.match(/lead\.updateMany\(/g) ?? []).length).toBe(2); // propagation (M130) + publish (M133)
    expect(repo).not.toMatch(/\bprisma\.lead\.(update|upsert)\(/);
  });

  it("the publication contract and use case never reach legacy financial code or LeadPurchase", () => {
    for (const f of [
      "src/core/domain/services/lead-publication.ts",
      "src/core/application/use-cases/lead/publish-lead.use-case.ts",
      "src/core/application/ports/lead-publication-price-source.ts",
      "src/core/application/services/lead-pricing/configured-lead-publication-price-source.ts",
      "src/core/application/use-cases/lead-publication/compose.ts",
    ]) {
      const src = strip(read(f));
      expect(src, f).not.toMatch(/from "[^"]*(quote|payment|commission|payout|invoice|credit-note|affiliate|stripe|refund)[^"]*"/i);
      expect(src, f).not.toMatch(/\b(prisma|tx)\.(quote|payment|commission|payout|invoice|creditNote|refund|affiliate\w*|leadPurchase)\b/);
      expect(src, f).not.toMatch(/LeadPurchase|leadPurchase/);
    }
  });

  it("money in the publication contract uses no JS number arithmetic helpers", () => {
    for (const f of ["src/core/domain/services/lead-publication.ts", "src/core/application/services/lead-pricing/configured-lead-publication-price-source.ts", "src/core/infrastructure/database/prisma/repositories/prisma-lead-repository.ts"]) {
      expect(strip(read(f)), f).not.toMatch(/parseFloat|\.toFixed\(|Number\(|Math\.(round|floor|ceil)/);
    }
  });

  it("legacy flows stay unaware of the publication contract", () => {
    const files = walk(path.join(root, "src/core/application/use-cases")).map(rel).filter((f) => /\/(quotes|payments|financial|invoicing|job|affiliate)\//.test(f));
    for (const f of files) expect(read(f), f).not.toMatch(/lead-publication|LeadPublication|use-cases\/lead\//);
  });

  it("the lead composition root re-exports the publication wiring; Server Actions never touch repositories or pricing", () => {
    expect(read("src/core/application/use-cases/lead/compose.ts")).toContain('export { makePublishLeadUseCase } from "@/application/use-cases/lead-publication/compose"');
    const action = read("src/app/(dashboard)/requests/lead-actions.ts");
    expect(action).not.toMatch(/Prisma\w*Repository|@\/infrastructure\/database|lead-pricing|LeadPricing/);
  });

  it("production code never imports test fixtures", () => {
    for (const f of walk(path.join(root, "src"))) expect(read(rel(f)), rel(f)).not.toMatch(/test-utils\/lead-publication-fixtures/);
  });

  it("no later-module scope was introduced (feed v2, purchase financial schema, tax, contact unlock, stripe lead-fee)", () => {
    for (const f of ["src/core/domain/services/lead-publication.ts", "src/core/application/use-cases/lead/publish-lead.use-case.ts", "src/core/infrastructure/database/prisma/repositories/prisma-lead-repository.ts"]) {
      expect(strip(read(f)), f).not.toMatch(/stripe|ivaRate|taxAmount|idempotencyKey|unlockContact|LeadFeed/i);
    }
  });
});

describe("Module 133 pilot buyer policy", () => {
  it("is a valid, versioned, explicit policy and is frozen", () => {
    expect(isValidLeadBuyerPolicy(LEAD_BUYER_POLICY_PILOT_V1)).toBe(true);
    expect(LEAD_BUYER_POLICY_PILOT_V1.policyVersion).toBe("lead-buyer-policy-pilot-v1");
    expect(Object.isFrozen(LEAD_BUYER_POLICY_PILOT_V1)).toBe(true);
  });

  it("buyer count is only defined in the released policy file, not hard-coded in publication logic", () => {
    for (const f of ["src/core/domain/services/lead-publication.ts", "src/core/application/use-cases/lead/publish-lead.use-case.ts", "src/core/application/use-cases/lead-publication/compose.ts"]) {
      expect(strip(read(f)), f).not.toMatch(/maxBuyers:\s*\d/);
    }
  });
});
