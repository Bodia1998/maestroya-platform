import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Module 142 — static contracts for the customer LEAD_V1 request UI.
 * Coarse on purpose (imports / call sites), like the Module 125 contracts.
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

const UI = "src/app/(dashboard)/requests/new/lead";
const ACTION = `${UI}/actions.ts`;
const FORM = `${UI}/lead-request-form.tsx`;
const PAGE = `${UI}/page.tsx`;
const USE_CASES = [
  "src/core/application/use-cases/lead-request/submit-lead-request.use-case.ts",
  "src/core/application/use-cases/lead-request/list-lead-request-categories.use-case.ts",
];

describe("Module 142 customer LEAD_V1 request UI boundaries", () => {
  it("the client form imports no server, persistence, payment or pricing code", () => {
    const src = strip(read(FORM));
    expect(src).toMatch(/^"use client"/);
    expect(src).not.toMatch(/prisma|@\/infrastructure|stripe|pricing|LeadPurchase|compose|requireAuth/i);
  });

  it("the form never names identity, flow or lifecycle fields", () => {
    const src = strip(read(FORM));
    expect(src).not.toMatch(/customerId|userId|flowVersion|LEAD_V1|professionalId|leadId|maxBuyers|buyerPolicy/);
  });

  it("the action and page stay thin: no repositories, Prisma, payment, pricing or LEAD_V1 selection", () => {
    for (const f of [ACTION, PAGE]) {
      const src = strip(read(f));
      expect(src, f).not.toMatch(/Prisma\w*Repository|@\/infrastructure\/database|@prisma\/client|stripe|LeadPurchase/i);
      expect(src, f).not.toMatch(/from "[^"]*(quote|payment|commission|payout|invoice|affiliate|pricing)[^"]*"/i);
      expect(src, f).not.toMatch(/LEAD_V1|LEAD_FLOW_VERSION|flowVersion/);
    }
    expect(strip(read(ACTION))).toMatch(/requireAuth\(\)/);
  });

  it("the action returns the explicit receipt, never a lead / purchase / payment record", () => {
    const src = strip(read(ACTION));
    expect(src).not.toMatch(/paymentReference|clientSecret|client_secret|professional\w*(Phone|Email|Address)|pricingSnapshot|buyerPolicy/);
    expect(src).toMatch(/receipt/);
  });

  it("only the Lead Marketplace use case selects LEAD_V1; the M142 use cases delegate to it", () => {
    for (const f of USE_CASES) expect(strip(read(f)), f).not.toMatch(/flowVersion|LEAD_FLOW_VERSION|"LEAD_V1"/);
    const files = [...walk(path.join(root, "src/core/application")), ...walk(path.join(root, "src/app"))].map((f) => path.relative(root, f).split(path.sep).join("/"));
    const selecting = files.filter((f) => /flowVersion:\s*(LEAD_FLOW_VERSION|"LEAD_V1")/.test(strip(read(f))));
    expect(selecting).toEqual(["src/core/application/use-cases/lead/create-lead-v1-service-request.use-case.ts"]);
  });

  it("the legacy request creation path is untouched and stays flow-agnostic", () => {
    for (const f of [
      "src/core/application/use-cases/service-request/create-service-request.use-case.ts",
      "src/app/(dashboard)/requests/actions.ts",
      "src/app/(dashboard)/requests/service-request-form.tsx",
      "src/app/(dashboard)/requests/new/page.tsx",
    ]) {
      expect(strip(read(f)), f).not.toMatch(/lead-request|leadRequest|LEAD_V1|LEAD_FLOW_VERSION|submitLeadRequest/);
    }
  });

  it("the legacy DTO is not changed to carry the lead rules", () => {
    expect(strip(read("src/core/application/dto/service-request.dto.ts"))).not.toMatch(/normalizeFreeText|leadRequest/);
  });

  it("the supported-category rule is derived from the M132 configuration, with no second category list", () => {
    const policy = strip(read("src/core/domain/services/lead-request-category-support.ts"));
    expect(policy).toMatch(/pilotCategorySlugs/);
    expect(policy).not.toMatch(/"(fontaneria|electricidad|aire-acondicionado|pintura|montaje-de-muebles|reformas)"/);
    for (const f of [FORM, PAGE, ACTION, ...USE_CASES]) {
      expect(strip(read(f)), f).not.toMatch(/"(fontaneria|electricidad|aire-acondicionado|pintura|montaje-de-muebles|reformas)"/);
    }
  });

  it("no pricing arithmetic or configuration is read in the UI layer", () => {
    for (const f of [FORM, PAGE, ACTION]) {
      expect(strip(read(f)), f).not.toMatch(/calculateLeadPrice|estimateJobValue|rateBySlug|baseValueBySlug|configVersion|LEAD_PRICING/);
    }
  });

  it("adds no migration", () => {
    expect(readdirSync(path.join(root, "prisma/migrations")).filter((d) => /module_142/i.test(d))).toEqual([]);
    expect(existsSync(path.join(root, UI))).toBe(true);
  });
});
