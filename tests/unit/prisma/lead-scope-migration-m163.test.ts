import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/** Module 163 — static contract of the additive migration (no database needed; the SQL itself is not executed here). */
const root = path.resolve(__dirname, "../../..");
const dir = readdirSync(path.join(root, "prisma/migrations")).find((n) => /_module_163_/.test(n))!;
const sql = readFileSync(path.join(root, "prisma/migrations", dir, "migration.sql"), "utf8");
const body = sql.replace(/^--.*$/gm, "");
const m133 = readdirSync(path.join(root, "prisma/migrations")).filter((n) => /module_133/.test(n));

describe("Module 163 migration", () => {
  it("sorts after every earlier migration", () => {
    const all = readdirSync(path.join(root, "prisma/migrations")).filter((n) => /^\d{14}_/.test(n)).sort();
    // Later modules (M164+) may add their own migrations; M163 must still sort after everything that existed before it.
    expect(all.slice(all.indexOf(dir) + 1).every((n) => /_module_(16[4-9]|1[7-9]\d|[2-9]\d\d)_/.test(n))).toBe(true);
  });

  it("is additive: nullable columns, constraints and one function replacement only", () => {
    expect(body).not.toMatch(/DROP\s+(TABLE|COLUMN|CONSTRAINT|TRIGGER)|TRUNCATE|DELETE\s+FROM|UPDATE\s+"|ALTER\s+COLUMN|RENAME|ADD COLUMN\s+"\w+"\s+\w+\s+NOT NULL/i);
    expect(body.match(/ADD COLUMN/g)).toHaveLength(4);
    for (const c of ["scopeAnswers", "scopeQuestionnaireVersion", "publicationScopeQuestionnaireVersion", "publicationScopeAnswers"]) expect(body).toContain(`"${c}"`);
  });

  it("never touches the M133 all-or-nothing CHECK and keeps the new columns out of it", () => {
    expect(body).not.toMatch(/leads_publication_snapshot_all_or_nothing/);
    expect(body).not.toMatch(/num_nonnulls/);
    for (const name of m133) {
      expect(readFileSync(path.join(root, "prisma/migrations", name, "migration.sql"), "utf8")).toMatch(/num_nonnulls[\s\S]*IN \(0, ?10\)/);
    }
  });

  it("adds the five checks, including LEAD_V1-only and both-or-neither", () => {
    for (const n of ["service_requests_scope_all_or_nothing", "service_requests_scope_shape", "service_requests_scope_lead_v1_only", "leads_publication_scope_all_or_nothing", "leads_publication_scope_valid"]) {
      expect(body).toContain(`ADD CONSTRAINT "${n}"`);
    }
    expect(body).toMatch(/"flowVersion" = 'LEAD_V1'/);
  });

  it("replaces the immutability function with every M133 column still guarded plus the two new ones", () => {
    expect(body).toContain("CREATE OR REPLACE FUNCTION leads_publication_snapshot_immutable()");
    for (const c of ["publishedAt", "publicationPrice", "publicationCurrency", "publicationEstimatedJobValue", "publicationPricingRate", "publicationPricingConfidence", "publicationPricingConfigVersion", "publicationJobValueRuleVersion", "publicationPricingRuleVersion", "publicationBuyerPolicyVersion", "publicationScopeQuestionnaireVersion", "publicationScopeAnswers", "maxBuyers"]) {
      expect(body).toContain(`NEW."${c}" IS DISTINCT FROM OLD."${c}"`);
    }
    expect(body).not.toMatch(/CREATE\s+(CONSTRAINT\s+)?TRIGGER/i); // the existing trigger keeps pointing at the (replaced) function
  });

  it("does not touch purchases or any financial table", () => {
    expect(body).not.toMatch(/lead_purchases|payments|commissions|payouts|invoices|quotes/i);
  });
});
