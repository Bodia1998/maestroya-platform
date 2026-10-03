import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Module 125 — static contracts for the LEAD_V1 entry path. Intentionally
 * coarse (import paths and a few call sites) so harmless reorganisation does
 * not break them.
 */
const root = path.resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const walk = (dir: string, out: string[] = []): string[] => {
  for (const n of readdirSync(dir)) {
    const f = path.join(dir, n);
    if (statSync(f).isDirectory()) walk(f, out);
    else if (/\.(ts|tsx)$/.test(n)) out.push(f);
  }
  return out;
};
const rel = (f: string) => path.relative(root, f).split(path.sep).join("/");

const ENTRY_FILES = [
  "src/core/application/use-cases/lead/create-lead-v1-service-request.use-case.ts",
  "src/core/application/use-cases/lead/compose.ts",
  "src/app/(dashboard)/requests/lead-actions.ts",
  "src/app/(dashboard)/dashboard/professional/leads/actions.ts",
];
const REPO = "src/core/infrastructure/database/prisma/repositories/prisma-service-request-repository.ts";

describe("Module 125 LEAD_V1 entry boundaries", () => {
  it("entry code never imports quote/payment/commission/payout/invoice/affiliate/stripe/pricing code", () => {
    for (const f of ENTRY_FILES) {
      const src = strip(read(f));
      expect(src, f).not.toMatch(/from "[^"]*(quote|payment|commission|payout|invoice|affiliate|stripe|refund|pricing|self-billing)[^"]*"/i);
      expect(src, f).not.toMatch(/LeadPurchase|transactionFlowGuard/);
    }
  });

  it("the LEAD_V1 use case sets the flow from the LEAD_FLOW_VERSION constant, never from input", () => {
    const src = strip(read(ENTRY_FILES[0]!));
    expect(src).toMatch(/flowVersion:\s*LEAD_FLOW_VERSION/);
    expect(src).not.toMatch(/input\.flowVersion|\.flowVersion\s*=\s*input/);
  });

  it("the legacy creation use case and its action stay flow-agnostic (no LEAD_V1 selection)", () => {
    for (const f of [
      "src/core/application/use-cases/service-request/create-service-request.use-case.ts",
      "src/app/(dashboard)/requests/actions.ts",
    ]) {
      expect(strip(read(f)), f).not.toMatch(/LEAD_V1|LEAD_FLOW_VERSION|flowVersion/);
    }
  });

  it("only the Lead Marketplace use case passes LEAD_V1 when creating a ServiceRequest (application + entry layers)", () => {
    const files = [...walk(path.join(root, "src/core/application")), ...walk(path.join(root, "src/app"))].map(rel);
    const selecting = files.filter((f) => /flowVersion:\s*(LEAD_FLOW_VERSION|"LEAD_V1")/.test(strip(read(f))));
    expect(selecting).toEqual([ENTRY_FILES[0]]);
  });

  it("the repository writes the flow explicitly (no reliance on the DB default)", () => {
    expect(strip(read(REPO))).toMatch(/flowVersion:\s*data\.flowVersion\s*\?\?\s*DEFAULT_TRANSACTION_FLOW_VERSION/);
  });

  it("Server Actions stay thin: no repositories, Prisma or domain rules", () => {
    for (const f of ENTRY_FILES.slice(2)) {
      const src = strip(read(f));
      expect(src, f).not.toMatch(/Prisma\w*Repository|@\/infrastructure\/database|@prisma\/client/);
      expect(src, f).toMatch(/requireAuth\(\)/);
    }
  });

  it("legacy financial use cases remain unaware of the lead entry", () => {
    const files = walk(path.join(root, "src/core/application/use-cases")).map(rel).filter((f) => /\/(quotes|payments|financial|invoicing|job|affiliate)\//.test(f));
    for (const f of files) expect(read(f), f).not.toMatch(/use-cases\/lead\//);
  });

  it("Module 125 adds no migration", () => {
    expect(readdirSync(path.join(root, "prisma/migrations")).filter((d) => /module_125/i.test(d))).toEqual([]);
  });
});
