import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../../..");
const dir = "src/app/(dashboard)/dashboard/professional/leads";
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const UI_FILES = ["page.tsx", "lead-marketplace.tsx", "lead-card.tsx", "lead-purchase-entry.ts", "loading.tsx"].map((f) => `${dir}/${f}`);

/** Module 143 — static guarantees: the marketplace UI is a thin presentation layer over the M134 action. */
describe("M143 — professional lead marketplace UI boundary", () => {
  it("all UI files exist", () => {
    for (const file of UI_FILES) expect(existsSync(path.join(root, file)), file).toBe(true);
  });

  it("imports no Prisma/infrastructure, repository, Stripe, payment, purchase or contact-unlock code", () => {
    for (const file of UI_FILES) {
      const code = strip(read(file));
      expect(code, file).not.toMatch(/@prisma|@\/infrastructure\/database|Prisma\w*Repository|stripe/i);
      expect(code, file).not.toMatch(/payment-actions|initiateLeadFeePayment|lead-fee-payment|lead-purchase\/compose|ConfirmLeadPurchase|TransitionLeadPurchase/);
      expect(code, file).not.toMatch(/getLeadContactAction|makeGetLeadContactUseCase|lead-contact\/compose/);
    }
  });

  it("the client components reach the backend only through the M134 getLeadFeedAction", () => {
    const marketplace = strip(read(`${dir}/lead-marketplace.tsx`));
    expect(marketplace).toContain('import { getLeadFeedAction } from "./actions"');
    expect(marketplace).not.toMatch(/from "@\/application\/use-cases/);
    expect(strip(read(`${dir}/lead-card.tsx`))).not.toMatch(/from "\.\/(actions|payment-actions)"/);
  });

  it("the page reads identity from the session and builds no feed/filter/identity input of its own", () => {
    const page = strip(read(`${dir}/page.tsx`));
    expect(page).toContain("await requireAuth()");
    expect(page).toContain("getLeadFeedAction()");
    expect(page).not.toMatch(/searchParams|params\b|professionalId|userId|customerId/);
  });

  it("the card reads explicit safe fields (no spread of the item) and does no business arithmetic", () => {
    const card = strip(read(`${dir}/lead-card.tsx`));
    expect(card).not.toMatch(/\.\.\.item|\{\.\.\.props\}/);
    expect(card).not.toMatch(/item\.price\s*[*+\-/]|Number\(item\.price\)\s*[*+\-/]|taxRate|commission|estimate/i);
    expect(card).not.toMatch(/paymentReference|clientSecret|customerUserId|customerId|email|phone|passwordHash/);
  });

  it("the purchase CTA seam only builds the Module 144 checkout href (no import, no action wired)", () => {
    const entry = strip(read(`${dir}/lead-purchase-entry.ts`));
    expect(entry).toContain("/dashboard/professional/leads/${encodeURIComponent(leadId)}/purchase");
    expect(entry).not.toMatch(/import |action|fetch|stripe/i);
  });

  it("the guarded read-only actions.ts is untouched by the UI (still exactly the M125/M134/M138 entry points)", () => {
    const actions = strip(read(`${dir}/actions.ts`));
    const names = [...actions.matchAll(/export async function (\w+)\(/g)].map((m) => m[1]).sort();
    expect(names).toEqual(["getLeadContactAction", "getLeadFeedAction", "getLeadPreviewAction", "getLeadPreviewsAction"]);
  });

  it("adds no migration and the nav links to the marketplace", () => {
    expect(readdirSync(path.join(root, "prisma/migrations")).filter((d) => /module_143/i.test(d))).toEqual([]);
    expect(read("src/shared/utils/build-dashboard-nav-groups.ts")).toContain('"/dashboard/professional/leads"');
  });
});
