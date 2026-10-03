import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Module 126 — static boundary: the LeadPurchase lifecycle is the
 * professional-pays-MaestroYa world only. It must not touch Stripe, the
 * legacy quote/payment/commission/payout flow, affiliates or any pricing engine,
 * and its confirmation/transition use cases must not be reachable from the browser.
 */
const root = path.resolve(__dirname, "../../..");
const FILES = [
  "src/core/domain/services/lead-purchase.ts",
  "src/core/domain/repositories/lead-purchase-repository.ts",
  "src/core/infrastructure/database/prisma/repositories/prisma-lead-purchase-repository.ts",
  "src/core/application/dto/lead-purchase.dto.ts",
  "src/core/application/ports/lead-purchase-price-provider.ts",
  "src/core/application/use-cases/lead-purchase/initiate-lead-purchase.use-case.ts",
  "src/core/application/use-cases/lead-purchase/confirm-lead-purchase.use-case.ts",
  "src/core/application/use-cases/lead-purchase/transition-lead-purchase.use-case.ts",
];
const code = (f: string) => readFileSync(path.join(root, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe("Module 126 boundaries", () => {
  it.each(FILES)("%s imports nothing from Stripe / legacy payments / commission / payout / affiliate / pricing", (f) => {
    const src = code(f);
    expect(src).not.toMatch(/stripe/i);
    expect(src).not.toMatch(/commission/i);
    expect(src).not.toMatch(/payout/i);
    expect(src).not.toMatch(/affiliate|referral/i);
    expect(src).not.toMatch(/pricing-calculation-service|PricingEngine|pricing-engine/i);
    expect(src).not.toMatch(/use-cases\/(payments|quotes|financial|invoicing)\//);
    expect(src).not.toMatch(/\b(prisma|tx)\.(quote|payment|commission|payout|invoice|creditNote|refund|financialLedgerEntry)\b/);
    expect(src).not.toMatch(/transaction-flow-guard|assertLegacy/); // LEAD_V1 world: legacy guard is not used here
  });

  it("price is never computed with arithmetic in the lifecycle code", () => {
    for (const f of FILES.filter((x) => x.includes("use-cases"))) {
      const src = code(f).replace(/^import .*$/gm, "");
      expect(src).not.toMatch(/\bprice\s*[*/+-]\s*[\w(]|[\w)]\s*[*/+-]\s*price\b/);
    }
  });

  it("no route, page or Server Action exposes confirm / transition (client cannot mark itself paid)", () => {
    const files = walk(path.join(root, "src")).map((f) => path.relative(root, f).split(path.sep).join("/"));
    const exposed = files.filter(
      (f) => !f.startsWith("src/core/") && /ConfirmLeadPurchase|TransitionLeadPurchase|confirm-lead-purchase|transition-lead-purchase/.test(readFileSync(path.join(root, f), "utf8")),
    );
    expect(exposed).toEqual([]);
  });

  it("only the Module 126 use cases (and the repository) write lead purchase status", () => {
    const files = walk(path.join(root, "src")).map((f) => path.relative(root, f).split(path.sep).join("/"));
    const writers = files.filter((f) => /\.transition\(/.test(readFileSync(path.join(root, f), "utf8")) && /leadPurchases?|purchases/.test(readFileSync(path.join(root, f), "utf8")));
    expect(writers.sort()).toEqual([
      "src/core/application/use-cases/lead-purchase/confirm-lead-purchase.use-case.ts",
      "src/core/application/use-cases/lead-purchase/transition-lead-purchase.use-case.ts",
    ]);
  });

  it("Module 122 is untouched: no adapter implements its ports and the policy still has only the CONFIRMED allow path", () => {
    const policy = code("src/core/domain/services/lead-contact-access-policy.ts");
    expect(policy.match(/return \{ allowed: true \}/g)).toHaveLength(1);
    expect(policy).toContain('facts.grant.state !== "CONFIRMED"');
  });

  it("no new Prisma migration was added by Module 126", () => {
    const migrations = readdirSync(path.join(root, "prisma/migrations")).filter((n) => /^\d{14}_/.test(n)).sort();
    expect(migrations.at(-1)).toBe("20261002000000_add_module_123_lead_and_lead_purchase");
  });
});
