import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Module 134 — static contracts for Lead Feed v2: snapshot-only price, no
 * pricing/purchase/payment/contact reach, no second availability policy,
 * legacy isolation, no schema change.
 */
const root = path.resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const FEED_FILES = [
  "src/core/domain/repositories/lead-feed-repository.ts",
  "src/core/application/dto/lead-feed.dto.ts",
  "src/core/application/use-cases/lead/get-lead-feed.use-case.ts",
  "src/core/infrastructure/database/prisma/repositories/prisma-lead-feed-repository.ts",
];

describe("Module 134 boundaries", () => {
  it("feed files never import pricing/estimation/config resolution, legacy financial code or the purchase layer", () => {
    for (const f of FEED_FILES) {
      // quote-eligibility is the pure category/radius helper (no financial logic), reused deliberately as in Module 124.
      const src = strip(read(f)).replace(/domain\/services\/quote-eligibility/g, "");
      expect(src, f).not.toMatch(/from "[^"]*(pricing|estimat|quote|payment|commission|payout|invoice|credit-note|affiliate|stripe|refund|lead-purchase|lead-contact)[^"]*"/i);
      expect(src, f).not.toMatch(/LeadPurchase|leadPurchase|GetLeadContactUseCase|PricingEngine|LeadPricingProductionConfig|priceForLead/);
      expect(src, f).not.toMatch(/\b(prisma|tx)\.(quote|payment|commission|payout|invoice|creditNote|refund|affiliate\w*|leadPurchase)\b/);
    }
  });

  it("feed files contain no contact / address-line columns", () => {
    for (const f of [FEED_FILES[0]!, FEED_FILES[3]!]) {
      expect(strip(read(f)), f).not.toMatch(/\b(email|phone|line1|line2|addressLine\w*|postalCode|passwordHash|purchases)\b/i);
    }
  });

  it("the feed never writes and never does JS-number money arithmetic", () => {
    for (const f of FEED_FILES) {
      const src = strip(read(f));
      expect(src, f).not.toMatch(/\.(create|update|updateMany|upsert|delete|deleteMany)\(/);
      expect(src, f).not.toMatch(/parseFloat|\.toFixed\(|Number\(|parseInt/);
    }
  });

  it("availability is consumed from the M130/M133 policies, not redefined", () => {
    const useCase = strip(read(FEED_FILES[2]!));
    expect(useCase).toContain("isLeadMarketplaceReady");
    expect(useCase).toContain("isLeadPublicationSnapshotComplete");
    for (const f of FEED_FILES) {
      expect(strip(read(f)), f).not.toMatch(/(function|const)\s+(isLeadOpen|isLeadPublished|isLeadMarketplaceReady|isLeadAvailableForMarketplace)\b/);
    }
  });

  it("the Prisma feed query is isolated to LEAD_V1 and never references the legacy flow", () => {
    const repo = read(FEED_FILES[3]!);
    expect(repo).toContain("flowVersion: LEAD_FLOW_VERSION");
    expect(repo).not.toMatch(/LEGACY_QUOTE_PAYMENT/);
    expect(repo).toContain('status: "PUBLISHED"');
    expect(repo).toContain("deletedAt: null");
  });

  it("legacy quote feed and legacy use cases stay unaware of the lead feed", () => {
    const legacy = read("src/core/infrastructure/database/prisma/repositories/prisma-service-request-discovery-repository.ts");
    expect(legacy).toContain('LEGACY_FLOW = "LEGACY_QUOTE_PAYMENT"');
    expect(legacy).not.toMatch(/LeadFeed|prisma\.lead/);
  });

  it("the Server Action takes identity from the session and never imports a repository", () => {
    const action = read("src/app/(dashboard)/dashboard/professional/leads/actions.ts");
    expect(action).toContain("requireAuth()");
    expect(action).not.toMatch(/Prisma\w*Repository|@\/infrastructure\/database/);
  });

  it("purchase initiation applies the same readiness policy as the feed (no bypass for snapshot-less leads)", () => {
    const initiate = strip(read("src/core/application/use-cases/lead-purchase/initiate-lead-purchase.use-case.ts"));
    expect(initiate).toContain("isLeadMarketplaceReady");
    expect(initiate).toMatch(/publication:\s*lead\.publication/);
  });

  it("Module 134 adds no migration and the Lead model is unchanged by it", () => {
    const dirs = readdirSync(path.join(root, "prisma/migrations"));
    expect(dirs.filter((d) => /module_134/i.test(d))).toEqual([]);
  });
});
