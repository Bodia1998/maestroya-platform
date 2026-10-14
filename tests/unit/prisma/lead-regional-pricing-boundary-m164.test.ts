import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/** Module 164 — static contracts (no database): additive migration, narrow reader, isolation from legacy/financial code, env discipline. */
const root = path.resolve(__dirname, "../../..");
const read = (f: string) => readFileSync(path.join(root, f), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
const rel = (p: string) => path.relative(root, p).split(path.sep).join("/");

const migrationDir = readdirSync(path.join(root, "prisma/migrations")).find((n) => /_module_164_/.test(n))!;
const sql = read(`prisma/migrations/${migrationDir}/migration.sql`);
const body = sql.replace(/^--.*$/gm, "");

const M164_DOMAIN = [
  "spain-pricing-territory",
  "lead-regional-calibration",
  "lead-estimate-confidence",
  "lead-calibrated-estimate",
  "lead-pricing-review",
  "lead-regional-pricing-mode",
  "lead-estimate-accuracy",
  "lead-estimate-outcome",
].map((n) => `src/core/domain/services/${n}.ts`);

describe("M164 migration (static contract)", () => {
  it("is additive: no drops, truncation, data rewrites or destructive column changes", () => {
    expect(migrationDir).toMatch(/^20261028000000_/);
    expect(body).not.toMatch(/DROP\s+(TABLE|COLUMN|CONSTRAINT|TRIGGER|TYPE)|TRUNCATE|DELETE\s+FROM|UPDATE\s+"|ALTER\s+COLUMN|RENAME/i);
    expect(body.match(/ADD COLUMN/g)).toHaveLength(1);
    expect(body).toMatch(/ADD COLUMN "publicationCalibrationProvenance" JSONB;/);
  });

  it("sorts after the M163 migration and after every earlier one", () => {
    const all = readdirSync(path.join(root, "prisma/migrations")).filter((n) => /^\d{14}_/.test(n)).sort();
    expect(all[all.length - 1]).toBe(migrationDir);
    expect(all.indexOf(migrationDir)).toBeGreaterThan(all.findIndex((n) => /_module_163_/.test(n)));
  });

  it("keeps the published snapshot immutable, including the new column", () => {
    expect(body).toMatch(/CREATE OR REPLACE FUNCTION leads_publication_snapshot_immutable\(\)/);
    expect(body).toContain("publicationCalibrationProvenance");
    expect(body).toMatch(/leads_publication_calibration_valid/);
  });

  it("review table: one row per (lead, fingerprint), one pending per lead, territory rule (D1) and decided-row guard in the database", () => {
    expect(body).toMatch(/CREATE UNIQUE INDEX "lead_pricing_reviews_leadId_inputFingerprint_key"/);
    expect(body).toMatch(/CREATE UNIQUE INDEX "lead_pricing_reviews_one_pending_per_lead"[^;]*WHERE "status" = 'PENDING_REVIEW'/);
    expect(body).toMatch(/lead_pricing_reviews_territory_check/);
    expect(body).toMatch(/"provinceCode" NOT IN \('35', '38', '51', '52'\)/);
    expect(body).toMatch(/lead_pricing_reviews_guard_update_trigger/);
    expect(body).toMatch(/ON DELETE RESTRICT/);
  });

  it("outcome table: one outcome per lead and immutable once recorded", () => {
    expect(body).toMatch(/CREATE UNIQUE INDEX "lead_estimate_outcomes_leadId_key"/);
    expect(body).toMatch(/lead_estimate_outcomes_immutable_trigger/);
    expect(body).toMatch(/lead_estimate_outcomes_value_check/);
  });

  it("creates no pricing data, no price rows and no seed values", () => {
    expect(body).not.toMatch(/INSERT\s+INTO/i);
  });

  it("the Prisma schema models are scalar-only (foreign keys live in SQL, the M154 convention)", () => {
    const schema = read("prisma/schema.prisma");
    for (const model of ["LeadPricingReview", "LeadEstimateOutcome"]) {
      const block = schema.slice(schema.indexOf(`model ${model} {`));
      const end = block.indexOf("\n}");
      expect(block.slice(0, end), model).not.toMatch(/@relation/);
    }
    expect(schema).toMatch(/publicationCalibrationProvenance\s+Json\?/);
  });
});

describe("M164 read boundary", () => {
  it("the region reader selects the country and postal code only", () => {
    const src = strip(read("src/core/infrastructure/database/prisma/repositories/prisma-lead-pricing-region-reader.ts"));
    expect(src).toMatch(/select:\s*\{\s*country:\s*true,\s*postalCode:\s*true\s*\}/);
    expect(src).not.toMatch(/line1|line2|city|latitude|longitude|customer|email|phone|title|description/i);
  });

  it("the region port exposes a derived region, never an address", () => {
    const port = strip(read("src/core/application/ports/lead-pricing-region-reader.ts"));
    expect(port).toMatch(/LeadPricingRegion/);
    expect(port).not.toMatch(/postalCode|line1|latitude/);
  });
});

describe("M164 isolation", () => {
  it("M164 domain code is pure: no framework, database, environment or legacy-money imports", () => {
    for (const f of M164_DOMAIN) {
      const src = strip(read(f));
      expect(src, f).not.toMatch(/from "(@prisma|prisma|next|react|zod)|@\/infrastructure|@\/application|process\.env|Math\.random|Date\.now|new Date\(\)/);
      expect(src, f).not.toMatch(/from "[^"]*(quote|payment|commission|payout|invoice|credit-note|affiliate|stripe|refund|tax|iva)[^"]*"/i);
      expect(src, f).not.toMatch(/\bparseFloat\b|\bNumber\(\s*[a-z]*[Pp]rice|\.toFixed\(/);
    }
  });

  it("no M164 file hardcodes the 21% IVA rate or computes tax", () => {
    const files = [...M164_DOMAIN, "src/core/infrastructure/pricing/lead-regional-calibration.v1.ts"];
    for (const f of files) expect(strip(read(f)), f).not.toMatch(/\b0\.21\b|\b21\s*%|\bvat\b|\biva\b/i);
  });

  it("only the configuration loader reads the M164 environment variables", () => {
    const users = walk(path.join(root, "src"))
      .map(rel)
      .filter((f) => /LEAD_REGIONAL_PRICING_(MODE|CALIBRATION_VERSION)/.test(readFileSync(path.join(root, f), "utf8")) && /process\.env/.test(readFileSync(path.join(root, f), "utf8")));
    expect(users).toEqual(["src/core/infrastructure/config/lead-regional-pricing-config.ts"]);
    const loader = strip(read("src/core/infrastructure/config/lead-regional-pricing-config.ts"));
    expect(loader).toMatch(/source: Readonly<Record<string, string \| undefined>> = process\.env/);
  });

  it("the env switches are documented and default to OFF / no version (commented out in .env.example)", () => {
    const example = read(".env.example");
    expect(example).toMatch(/^# LEAD_REGIONAL_PRICING_MODE="OFF"/m);
    expect(example).toMatch(/^# LEAD_REGIONAL_PRICING_CALIBRATION_VERSION=/m);
    expect(read("src/core/infrastructure/config/env.ts")).not.toMatch(/LEAD_REGIONAL_PRICING/);
  });

  it("the shipped calibration enables nothing and carries no tax fields", () => {
    const src = strip(read("src/core/infrastructure/pricing/lead-regional-calibration.v1.ts"));
    expect(src).toMatch(/entries:\s*\[\s*\]/);
    expect(src).toMatch(/supplyMultiplier:\s*\{\s*status:\s*"DISABLED"\s*\}/);
  });

  it("the legacy engine is unchanged in behaviour: the market factor is optional and neutral when absent", () => {
    const src = strip(read("src/core/domain/services/lead-pricing.ts"));
    expect(src).toMatch(/marketFactor\?:\s*string\s*\|\s*null/);
    expect(src).toMatch(/INVALID_MARKET_FACTOR/);
  });

  it("the review routing writes nothing from the price source; only the publish use case opens a review", () => {
    expect(strip(read("src/core/application/services/lead-pricing/calibrated-lead-publication-price-source.ts"))).not.toMatch(/openOrGet|\.decide\(|\.record\(/);
    const openers = walk(path.join(root, "src"))
      .map(rel)
      .filter((f) => /\.openOrGet\(/.test(strip(readFileSync(path.join(root, f), "utf8"))));
    expect(openers).toEqual(["src/core/application/use-cases/lead/publish-lead.use-case.ts"]);
  });

  it("administrator server actions are gated by requireRole(ADMIN, SUPER_ADMIN)", () => {
    const src = strip(read("src/app/(dashboard)/admin/leads/pricing-review-actions.ts"));
    expect((src.match(/requireRole\(/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(src).toMatch(/ADMIN/);
    expect(src).toMatch(/SUPER_ADMIN/);
  });

  it("repriced / purchased leads are never touched: no M164 code updates a lead's price", () => {
    const files = walk(path.join(root, "src/core"))
      .map(rel)
      .filter((f) => /regional|calibrat|pricing-review|estimate-outcome/.test(f) && f.endsWith(".ts"));
    for (const f of files) expect(strip(read(f)), f).not.toMatch(/lead\.update\(|leadPurchase\.(update|create)|\.publicationPrice\s*=/);
  });
});
