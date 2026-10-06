import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Module 129 — static boundaries: Job Value Estimation is a pure, separate
 * capability. No budget, contact, payment, tax, legacy, external or AI
 * dependency, no money floating point, and no pricing logic.
 */
const root = path.resolve(__dirname, "../../..");
const FILES = [
  "src/core/domain/services/job-value-estimation.ts",
  "src/core/domain/services/fixed-point-decimal.ts",
  "src/core/application/ports/job-value-estimation-context-reader.ts",
  "src/core/application/services/lead-pricing/estimated-value-lead-pricing-context-reader.ts",
  "src/core/infrastructure/pricing/job-value-estimation-config.v1.ts",
  "src/core/infrastructure/database/prisma/repositories/prisma-job-value-estimation-context-reader.ts",
];
const code = (f: string) => readFileSync(path.join(root, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(path.join(dir, n)).isDirectory() ? walk(path.join(dir, n)) : [path.join(dir, n)]));

describe("Module 129 boundaries", () => {
  it.each(FILES)("%s has no payment / tax / legacy / affiliate / contact / external / AI dependency", (f) => {
    const src = code(f);
    expect(src).not.toMatch(/stripe|paymentintent|checkout/i);
    expect(src).not.toMatch(/commission|payout|affiliate|referral|invoice|credit-?note|\biva\b|\bvat\b/i);
    expect(src).not.toMatch(/quote-payment|LEGACY_QUOTE_PAYMENT|transaction-flow-guard|assertLegacy/);
    expect(src).not.toMatch(/lead-contact|GetLeadContact|contact-access/i);
    expect(src).not.toMatch(/\bfetch\(|axios|https?:\/\/|node:http|node:net|XMLHttpRequest/);
    expect(src).not.toMatch(/openai|anthropic|machine-?learning|tensorflow|\bllm\b/i);
    expect(src).not.toMatch(/pricing-calculation-service|domain\/services\/money"/);
  });

  it("the estimator and its helper do no floating-point money math and have no hidden inputs", () => {
    for (const f of ["src/core/domain/services/job-value-estimation.ts", "src/core/domain/services/fixed-point-decimal.ts"]) {
      const src = code(f);
      expect(src).not.toMatch(/parseFloat|Math\.|toFixed|\bNumber\(|Date\b|Math\.random|process\.env|\bprisma\b/);
      expect(src).not.toMatch(/\bimport\b[^;]*@\/(infrastructure|app)\//);
    }
  });

  it("the estimator is independent of the Lead pricing engine, and the engine knows nothing of the estimator", () => {
    expect(code("src/core/domain/services/job-value-estimation.ts")).not.toMatch(/lead-pricing|leadPrice|LeadPricing|lead-purchase/);
    expect(code("src/core/domain/services/lead-pricing.ts")).not.toMatch(/job-value-estimation|estimateJobValue/);
  });

  it("the estimator never references the customer budget", () => {
    for (const f of FILES) expect(code(f)).not.toMatch(/budgetMin|budgetMax|customerBudget|\bbudget\b/i);
  });

  it("the Prisma reader never selects contact, address, coordinates, customer, free-text or budget data", () => {
    const src = code("src/core/infrastructure/database/prisma/repositories/prisma-job-value-estimation-context-reader.ts");
    expect(src).not.toMatch(/\b(email|phone|street|address|addressId|latitude|longitude|postalCode|customer|customerId|budgetMin|budgetMax|firstName|lastName|title|description)\b/);
    expect(src).not.toMatch(/\.(create|update|delete|upsert)\w*\(/);
  });

  it("the adapter contains no estimation formula and no pricing logic", () => {
    const src = code("src/core/application/services/lead-pricing/estimated-value-lead-pricing-context-reader.ts");
    expect(src).not.toMatch(/calculateLeadPrice|rateBySlug|LEAD_PRICING_CONFIG|bigint|\d+n\b|baseValueBySlug/);
  });

  it("only the estimator, its adapter and the V1 fixture reference the estimator config; Module 132 moved the production wiring to the pilot snapshot; no route/page/action exposes it", () => {
    const files = walk(path.join(root, "src")).map((f) => path.relative(root, f).split(path.sep).join("/"));
    const users = files.filter((f) => /JOB_VALUE_ESTIMATION_CONFIG_V1|estimateJobValue\b/.test(readFileSync(path.join(root, f), "utf8")));
    expect(users.sort()).toEqual([
      "src/core/application/services/lead-pricing/estimated-value-lead-pricing-context-reader.ts",
      "src/core/domain/services/job-value-estimation.ts",
      "src/core/infrastructure/pricing/job-value-estimation-config.v1.ts",
    ]);
    // Module 132: production composition no longer imports the provisional V1 fixture.
    expect(readFileSync(path.join(root, "src/core/application/use-cases/lead-purchase/compose.ts"), "utf8")).not.toMatch(/JOB_VALUE_ESTIMATION_CONFIG_V1/);
    expect(files.filter((f) => f.startsWith("src/app/") && /job-value-estimation/i.test(readFileSync(path.join(root, f), "utf8")))).toEqual([]);
  });

  it("the purchase use case contains no estimation dependency", () => {
    expect(code("src/core/application/use-cases/lead-purchase/initiate-lead-purchase.use-case.ts")).not.toMatch(/job-value|estimateJobValue/);
  });

  it("Module 129 added no Prisma migration and no schema field for the estimate", () => {
    const migrations = readdirSync(path.join(root, "prisma/migrations")).filter((n) => /^\d{14}_/.test(n)).sort();
    // M133 added a later migration, so assert on THIS module's own name instead of "latest migration".
    expect(migrations.filter((n) => /_module_129_/.test(n))).toEqual([]);
    expect(readFileSync(path.join(root, "prisma/schema.prisma"), "utf8")).not.toMatch(/estimatedServiceValue/);
  });
});
