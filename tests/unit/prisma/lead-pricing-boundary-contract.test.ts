import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Module 128 — static boundaries: the Lead pricing engine prices the Lead
 * only. No payment, legacy flow, affiliate, external call, AI or contact
 * access; no money floating point; no pricing formula in the purchase use case.
 */
const root = path.resolve(__dirname, "../../..");
const ENGINE = [
  "src/core/domain/services/lead-pricing.ts",
  "src/core/application/ports/lead-pricing-context-reader.ts",
  "src/core/application/services/lead-pricing/configured-lead-purchase-price-provider.ts",
  "src/core/infrastructure/pricing/lead-pricing-config.v1.ts",
  "src/core/infrastructure/database/prisma/repositories/prisma-lead-pricing-context-reader.ts",
];
const code = (f: string) => readFileSync(path.join(root, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(path.join(dir, n)).isDirectory() ? walk(path.join(dir, n)) : [path.join(dir, n)]));

describe("Module 128 boundaries", () => {
  it.each(ENGINE)("%s has no payment / legacy / affiliate / contact / external / AI dependency", (f) => {
    const src = code(f);
    expect(src).not.toMatch(/stripe|paymentintent|checkout/i);
    expect(src).not.toMatch(/commission|payout|affiliate|referral|invoice|credit-?note/i);
    expect(src).not.toMatch(/quote-payment|LEGACY_QUOTE_PAYMENT|transaction-flow-guard|assertLegacy/);
    expect(src).not.toMatch(/use-cases\/(payments|quotes|financial|invoicing)\//);
    expect(src).not.toMatch(/lead-contact|GetLeadContact|contact-access/i);
    expect(src).not.toMatch(/\bfetch\(|axios|https?:\/\/|node:http|node:net|XMLHttpRequest/);
    expect(src).not.toMatch(/openai|anthropic|machine-?learning|tensorflow|\bllm\b/i);
    expect(src).not.toMatch(/pricing-calculation-service|money"|domain\/services\/money/); // legacy Module 64 pricing + float money helpers
  });

  it("the engine does no floating-point money math and has no hidden inputs", () => {
    const src = code("src/core/domain/services/lead-pricing.ts");
    expect(src).not.toMatch(/parseFloat|Math\.|toFixed|\bNumber\(|Date\b|Math\.random|process\.env|\bprisma\b/);
    expect(src).not.toMatch(/\bimport\b[^;]*@\/(infrastructure|app)\//);
  });

  it("the Prisma reader never selects contact, address, coordinates, customer or budget data", () => {
    const src = code("src/core/infrastructure/database/prisma/repositories/prisma-lead-pricing-context-reader.ts");
    expect(src).not.toMatch(/\b(email|phone|street|address|latitude|longitude|postalCode|customer|customerId|budgetMin|budgetMax|firstName|lastName)\b/);
    expect(src).not.toMatch(/\.(create|update|delete|upsert)\w*\(/);
  });

  it("the purchase use case contains no pricing formula or pricing-config dependency", () => {
    const src = code("src/core/application/use-cases/lead-purchase/initiate-lead-purchase.use-case.ts");
    expect(src).not.toMatch(/lead-pricing|rateBySlug|estimatedServiceValue|calculateLeadPrice|LEAD_PRICING/);
    expect(src.replace(/^import .*$/gm, "")).not.toMatch(/\bprice\s*[*/+-]\s*[\w(]|[\w)]\s*[*/+-]\s*price\b/);
  });

  it("the price provider does not create purchases", () => {
    const src = code("src/core/application/services/lead-pricing/configured-lead-purchase-price-provider.ts");
    expect(src).not.toMatch(/LeadPurchaseRepository|\.initiate\(|\.create\(/);
  });

  it("only the lead-purchase composition root wires the concrete provider; no route/page/action exposes pricing", () => {
    const files = walk(path.join(root, "src")).map((f) => path.relative(root, f).split(path.sep).join("/"));
    const users = files.filter((f) => /ConfiguredLeadPurchasePriceProvider|LEAD_PRICING_CONFIG_V1|calculateLeadPrice/.test(readFileSync(path.join(root, f), "utf8")));
    expect(users.sort()).toEqual([
      "src/core/application/services/lead-pricing/configured-lead-purchase-price-provider.ts",
      "src/core/application/use-cases/lead-purchase/compose.ts",
      "src/core/domain/services/lead-pricing.ts",
      "src/core/infrastructure/pricing/lead-pricing-config.v1.ts",
    ]);
    expect(files.filter((f) => f.startsWith("src/app/") && /lead-pricing|pricing-config/i.test(readFileSync(path.join(root, f), "utf8")))).toEqual([]);
  });

  it("legacy pricing/commission sources were not touched to support Module 128", () => {
    for (const f of ["src/core/domain/services/commission-calculation-service.ts", "src/core/domain/services/pricing-calculation-service.ts"]) {
      expect(readFileSync(path.join(root, f), "utf8")).not.toMatch(/lead-pricing|LeadPurchase/);
    }
  });

  it("Module 128 added no Prisma migration", () => {
    const migrations = readdirSync(path.join(root, "prisma/migrations")).filter((n) => /^\d{14}_/.test(n)).sort();
    expect(migrations.at(-1)).toBe("20261002000000_add_module_123_lead_and_lead_purchase");
  });
});
