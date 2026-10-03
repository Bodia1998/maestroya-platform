import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Module 124 — static boundary contracts: Lead creation / publication /
 * preview must not reach legacy financial infrastructure, LeadPurchase,
 * pricing, affiliate, or the contact-access mechanism, and must not be
 * exposed through routes/actions yet. No migration is added by this module.
 */
const root = path.resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const useCaseDir = "src/core/application/use-cases/lead";
const m124Files = [
  ...readdirSync(path.join(root, useCaseDir)).map((f) => `${useCaseDir}/${f}`),
  "src/core/domain/repositories/lead-preview-repository.ts",
  "src/core/infrastructure/database/prisma/repositories/prisma-lead-preview-repository.ts",
  "src/core/infrastructure/database/prisma/repositories/prisma-lead-repository.ts",
];

describe("Module 124 boundaries", () => {
  it("lead workflows never import legacy quote/payment/commission/payout/invoice/affiliate/pricing code", () => {
    for (const f of m124Files) {
      // quote-eligibility is the pure category/radius helper (no financial logic), reused deliberately.
      const src = strip(read(f)).replace(/domain\/services\/quote-eligibility/g, "");
      expect(src, f).not.toMatch(/from "[^"]*(quote|payment|commission|payout|invoice|credit-note|affiliate|stripe|refund|pricing)[^"]*"/i);
      expect(src, f).not.toMatch(/\b(prisma|tx)\.(quote|payment|commission|payout|invoice|creditNote|refund|affiliate\w*|financialLedgerEntry)\b/);
    }
  });

  it("lead workflows never create or read LeadPurchase and never touch the Module 122 contact path", () => {
    for (const f of m124Files) {
      const src = strip(read(f));
      expect(src, f).not.toMatch(/leadPurchase|LeadPurchase/);
      expect(src, f).not.toMatch(/GetLeadContactUseCase|LeadContactReader|LeadContactAuthorizationReader|readContact\(/);
    }
  });

  it("preview port and repository reference no contact / address-line columns", () => {
    for (const f of [m124Files[m124Files.length - 3]!, m124Files[m124Files.length - 2]!]) {
      const src = strip(read(f));
      expect(src, f).not.toMatch(/\b(email|phone|line1|line2|addressLine\w*|postalCode|passwordHash|purchases)\b/i);
    }
  });

  it("no pricing engine concepts are introduced", () => {
    for (const f of m124Files) {
      expect(strip(read(f)), f).not.toMatch(/PricingEngine|LeadPriceCalculator|MarketRateEngine|LeadQualityScore|ComplexityFactor|UrgencyFactor|RegionalFactor/);
    }
  });

  it("legacy quote feed still excludes LEAD_V1 (filters on LEGACY_QUOTE_PAYMENT) and the lead feed is a separate repository", () => {
    const legacy = read("src/core/infrastructure/database/prisma/repositories/prisma-service-request-discovery-repository.ts");
    expect(legacy).toContain('LEGACY_FLOW = "LEGACY_QUOTE_PAYMENT"');
    expect((legacy.match(/flowVersion: LEGACY_FLOW/g) ?? []).length).toBe(2);
    expect(legacy).not.toMatch(/prisma\.lead/);
    const previewRepo = read("src/core/infrastructure/database/prisma/repositories/prisma-lead-preview-repository.ts");
    expect(previewRepo).toContain("flowVersion: LEAD_FLOW_VERSION");
    expect(previewRepo).not.toMatch(/LEGACY_QUOTE_PAYMENT/);
  });

  it("legacy use cases remain unaware of the lead workflows", () => {
    const files = walk(path.join(root, "src/core/application/use-cases"))
      .map((f) => path.relative(root, f).split(path.sep).join("/"))
      .filter((f) => /\/(quotes|payments|financial|invoicing|job|affiliate)\//.test(f));
    for (const f of files) expect(read(f), f).not.toMatch(/use-cases\/lead\//);
  });

  it("nothing under src/app exposes the lead workflows or preview repository yet", () => {
    const files = walk(path.join(root, "src/app")).map((f) => path.relative(root, f));
    const exposed = files.filter((f) => /CreateLeadUseCase|PublishLeadUseCase|GetPublishedLead|LeadPreviewRepository|PrismaLeadPreview/.test(read(f)));
    expect(exposed).toEqual([]);
  });

  it("Module 124 adds no migration", () => {
    const dirs = readdirSync(path.join(root, "prisma/migrations"));
    expect(dirs.filter((d) => /module_124/i.test(d))).toEqual([]);
  });
});
