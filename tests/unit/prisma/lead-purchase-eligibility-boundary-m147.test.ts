import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Module 147 — static contract for the LEAD_V1 professional eligibility policy: where it is enforced,
 * where it deliberately is NOT, that it composes the existing M98 / M146 rules instead of copying them,
 * and that it adds no schema, no client trust and no sensitive output.
 */
const root = path.resolve(__dirname, "../../..");
const read = (f: string) => readFileSync(path.join(root, f), "utf8");
const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const rel = (p: string) => path.relative(root, p).split(path.sep).join("/");
const SRC = walk(path.join(root, "src")).map(rel).filter((f) => /\.(ts|tsx)$/.test(f));

const POLICY = "src/core/domain/services/lead-purchase-eligibility.ts";
const SERVICE = "src/core/application/services/lead-purchase-eligibility-policy.ts";
const ELIG_COMPOSE = "src/core/application/use-cases/lead-purchase-eligibility/compose.ts";
const INITIATE = "src/core/application/use-cases/lead-purchase/initiate-lead-purchase.use-case.ts";
const PAY = "src/core/application/use-cases/lead-fee-payment/initiate-lead-fee-payment.use-case.ts";
const UI = "src/app/(dashboard)/dashboard/professional/leads/[leadId]/purchase";

describe("M147 — enforcement boundary", () => {
  it("purchase initiation evaluates the policy on the session-resolved professional BEFORE reading any lead", () => {
    const src = code(INITIATE);
    const execute = src.slice(src.indexOf("async execute"));
    const order = ["findByUserId(userId)", "this.eligibility.evaluate(professional)", "this.leads.findById(leadId)", "this.purchases.initiate("].map((needle) => execute.indexOf(needle));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(src).toMatch(/private readonly eligibility: LeadPurchaseEligibilityEvaluator/);
  });

  it("payment initiation keeps the M98 gate first and re-checks the full policy only before creating a NEW provider payment", () => {
    const src = code(PAY);
    const execute = src.slice(src.indexOf("async execute"));
    const at = (needle: string) => execute.indexOf(needle);
    expect(at("decideProfessionalVerificationEligibility(professional)")).toBeGreaterThan(-1);
    expect(at("decideProfessionalVerificationEligibility(professional)")).toBeLessThan(at("this.purchases.findById(purchaseId)"));
    expect(at("if (purchase.paymentReference)")).toBeGreaterThan(-1);
    expect(at("if (purchase.paymentReference)")).toBeLessThan(at("this.eligibility.evaluate(professional)"));
    expect(at("this.eligibility.evaluate(professional)")).toBeLessThan(at("this.gateway.createPayment("));
    expect(src).toMatch(/private readonly eligibility: LeadPurchaseEligibilityEvaluator/);
  });

  it("both composition roots inject the policy from the single eligibility composition root", () => {
    for (const f of ["src/core/application/use-cases/lead-purchase/compose.ts", "src/core/application/use-cases/lead-fee-payment/compose.ts"]) {
      const src = code(f);
      expect(src, f).toContain('import { makeLeadPurchaseEligibilityPolicy } from "@/application/use-cases/lead-purchase-eligibility/compose";');
      expect(src, f).toContain("makeLeadPurchaseEligibilityPolicy()");
      expect(src, f).not.toMatch(/billing-identity|BillingIdentity|PrismaProfessionalBillingIdentityRepository/);
    }
    const root_ = code(ELIG_COMPOSE);
    expect(root_).toContain("makeGetProfessionalBillingReadinessUseCase()");
    expect(root_).not.toMatch(/PrismaProfessionalBillingIdentityRepository/); // M146's own factory is reused, not re-wired
  });

  it("the M139 guard stays intact: nothing under src/app imports the trusted lead-purchase compose", () => {
    const offenders = SRC.filter((f) => f.startsWith("src/app/") && /lead-purchase\/compose|makeConfirmLeadPurchase|makeTransitionLeadPurchase/.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it("is NOT enforced where it does not belong: confirmation, the verified webhook, contact reveal, customer requests, lead publication/feed", () => {
    const outside = SRC.filter(
      (f) =>
        /lead-purchase-eligibility|LeadPurchaseEligib|LeadPurchaseNotEligible/.test(read(f)) &&
        ![POLICY, SERVICE, ELIG_COMPOSE, INITIATE, PAY].includes(f) &&
        !f.startsWith("src/core/application/use-cases/lead-purchase-eligibility/") &&
        !f.startsWith(UI) &&
        !["src/core/application/use-cases/lead-purchase/compose.ts", "src/core/application/use-cases/lead-fee-payment/compose.ts", "src/presentation/i18n/error-messages.ts"].includes(f),
    );
    expect(outside).toEqual([]);
    for (const f of [
      "src/core/application/use-cases/lead-purchase/confirm-lead-purchase.use-case.ts",
      "src/core/application/use-cases/lead-fee-payment/process-lead-fee-payment-webhook.use-case.ts",
      "src/core/application/use-cases/lead-contact/get-lead-contact.use-case.ts",
      "src/app/api/webhooks/stripe-payments/route.ts",
    ]) {
      expect(code(f), f).not.toMatch(/LeadPurchaseEligib|lead-purchase-eligibility|LeadPurchaseNotEligible|eligibility\.evaluate/);
    }
  });
});

describe("M147 — composes the existing rules, duplicates none", () => {
  it("M98: the policy delegates to the existing isProfessionalEligibleToPurchaseLeads (no second status rule)", () => {
    const src = code(POLICY);
    expect(src).toContain('import { isProfessionalEligibleToPurchaseLeads } from "@/domain/services/lead-purchase";');
    expect(src).not.toMatch(/=== "VERIFIED"\s*&&\s*professional|verificationStatus\s*===/); // no re-stated verificationStatus comparison
    expect(code("src/core/domain/services/lead-purchase.ts")).toMatch(/professional\.status === "ACTIVE" && professional\.verificationStatus === "VERIFIED"/);
  });

  it("M146: billing readiness comes from GetProfessionalBillingReadinessUseCase; completeness/verification are not re-derived", () => {
    expect(code(ELIG_COMPOSE)).toContain("makeGetProfessionalBillingReadinessUseCase");
    for (const f of [POLICY, SERVICE]) {
      const src = code(f);
      expect(src, f).not.toMatch(/findBillingIdentityIssues|isBillingIdentityComplete|evaluateBillingIdentityReadiness|taxId|legalName|addressLine|postalCode|findByProfessionalProfileId|Prisma|prisma/);
      expect(src, f).not.toMatch(/@\/infrastructure|@\/presentation|next\/|stripe/i);
    }
  });

  it("M136/tax: the policy infers no tax treatment, VAT exemption, rate or country rule", () => {
    for (const f of [POLICY, SERVICE]) expect(code(f), f).not.toMatch(/taxCountry|\bcountry\b|\b(vat|iva)\b|rateBps|exempt|computeLeadFeeTax|lead-fee-tax-policy/i);
    expect(code("src/core/domain/services/lead-fee-tax-policy.ts")).toMatch(/LEAD_FEE_IVA_RATE_BPS = 2100n/);
  });

  it("the service copies only the four readiness facts, never the snapshot", () => {
    const src = code(SERVICE);
    expect(src).toContain("state: readiness.state, isComplete: readiness.isComplete, isVerified: readiness.isVerified, billingReady: readiness.billingReady");
    expect(src).not.toMatch(/snapshot/);
  });

  it("no pricing, duplicate, locking or idempotency code was touched in the repository or the price snapshot", () => {
    expect(code("src/core/infrastructure/database/prisma/repositories/prisma-lead-purchase-repository.ts")).not.toMatch(/LeadPurchaseEligib|lead-purchase-eligibility|eligibility\.evaluate/);
    expect(code(INITIATE)).toMatch(/this\.purchases\.initiate\(\{ leadId, professionalProfileId: professional\.id \}\)/);
    expect(code(INITIATE)).toMatch(/findActiveByLeadAndProfessional/);
  });
});

describe("M147 — no client trust, no sensitive output", () => {
  it("the use cases take only (userId, leadId) / (userId, purchaseId); the guidance action takes no parameter at all", () => {
    expect(code(INITIATE)).toMatch(/async execute\(userId: string, leadId: string\)/);
    expect(code(PAY)).toMatch(/async execute\(userId: string, purchaseId: string\)/);
    const action = code(`${UI}/eligibility-actions.ts`);
    expect(action).toMatch(/export async function getMyLeadPurchaseEligibilityAction\(\)/);
    expect(action).toContain("requireAuth()");
    expect(action).toContain(".execute(user.id)");
    expect(action).not.toMatch(/billing|taxId|FormData|searchParams|headers\(|cookies\(/i);
  });

  it("the eligibility DTO and the typed error carry no billing data", () => {
    const useCase = code("src/core/application/use-cases/lead-purchase-eligibility/get-my-lead-purchase-eligibility.use-case.ts");
    expect(useCase).toMatch(/type LeadPurchaseEligibilityDTO = \{ eligible: true; reason: null \} \| \{ eligible: false; reason: LeadPurchaseIneligibilityReason \}/);
    expect(useCase).not.toMatch(/taxId|legalName|address|snapshot|rejectionReason|reviewNote/);
    expect(code(POLICY)).toContain('super("Complete your billing details before purchasing leads.")');
  });

  it("logging: the payment denial logs only the closed reason code (no billing detail)", () => {
    const logs = code(PAY).match(/logger\.warn\("lead_fee_payment\.denied", \{[^}]*\}\)/g) ?? [];
    expect(logs).toContain('logger.warn("lead_fee_payment.denied", { reason: "NOT_ELIGIBLE", eligibilityReason: decision.reason })');
    for (const l of logs) expect(l).not.toMatch(/taxId|legalName|address|snapshot|readiness/i);
  });

  it("the UI is guidance only: no billing field, no enforcement, no new payment/purchase call", () => {
    for (const f of ["purchase-checkout.tsx", "checkout-view.ts"].map((n) => `${UI}/${n}`)) {
      expect(code(f), f).not.toMatch(/taxId|legalName|addressLine|rejectionReason|reviewNote|billingReady|GetProfessionalBillingReadiness|billing-identity/);
    }
    const checkout = code(`${UI}/purchase-checkout.tsx`);
    expect(checkout).not.toMatch(/application\/use-cases/); // M144: client components never import use cases
    expect(checkout).toContain("disabled={blocked}");
    // The server action still gets called when the UI is bypassed or stale: the buttons are a courtesy only.
    expect(code(`${UI}/actions.ts`)).toContain("makeInitiateLeadPurchaseUseCase().execute(user.id, leadId as string)");
  });
});

describe("M147 — no schema or migration impact", () => {
  it("adds no migration, and prisma/schema.prisma has no eligibility model", () => {
    const names = readdirSync(path.join(root, "prisma/migrations")).filter((n) => /^\d{14}_/.test(n));
    expect(names.filter((n) => /module_147|eligib/i.test(n))).toEqual([]);
    expect(existsSync(path.join(root, "prisma/schema.prisma"))).toBe(true);
    expect(read("prisma/schema.prisma")).not.toMatch(/model\s+\w*Eligib\w*\s*\{/);
  });
});
