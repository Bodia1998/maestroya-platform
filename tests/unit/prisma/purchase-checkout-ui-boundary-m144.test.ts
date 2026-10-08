import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Module 144 — static guarantees. The checkout UI is a thin presentation/orchestration layer over
 * the EXISTING M126/M135 purchase initiation, M140 payment initiation, M141 webhook confirmation
 * and M138 contact unlock. It adds no schema, no payment/tax/lifecycle/contact logic and no
 * client-side trust.
 */
const root = path.resolve(__dirname, "../../..");
const leadsDir = "src/app/(dashboard)/dashboard/professional/leads";
const dir = `${leadsDir}/[leadId]/purchase`;
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const CLIENT_FILES = ["purchase-checkout.tsx", "checkout-summary.tsx", "checkout-view.ts", "contact-reveal.tsx", "stripe-payment-form.tsx", "use-purchase-status-polling.ts"].map((f) => `${dir}/${f}`);
const SERVER_FILES = [`${dir}/page.tsx`, `${dir}/actions.ts`, `${dir}/loading.tsx`];
const ALL_UI = [...CLIENT_FILES, ...SERVER_FILES];

function walk(d: string): string[] {
  return readdirSync(d).flatMap((n) => {
    const p = path.join(d, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe("M144 — files and wiring", () => {
  it("all UI files exist", () => {
    for (const file of ALL_UI) expect(existsSync(path.join(root, file)), file).toBe(true);
  });

  it("the marketplace CTA seam now points at the checkout route (and only that changed there)", () => {
    const entry = strip(read(`${leadsDir}/lead-purchase-entry.ts`));
    expect(entry).toContain("/dashboard/professional/leads/${encodeURIComponent(leadId)}/purchase");
    expect(entry).not.toMatch(/import |fetch|action|stripe/i);
  });

  it("adds no migration and no schema change", () => {
    expect(readdirSync(path.join(root, "prisma/migrations")).filter((d) => /module_144/i.test(d))).toEqual([]);
  });
});

describe("M144 — no infrastructure, Prisma, Stripe server SDK or secret in the UI", () => {
  it("UI files import no Prisma / repository / Stripe server SDK / gateway", () => {
    for (const file of ALL_UI) {
      const code = strip(read(file));
      expect(code, file).not.toMatch(/@prisma|@\/infrastructure\/database|Prisma\w*Repository/);
      expect(code, file).not.toMatch(/from "stripe"|infrastructure\/payments|StripeLeadFeePaymentGateway|PaymentGateway/);
      expect(code, file).not.toMatch(/STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|STRIPE_PAYMENTS_WEBHOOK_SECRET|sk_(live|test)_/);
      expect(code, file).not.toMatch(/paymentIntents|payment_intents|PaymentIntent\.create|new Stripe\(/);
    }
  });

  it("client components load only the PUBLISHABLE Stripe libraries and receive the key as a prop", () => {
    const form = strip(read(`${dir}/stripe-payment-form.tsx`));
    expect(form).toContain('from "@stripe/stripe-js"');
    expect(form).toContain('from "@stripe/react-stripe-js"');
    expect(form).toContain("loadStripe(publishableKey)");
    const page = strip(read(`${dir}/page.tsx`));
    expect(page).toContain("env.STRIPE_PUBLISHABLE_KEY");
    expect(page).not.toMatch(/STRIPE_SECRET|STRIPE_WEBHOOK/);
  });

  it("only the page touches env, and only for the publishable key", () => {
    for (const file of ALL_UI.filter((f) => !f.endsWith("page.tsx"))) {
      expect(strip(read(file)), file).not.toMatch(/infrastructure\/config\/env|process\.env/);
    }
  });

  it("client components never import server-only composition roots or use cases", () => {
    for (const file of CLIENT_FILES) {
      expect(strip(read(file)), file).not.toMatch(/application\/use-cases|\/compose"|ConfirmLeadPurchase|TransitionLeadPurchase|requireAuth/);
    }
  });
});

describe("M144 — the browser decides nothing", () => {
  it("no price / tax / total arithmetic or tax constants in any UI file", () => {
    for (const file of ALL_UI) {
      const code = strip(read(file));
      expect(code, file).not.toMatch(/taxRate|TAX_RATE|0\.21|1\.21|21\s*%|computeLeadFeeTax|lead-fee-tax-policy|calculateLeadPrice|lead-pricing/);
      expect(code, file).not.toMatch(/(feeAmount|taxAmount|totalAmount|\.price)\s*[-+*/]\s*[\w(]/);
      expect(code, file).not.toMatch(/[\w)]\s*[-+*/]\s*(purchase\.)?(feeAmount|taxAmount|totalAmount)\b/);
      expect(code, file).not.toMatch(/parseFloat|toFixed|Math\.(round|floor|ceil)/);
    }
  });

  it("the only Number() on money is the display formatter, which does no arithmetic", () => {
    const view = strip(read(`${dir}/checkout-view.ts`));
    expect(view.match(/Number\(/g)).toHaveLength(1);
    expect(view).toMatch(/const numeric = Number\(amount\);/);
    for (const file of ALL_UI.filter((f) => !f.endsWith("checkout-view.ts"))) expect(strip(read(file)), file).not.toMatch(/Number\(/);
  });

  it("no browser storage, cookies, URL state or Stripe result decides purchase state or contact", () => {
    for (const file of CLIENT_FILES) {
      const code = strip(read(file));
      expect(code, file).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/);
      expect(code, file).not.toMatch(/useSearchParams|searchParams|window\.location\.(search|hash)|URLSearchParams|payment_intent|redirect_status/);
    }
    expect(strip(read(`${dir}/page.tsx`))).not.toMatch(/searchParams/);
  });

  it("the Stripe confirmPayment result is never used to mark the purchase paid or to fetch contact", () => {
    const form = strip(read(`${dir}/stripe-payment-form.tsx`));
    expect(form).not.toMatch(/paymentIntent\.status|result\.paymentIntent|getLeadContactAction|status === "succeeded"/);
    expect(form).toContain("redirect: \"if_required\"");
  });

  it("contact is requested only by ContactReveal, which only the CONFIRMED phase renders, through the existing M138 action", () => {
    const owners = CLIENT_FILES.filter((f) => /getLeadContactAction/.test(strip(read(f))));
    expect(owners).toEqual([`${dir}/contact-reveal.tsx`]);
    const checkout = strip(read(`${dir}/purchase-checkout.tsx`));
    const uses = [...checkout.matchAll(/<ContactReveal/g)];
    expect(uses).toHaveLength(1);
    expect(checkout).toMatch(/phase\.name === "confirmed" && <ContactReveal/);
    expect(strip(read(`${dir}/contact-reveal.tsx`))).toContain('from "../../actions"');
  });

  it("confirmation is observed, never performed: only the existing read + M140 + start actions are used", () => {
    const checkout = strip(read(`${dir}/purchase-checkout.tsx`));
    expect(checkout).toContain('import { initiateLeadFeePaymentAction } from "../../payment-actions"');
    expect(checkout).toContain('import { getLeadPurchaseCheckoutAction, startLeadPurchaseAction } from "./actions"');
    expect(checkout).not.toMatch(/confirmLeadPurchase|transition|webhook|markPaid|setConfirmed|paymentReference/i);
    const actions = strip(read(`${dir}/actions.ts`));
    const names = [...actions.matchAll(/export async function (\w+)\(/g)].map((m) => m[1]).sort();
    expect(names).toEqual(["getLeadPurchaseCheckoutAction", "startLeadPurchaseAction"]);
    expect(actions).not.toMatch(/Confirm|Transition|payment|contact|Stripe|prisma/i);
  });

  it("polling is bounded by a fixed schedule", () => {
    const view = strip(read(`${dir}/checkout-view.ts`));
    const schedule = view.match(/LEAD_PURCHASE_POLL_INTERVALS_MS: readonly number\[\] = \[([^\]]+)\]/);
    expect(schedule).not.toBeNull();
    const intervals = schedule![1]!.split(",").map((n) => Number(n.trim()));
    expect(intervals.length).toBeLessThanOrEqual(20);
    expect(Math.min(...intervals)).toBeGreaterThanOrEqual(1000);
    expect(intervals.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(120_000);
    const poll = strip(read(`${dir}/use-purchase-status-polling.ts`));
    expect(poll).not.toMatch(/setInterval/);
    expect(poll).toContain("clearTimeout(timer)");
    expect(poll).toContain("attempt >= intervalsMs.length");
  });
});

describe("M144 — existing guarded boundaries are untouched and nothing is duplicated", () => {
  it("the read-only leads actions.ts is still exactly the M125/M134/M138 entry points", () => {
    const names = [...strip(read(`${leadsDir}/actions.ts`)).matchAll(/export async function (\w+)\(/g)].map((m) => m[1]).sort();
    expect(names).toEqual(["getLeadContactAction", "getLeadFeedAction", "getLeadPreviewAction", "getLeadPreviewsAction"]);
  });

  it("payment-actions.ts is still only the M140 action (M144 reuses it, adds no payment use case)", () => {
    const src = strip(read(`${leadsDir}/payment-actions.ts`));
    expect([...src.matchAll(/export async function (\w+)\(/g)].map((m) => m[1])).toEqual(["initiateLeadFeePaymentAction"]);
    expect(src).toContain("makeInitiateLeadFeePaymentUseCase().execute(user.id, purchaseId as string)");
  });

  it("no file under src/app imports the trusted lead-purchase compose directly (M139 guard stays intact)", () => {
    const offenders = walk(path.join(root, "src/app"))
      .map((f) => path.relative(root, f).split(path.sep).join("/"))
      .filter((f) => /lead-purchase\/compose|makeConfirmLeadPurchase|makeTransitionLeadPurchase/.test(readFileSync(path.join(root, f), "utf8")));
    expect(offenders).toEqual([]);
    expect(strip(read(`${dir}/actions.ts`))).toContain("makeInitiateLeadPurchaseUseCase");
  });

  it("the new compose root is read-only: it wires no lifecycle, payment, gateway or contact collaborator", () => {
    const compose = strip(read("src/core/application/use-cases/lead-checkout/compose.ts"));
    // The only non-read thing it exposes is the EXISTING initiation factory, re-exported (never re-wired).
    expect(compose).toContain('export { makeInitiateLeadPurchaseUseCase } from "@/application/use-cases/lead-purchase/compose";');
    expect(compose.replace(/export \{ makeInitiateLeadPurchaseUseCase \} from "[^"]+";/, "")).not.toMatch(
      /ConfirmLeadPurchase|TransitionLeadPurchase|InitiateLead|stripe|Gateway|LeadContact|ServiceRequestRepository|lead-fee-payment/i,
    );
    const useCase = strip(read("src/core/application/use-cases/lead-checkout/get-lead-purchase-checkout.use-case.ts"));
    expect(useCase).not.toMatch(/\.(transition|initiate|create|recordPaymentReference)\(|readContact|stripe|paymentReference|logger/i);
  });

  it("the checkout DTO whitelist names no payment, professional, customer or provenance field", () => {
    const dto = strip(read("src/core/application/dto/lead-purchase-checkout.dto.ts"));
    const iface = dto.slice(dto.indexOf("export interface LeadPurchaseCheckoutDTO"), dto.indexOf("export function toLeadPurchaseCheckoutDto"));
    expect(iface).not.toMatch(/paymentReference|professional|customer|email|phone|address|pricingConfigVersion|taxPolicyVersion|leadPublishedAt/);
  });

  it("no new webhook route, no confirmation or lifecycle exposure outside src/core", () => {
    const files = walk(path.join(root, "src")).map((f) => path.relative(root, f).split(path.sep).join("/"));
    expect(files.filter((f) => /app\/api\/webhooks\//.test(f) && /m144|checkout|lead-purchase/i.test(f))).toEqual([]);
    const exposed = files.filter((f) => !f.startsWith("src/core/") && /ConfirmLeadPurchase|TransitionLeadPurchase/.test(read(f)));
    expect(exposed).toEqual([]);
  });

  it("the repository addition is a read-only SELECT scoped by lead and professional", () => {
    const src = strip(read("src/core/infrastructure/database/prisma/repositories/prisma-lead-purchase-repository.ts"));
    const body = src.slice(src.indexOf("async findLatestByLeadAndProfessional"));
    expect(body).toContain("prisma.leadPurchase.findFirst");
    expect(body).toContain("where: { leadId, professionalProfileId }");
    expect(body).not.toMatch(/\.(update|updateMany|create|createMany|delete|deleteMany|upsert)\(/);
  });
});
