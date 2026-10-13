import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Module 163 — static boundaries. The questionnaire is a pure, separate,
 * decision-independent capability: no budget, free text, payment, tax, legacy,
 * affiliate, contact or external dependency, no money floating point, no
 * persistence change, and no active factor table until the owner approves one.
 */
const root = path.resolve(__dirname, "../../..");
const QUESTIONNAIRE = "src/core/domain/services/lead-scope-questionnaire.ts";
const REGISTRY = "src/core/infrastructure/pricing/lead-scope-questionnaires.v1.ts";
const ESTIMATOR = "src/core/domain/services/job-value-estimation.ts";
const code = (f: string) => readFileSync(path.join(root, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(path.join(dir, n)).isDirectory() ? walk(path.join(dir, n)) : [path.join(dir, n)]));

describe("Module 163 boundaries", () => {
  it.each([QUESTIONNAIRE, REGISTRY])("%s has no payment / tax / legacy / affiliate / contact / budget / external / AI dependency", (f) => {
    const src = code(f);
    expect(src).not.toMatch(/stripe|paymentintent|checkout/i);
    expect(src).not.toMatch(/commission|payout|affiliate|referral|invoice|credit-?note|\biva\b|\bvat\b/i);
    expect(src).not.toMatch(/quote-payment|LEGACY_QUOTE_PAYMENT|transaction-flow-guard|assertLegacy/);
    expect(src).not.toMatch(/lead-contact|GetLeadContact|contact-access/i);
    expect(src).not.toMatch(/budgetMin|budgetMax|customerBudget|\bbudget\b/i);
    expect(src).not.toMatch(/\bfetch\(|axios|https?:\/\/|node:http|node:net|XMLHttpRequest/);
    expect(src).not.toMatch(/openai|anthropic|machine-?learning|tensorflow|\bllm\b/i);
    expect(src).not.toMatch(/\bprisma\b|process\.env|Date\b|Math\.random/);
  });

  it("the questionnaire does no floating-point math and never parses free text", () => {
    const src = code(QUESTIONNAIRE);
    expect(src).not.toMatch(/parseFloat|Math\.|toFixed|\bNumber\(|JSON\.parse|new RegExp|\.split\(/);
    expect(src).not.toMatch(/\bimport\b[^;]*@\/(infrastructure|app|application)\//);
  });

  it("the questionnaire knows nothing of the estimator or the pricing engine, and neither reads the registry", () => {
    expect(code(QUESTIONNAIRE)).not.toMatch(/job-value-estimation|estimateJobValue|lead-pricing|calculateLeadPrice/);
    expect(code(ESTIMATOR)).not.toMatch(/lead-scope-questionnaire|LEAD_SCOPE_QUESTIONNAIRES/);
    expect(code("src/core/domain/services/lead-pricing.ts")).not.toMatch(/lead-scope-questionnaire|structuredScope/);
  });

  it("the active registry is empty (no factor table without owner approval) and is imported only by composition roots", () => {
    expect(code(REGISTRY)).toMatch(/Object\.freeze\(\{\}\)/);
    const importers = walk(path.join(root, "src"))
      .map((f) => path.relative(root, f).split(path.sep).join("/"))
      .filter((f) => readFileSync(path.join(root, f), "utf8").includes("LEAD_SCOPE_QUESTIONNAIRES_V1") && f !== REGISTRY);
    expect(importers.sort()).toEqual([
      "src/core/application/use-cases/lead-publication/scope-estimation-source.ts",
      "src/core/application/use-cases/lead-request/compose.ts",
    ]);
  });

  it("structured scope is confined to the questionnaire module, the estimator and the pricing/submission plumbing", () => {
    const users = walk(path.join(root, "src"))
      .map((f) => path.relative(root, f).split(path.sep).join("/"))
      .filter((f) => /structuredScope|deriveStructuredScope|evaluateScopeAnswers/.test(readFileSync(path.join(root, f), "utf8")));
    expect(users.sort()).toEqual(
      [
        ESTIMATOR,
        QUESTIONNAIRE,
        "src/core/application/services/lead-pricing/estimated-value-lead-pricing-context-reader.ts",
        "src/core/application/dto/lead-request.dto.ts",
        "src/core/application/use-cases/lead-request/submit-lead-request.use-case.ts",
      ].sort(),
    );
  });

  it("the estimator context still has no budget field, and the ceiling check and fail-closed reasons are intact", () => {
    const src = code(ESTIMATOR);
    expect(src).not.toMatch(/budgetMin|budgetMax|customerBudget|\bbudget\b/i);
    expect(src).toContain("VALUE_EXCEEDS_CEILING");
    expect(src).toContain("INVALID_SCOPE");
  });

  it("the M163 migration is additive and the schema carries the provenance fields", () => {
    const dirs = readdirSync(path.join(root, "prisma/migrations")).filter((n) => /_module_163_/.test(n));
    expect(dirs).toHaveLength(1);
    const sql = readFileSync(path.join(root, "prisma/migrations", dirs[0]!, "migration.sql"), "utf8").replace(/^--.*$/gm, "");
    expect(sql).not.toMatch(/DROP\s+(TABLE|COLUMN)|TRUNCATE|DELETE\s+FROM|ALTER\s+COLUMN/i);
    expect(readFileSync(path.join(root, "prisma/schema.prisma"), "utf8")).toMatch(/scopeAnswers/);
  });

  it("the submission and publication wiring carries the scope, and the estimator stays registry-free", () => {
    for (const f of [
      "src/core/application/use-cases/lead-publication/compose.ts",
      "src/core/application/use-cases/lead-purchase/compose.ts",
      "src/core/application/use-cases/lead-request/compose.ts",
      "src/core/application/services/lead-pricing/estimated-value-lead-pricing-context-reader.ts",
    ]) {
      expect(code(f)).toMatch(/scope/i);
    }
    expect(code("src/core/application/use-cases/lead-request/submit-lead-request.use-case.ts")).not.toMatch(/LEAD_FLOW_VERSION/);
  });
});
