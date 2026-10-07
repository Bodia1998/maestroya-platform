import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Module 140 — static contract. LEAD_V1 lead-fee payment initiation is the
 * professional-pays-MaestroYa world ONLY: no legacy quote / commission / payout / invoice /
 * affiliate flow, no pricing or tax engine, no Stripe outside infrastructure, no webhook /
 * confirmation (Module 141), and a write-once provider reference at the database.
 */
const root = path.resolve(__dirname, "../../..");
const read = (f: string) => readFileSync(path.join(root, f), "utf8");
const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** Everything that is NOT infrastructure: must stay provider-SDK free. */
const PURE_FILES = [
  "src/core/domain/services/lead-fee-payment.ts",
  "src/core/application/ports/lead-fee-payment-gateway.ts",
  "src/core/application/dto/lead-fee-payment.dto.ts",
  "src/core/application/use-cases/lead-fee-payment/initiate-lead-fee-payment.use-case.ts",
];
const ALL_FILES = [...PURE_FILES, "src/core/infrastructure/payments/stripe/stripe-lead-fee-payment-gateway.ts"];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe("M140 boundaries", () => {
  it.each(PURE_FILES)("%s has no Stripe / provider SDK reference", (f) => {
    expect(code(f)).not.toMatch(/stripe|PaymentIntent|checkout|client_secret|payment_intent/i);
  });

  it.each(ALL_FILES)("%s does not touch any legacy payment / commission / payout / invoice / affiliate / pricing flow", (f) => {
    const src = code(f).replace(/^import .*$/gm, (line) => line); // imports are checked too
    expect(src).not.toMatch(/commission|payout|affiliate|referral|creditNote|invoice/i);
    expect(src).not.toMatch(/pricing-calculation-service|PricingEngine|pricing-engine|calculateLeadPrice|estimateJobValue|computeLeadFeeTax|lead-fee-tax-policy|lead-pricing/);
    expect(src).not.toMatch(/use-cases\/(payments|quotes|financial|invoicing|affiliate|refunds)\//);
    expect(src).not.toMatch(/ports\/(payment-gateway|stripe-transfer-gateway|stripe-connect-gateway)"/);
    expect(src).not.toMatch(/transaction-flow-guard|assertLegacy|jobRepository|quoteRepository|PaymentRepository/);
    expect(src).not.toMatch(/\b(prisma|tx)\.(quote|payment|commission|payout|invoice|creditNote|refund|financialLedgerEntry)\b/);
  });

  it("the adapter is a direct platform payment: no Connect / transfer / application-fee / manual capture / refund", () => {
    const src = code("src/core/infrastructure/payments/stripe/stripe-lead-fee-payment-gateway.ts");
    expect(src).not.toMatch(/transfer_data|on_behalf_of|application_fee|transfers\.|stripeAccount|capture_method|refunds\.|\.capture\(|payouts/);
  });

  it("the use case never confirms, transitions or unlocks: no lifecycle / contact collaborator", () => {
    const src = code("src/core/application/use-cases/lead-fee-payment/initiate-lead-fee-payment.use-case.ts");
    expect(src).not.toMatch(/\.transition\(|ConfirmLeadPurchase|TransitionLeadPurchase|confirmedAt|lead-contact|LeadContact/);
    expect(src).not.toMatch(/\bnumber\b.*(amount|total)|parseFloat|Number\(|\*\s*100|\*\s*1\.21|0\.21/i);
  });

  it("the domain converts money with bigint fixed-point only (no float arithmetic on the amount)", () => {
    const src = code("src/core/domain/services/lead-fee-payment.ts");
    expect(src).not.toMatch(/parseFloat|\*\s*100\b|\*\s*1\.21|0\.21|toFixed|Math\./);
    expect(src).toMatch(/parseScaledDecimal/);
  });

  it("no webhook route or confirmation is added by M140; no route/page exposes confirm or transition", () => {
    const files = walk(path.join(root, "src")).map((f) => path.relative(root, f).split(path.sep).join("/"));
    const webhookRoutes = files.filter((f) => /app\/api\/webhooks\//.test(f));
    expect(webhookRoutes.filter((f) => /lead|m140|lead-fee/i.test(f))).toEqual([]);
    const exposed = files.filter((f) => !f.startsWith("src/core/") && /ConfirmLeadPurchase|TransitionLeadPurchase/.test(read(f)));
    expect(exposed).toEqual([]);
  });

  it("the Server Action takes only the purchase id and the session user", () => {
    const src = read("src/app/(dashboard)/dashboard/professional/leads/payment-actions.ts");
    const action = src.slice(src.indexOf("export async function initiateLeadFeePaymentAction"));
    expect(action).toContain("initiateLeadFeePaymentAction(purchaseId: unknown)");
    expect(action).toContain("const user = await requireAuth();");
    expect(action).toContain("makeInitiateLeadFeePaymentUseCase().execute(user.id, purchaseId as string)");
    expect(action).not.toMatch(/amount|currency|professionalProfileId|customerId/);
  });

  it("the composition root wires the dedicated lead-fee gateway, not the legacy PaymentGateway", () => {
    const src = code("src/core/application/use-cases/lead-fee-payment/compose.ts");
    const factory = src.slice(src.indexOf("export function makeInitiateLeadFeePaymentUseCase"));
    expect(src).not.toMatch(/payments\/compose|paymentGateway|use-cases\/(payments|financial|invoicing)/);
    expect(factory).toContain("new StripeLeadFeePaymentGatewayAdapter(stripe)");
    expect(factory).not.toMatch(/paymentGateway|PaymentRepository|Quote|Commission|Payout/);
  });

  it("the repository writes only paymentReference in recordPaymentReference (never a financial column or status)", () => {
    const src = code("src/core/infrastructure/database/prisma/repositories/prisma-lead-purchase-repository.ts");
    const body = src.slice(src.indexOf("async recordPaymentReference"), src.indexOf("async create("));
    expect(body).toContain('where: { id, status: "PENDING_PAYMENT", paymentReference: null }');
    expect(body).toContain("data: { paymentReference }");
    expect(body).not.toMatch(/price|currency|taxAmount|totalAmount|taxPolicyVersion|pricingConfigVersion|leadPublishedAt|status:\s*to|confirmedAt/);
  });

  it("schema + migration: one nullable unique column, write-once trigger, no other table or financial change", () => {
    expect(read("prisma/schema.prisma")).toMatch(/paymentReference\s+String\?\s+@unique/);
    const sql = code("prisma/migrations/20261010000000_add_module_140_lead_purchase_payment_reference/migration.sql").replace(/^\s*--.*$/gm, "");
    expect(sql).toContain('ALTER TABLE "lead_purchases" ADD COLUMN "paymentReference" TEXT;');
    expect(sql).toContain('CREATE UNIQUE INDEX "lead_purchases_paymentReference_key"');
    expect(sql).toContain('OLD."paymentReference" IS NOT NULL AND NEW."paymentReference" IS DISTINCT FROM OLD."paymentReference"');
    // the M135/M136 guarantees must all still be in the replaced trigger function
    for (const column of ["leadId", "professionalProfileId", "price", "currency", "pricingConfigVersion", "pricingRuleVersion", "leadPublishedAt", "createdAt", "taxAmount", "totalAmount", "taxPolicyVersion"]) {
      expect(sql).toContain(`NEW."${column}" IS DISTINCT FROM OLD."${column}"`);
    }
    expect(sql).not.toMatch(/DROP|DELETE|UPDATE\s+"|CREATE TABLE|ALTER TABLE "(?!lead_purchases)/);
  });
});

describe("M140 keeps the guarded entry points untouched", () => {
  it("the read-only leads actions.ts and the trusted lead-purchase compose.ts know nothing about lead-fee payment", () => {
    for (const f of ["src/app/(dashboard)/dashboard/professional/leads/actions.ts", "src/core/application/use-cases/lead-purchase/compose.ts"]) {
      expect(read(f)).not.toMatch(/LeadFeePayment|lead-fee-payment/);
    }
  });
});
