import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Module 132 — static boundaries for the LEAD_V1 production pricing
 * configuration contract. Stable across future implementations: they pin WHO
 * may use the configuration and WHAT it may never do, not how it is written.
 */
const root = path.resolve(__dirname, "../../..");
const read = (f: string) => readFileSync(path.join(root, f), "utf8");
const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(path.join(dir, n)).isDirectory() ? walk(path.join(dir, n)) : [path.join(dir, n)]));
const srcFiles = () => walk(path.join(root, "src")).map((f) => path.relative(root, f).split(path.sep).join("/"));

const CONTRACT = "src/core/domain/services/lead-pricing-production-config.ts";
const PILOT = "src/core/infrastructure/pricing/lead-pricing-pilot-config.v1.ts";
const RESOLVER = "src/core/infrastructure/pricing/lead-pricing-production-config-resolver.ts";

describe("Module 132 production pricing configuration boundaries", () => {
  it("the contract and pilot snapshot are pure data/validation: no float money, clock, randomness, env or I/O", () => {
    for (const f of [CONTRACT, PILOT]) {
      const src = code(f);
      expect(src, f).not.toMatch(/parseFloat|Math\.|toFixed|\bNumber\(|Date\b|Math\.random|process\.env|\bprisma\b|\bfetch\(|node:fs/);
      expect(src, f).not.toMatch(/@\/(app|lib)\//);
    }
    expect(code(CONTRACT)).not.toMatch(/@\/infrastructure\//);
  });

  it("only compose (via env) and the resolver (error-message variable name) know the version selector; the resolver never reads env", () => {
    const users = srcFiles().filter((f) => /LEAD_PRICING_CONFIG_VERSION/.test(code(f)));
    expect(users.sort()).toEqual([
      "src/core/application/use-cases/lead-purchase/compose.ts",
      "src/core/infrastructure/config/env.ts",
      RESOLVER,
    ].sort());
    expect(code(RESOLVER)).not.toMatch(/process\.env|@\/infrastructure\/config\/env/);
  });

  it("production sources never import test fixtures or the Module 128/129 provisional configs", () => {
    for (const f of [RESOLVER, PILOT, CONTRACT, "src/core/application/use-cases/lead-purchase/compose.ts"]) {
      const src = code(f);
      expect(src, f).not.toMatch(/tests\/|test-utils|lead-pricing-test-config|LEAD_PRICING_TEST_CONFIG/);
      expect(src, f).not.toMatch(/LEAD_PRICING_CONFIG_V1|JOB_VALUE_ESTIMATION_CONFIG_V1|lead-pricing-config\.v1|job-value-estimation-config\.v1/);
    }
    expect(srcFiles().filter((f) => /from "[^"]*(test-utils|\/tests\/|lead-pricing-test-config)[^"]*"/.test(code(f)))).toEqual([]);
  });

  it("the production registry contains no TEST_ONLY snapshot and no default fallback", () => {
    expect(code(PILOT)).toMatch(/profile: "PILOT_PRODUCTION"/);
    expect(code(PILOT)).not.toMatch(/TEST_ONLY/);
    const resolver = code(RESOLVER);
    expect(resolver).not.toMatch(/TEST_ONLY|\?\?\s*LEAD_PRICING|\|\|\s*LEAD_PRICING_PILOT/);
    const compose = code("src/core/application/use-cases/lead-purchase/compose.ts");
    expect(compose).toMatch(/loadLeadPricingProductionConfigOrThrow\(env\.LEAD_PRICING_CONFIG_VERSION\)/);
    expect(compose).not.toMatch(/catch\s*[({]/);
  });

  it("only LEAD_V1 lead-purchase pricing consumes the contract; legacy and every other flow do not", () => {
    const users = srcFiles().filter((f) => /lead-pricing-production-config|lead-pricing-pilot-config|LEAD_PRICING_PILOT_CONFIG|LeadPricingProductionConfig/.test(code(f)));
    expect(users.sort()).toEqual([
      "src/core/application/use-cases/lead-purchase/compose.ts",
      CONTRACT,
      PILOT,
      RESOLVER,
    ].sort());
    for (const f of [
      "src/core/domain/services/commission-calculation-service.ts",
      "src/core/domain/services/pricing-calculation-service.ts",
      "src/core/application/services/flow/transaction-flow-guard.ts",
      "src/core/domain/services/transaction-flow.ts",
    ]) {
      expect(read(f), f).not.toMatch(/lead-pricing|LeadPricing|LEAD_PRICING|LeadPurchase/);
    }
  });

  it("the shared decimal parser and engines still contain no floating-point money math", () => {
    for (const f of ["src/core/domain/services/lead-pricing.ts", "src/core/domain/services/job-value-estimation.ts", "src/core/domain/services/fixed-point-decimal.ts"]) {
      expect(code(f), f).not.toMatch(/parseFloat|Math\.|toFixed|\bNumber\(|Date\b|Math\.random|process\.env/);
    }
  });

  it("Module 132 added no Prisma migration", () => {
    const migrations = readdirSync(path.join(root, "prisma/migrations")).filter((n) => /^\d{14}_/.test(n)).sort();
    expect(migrations.at(-1)).toBe("20261002000000_add_module_123_lead_and_lead_purchase");
  });

  it("the env selector is documented in .env.example and has no default in env.ts", () => {
    expect(read(".env.example")).toMatch(/^LEAD_PRICING_CONFIG_VERSION=/m);
    expect(code("src/core/infrastructure/config/env.ts")).toMatch(/LEAD_PRICING_CONFIG_VERSION: z\.preprocess\(emptyStringToUndefined, z\.string\(\)\.optional\(\)\)/);
  });
});
