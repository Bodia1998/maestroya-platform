import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Module 153 — static contract: who may touch the refund table and the provider refund API, that nothing triggers a refund
 * automatically (no route / action / webhook / job / subscriber), isolation from the ledger / invoice / credit-note tables
 * and the legacy payment code, and what the migration guarantees (and does not touch).
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

const REPO = "src/core/infrastructure/database/prisma/repositories/prisma-lead-fee-refund-repository.ts";
const DOMAIN = "src/core/domain/services/lead-fee-refund.ts";
const PORT = "src/core/domain/repositories/lead-fee-refund-repository.ts";
const USE_CASE = "src/core/application/use-cases/lead-fee-refund/execute-lead-fee-refund.use-case.ts";
const COMPOSE = "src/core/application/use-cases/lead-fee-refund/compose.ts";
const EVENT = "src/core/domain/events/lead-purchase-refunded.ts";
const ADAPTER = "src/core/infrastructure/payments/stripe/stripe-lead-fee-payment-gateway.ts";
const GATEWAY_PORT = "src/core/application/ports/lead-fee-payment-gateway.ts";
const M153_FILES = [REPO, DOMAIN, PORT, USE_CASE, COMPOSE, EVENT];
const MIGRATION = "prisma/migrations/20261016000000_add_module_153_lead_fee_refunds/migration.sql";

const mentionsRefund = (f: string) => /leadFeeRefund\b|lead_fee_refunds|LeadFeeRefund|lead-fee-refund|LeadPurchaseRefunded|lead-purchase-refunded/.test(code(f));
const sql = () => read(MIGRATION).replace(/^\s*--.*$/gm, "");

describe("M153 — write / read boundary", () => {
  it("the whole M153 surface is exactly these source files plus the (additively extended) lead-fee payment port/adapter", () => {
    expect(SRC.filter(mentionsRefund).sort()).toEqual([...M153_FILES, GATEWAY_PORT, ADAPTER].sort());
  });

  it("only the Prisma adapter touches the lead_fee_refunds table / client accessor, and never deletes or upserts", () => {
    expect(SRC.filter((f) => /leadFeeRefund\b|lead_fee_refunds/.test(code(f)))).toEqual([REPO]);
    expect(code(REPO)).not.toMatch(/leadFeeRefund\.(delete|deleteMany|upsert|createMany|update)\b/);
    expect(code(REPO)).not.toMatch(/\$executeRaw|\$queryRaw/);
  });

  it("the use case is constructed only by its composition root, and nothing imports that root (no route, action, webhook, job, queue, subscriber or UI)", () => {
    expect(SRC.filter((f) => /new ExecuteLeadFeeRefundUseCase\b/.test(code(f)))).toEqual([COMPOSE]);
    expect(SRC.filter((f) => /use-cases\/lead-fee-refund\/compose|makeExecuteLeadFeeRefundUseCase/.test(code(f)) && f !== COMPOSE)).toEqual([]);
  });

  it("no route, page, Server Action, webhook, cron, job or subscriber file references refunds of lead fees at all", () => {
    const entryPoints = SRC.filter((f) => /(^|\/)app\//.test(f) || /\/(actions?|jobs?|cron|webhooks?|queues?|workers?|subscribers?)\//.test(f) || /^(middleware|instrumentation)\.ts$/.test(f) || /route\.ts$/.test(f) || /actions?\.ts$/.test(f));
    expect(entryPoints.length).toBeGreaterThan(10);
    for (const f of entryPoints) expect(code(f), f).not.toMatch(/LeadFeeRefund|lead-fee-refund|lead_fee_refunds|LeadPurchaseRefunded|lead-purchase-refunded/);
  });

  it("nothing subscribes to LeadPurchaseRefunded", () => {
    expect(SRC.filter((f) => /subscribe\(\s*LeadPurchaseRefunded/.test(code(f)))).toEqual([]);
  });

  it("payment initiation, the webhook, purchase, notification and onboarding code never mention lead-fee refunds", () => {
    const flows = SRC.filter((f) => /use-cases\/(lead-fee-payment|lead-purchase|lead-purchase-eligibility|notification|lead|onboarding|billing-identity)\//.test(f));
    expect(flows.length).toBeGreaterThan(10);
    for (const f of flows) expect(code(f), f).not.toMatch(/LeadFeeRefund|lead-fee-refund|lead_fee_refunds/);
  });

  it("the legacy payment / refund / payout / commission / affiliate / reconciliation code never references the lead-fee refund", () => {
    const legacy = SRC.filter((f) => /use-cases\/(payments|payout|payouts|commission|financial|invoicing|invoice|affiliate|partner|reconciliation)\//.test(f) || /repositories\/prisma-(payment|payout|commission|financial|invoice|credit-note|transaction)/.test(f));
    expect(legacy.length).toBeGreaterThan(10);
    for (const f of legacy) expect(code(f), f).not.toMatch(/LeadFeeRefund|lead-fee-refund|lead_fee_refunds/);
  });
});

describe("M153 — isolation from the ledger, invoices, credit notes and the legacy refund", () => {
  it("M153 code never reads or writes the ledger / invoice / credit-note tables, the legacy refund / payment / payout tables, or any provider fee", () => {
    for (const f of M153_FILES) {
      expect(code(f), f).not.toMatch(/prisma\.(leadFeeLedgerEntry|leadFeeInvoice|leadFeeCreditNote|refund|payment|payout|commission|transaction|invoice|creditNote)\b/);
      expect(code(f), f).not.toMatch(/LeadFeeLedger|LeadFeeInvoice|LeadFeeCreditNote|lead-fee-credit-note|lead-fee-invoice|lead-fee-revenue-ledger/);
      expect(code(f), f).not.toMatch(/balance_transaction|stripeFee|providerFee|reverse_transfer|refund_application_fee/);
    }
  });

  it("the use case depends on no ledger / invoice / credit-note / payout / commission collaborator", () => {
    expect(code(USE_CASE)).not.toMatch(/ledger|invoice|creditNote|credit-note|payout|commission|affiliate/i);
  });

  it("the legacy refund model is not used by the new code (a distinct leadFeeRefund model exists)", () => {
    expect(read("prisma/schema.prisma")).toMatch(/model LeadFeeRefund \{/);
    expect(code(REPO)).not.toMatch(/prisma\.refund\b/);
  });

  it("the domain service and port stay free of provider SDK / persistence imports", () => {
    for (const f of [DOMAIN, PORT]) expect(code(f), f).not.toMatch(/from "stripe"|@prisma\/client|@\/infrastructure/);
    expect(code(USE_CASE)).not.toMatch(/from "stripe"|@prisma\/client/);
  });

  it("the application layer does not import the infrastructure RBAC table (roles are a local constant)", () => {
    expect(code(USE_CASE) + code(DOMAIN)).not.toMatch(/auth\/rbac|\bROLES\b/);
  });
});

describe("M153 — payment port / Stripe adapter stay minimal", () => {
  it("the adapter uses only refunds.create / refunds.list among refund calls, and none of the prohibited Stripe operations", () => {
    const src = code(ADAPTER);
    expect(src).toMatch(/refunds\.create\(/);
    expect(src).toMatch(/refunds\.list\(/);
    expect(src).not.toMatch(/refunds\.(?!create\b|list\b)/);
    expect(src).not.toMatch(/transfer_data|on_behalf_of|application_fee|transfers\.|stripeAccount|capture_method|\.capture\(|payouts|reverse_transfer|disputes\./);
  });

  it("the port stays provider-agnostic", () => {
    expect(code(GATEWAY_PORT)).not.toMatch(/\bstripe\b|PaymentIntent|payment_intent|client_secret|checkout/i);
  });
});

describe("M153 — configuration: both switches default OFF and are read per call", () => {
  it("the composition root resolves config from the environment on every call and never hard-codes a switch on", () => {
    expect(code(COMPOSE)).toMatch(/resolveLeadFeeRefundConfig\(process\.env\)/);
    expect(code(COMPOSE)).not.toMatch(/realRefundsEnabled:\s*true|automaticTechnicalRefundsEnabled:\s*true/);
  });
  it("no .env example, config or deployment file enables either switch", () => {
    const files = [".env.example", ".env.test", ".env.production", "vercel.json", "docker-compose.yml"].filter((f) => { try { read(f); return true; } catch { return false; } });
    for (const f of files) expect(read(f), f).not.toMatch(/LEAD_FEE_REFUND_(REAL_REFUNDS_ENABLED|AUTOMATIC_TECHNICAL_ENABLED)\s*=\s*"?true/);
  });
});

describe("M153 — migration", () => {
  it("is additive: creates only the two enums, the lead_fee_refunds table, its indexes/constraints/triggers and three functions", () => {
    const s = sql();
    expect(s.match(/CREATE TABLE "[^"]+"/g)).toEqual(['CREATE TABLE "lead_fee_refunds"']);
    expect(s.match(/CREATE TYPE "[^"]+"/g)).toEqual(['CREATE TYPE "LeadFeeRefundReason"', 'CREATE TYPE "LeadFeeRefundStatus"']);
    expect(s.match(/ALTER TABLE "([^"]+)"/g)!.every((m) => m === 'ALTER TABLE "lead_fee_refunds"')).toBe(true);
    expect(s.match(/CREATE (?:OR REPLACE )?FUNCTION (\w+)/g)).toHaveLength(3);
    expect(s).not.toMatch(/\b(DROP|DELETE FROM|UPDATE\s+"|INSERT INTO)\b/);
    expect(s).not.toMatch(/ALTER TABLE "(lead_purchases|lead_fee_ledger_entries|lead_fee_invoices|lead_fee_credit_notes|refunds|users)"/);
  });

  it("enforces uniqueness / concurrency and immutability at the database", () => {
    const s = sql();
    expect(s).toMatch(/CREATE UNIQUE INDEX "lead_fee_refunds_one_active_per_payment_key" ON "lead_fee_refunds"\("refundedPaymentReference"\)\s+WHERE "status" IN \('REQUESTED', 'PROVIDER_PENDING', 'UNKNOWN', 'SUCCEEDED'\)/);
    expect(s).toMatch(/CREATE UNIQUE INDEX "lead_fee_refunds_idempotencyKey_key"/);
    expect(s).toMatch(/CREATE UNIQUE INDEX "lead_fee_refunds_providerRefundId_key"/);
    expect(s).toMatch(/CREATE UNIQUE INDEX "lead_fee_refunds_refundedPaymentReference_attemptNumber_key"/);
    expect(s).toMatch(/BEFORE INSERT ON "lead_fee_refunds"/);
    expect(s).toMatch(/BEFORE UPDATE ON "lead_fee_refunds"/);
    expect(s).toMatch(/BEFORE DELETE ON "lead_fee_refunds"/);
    expect(s).toMatch(/"currency" = 'EUR'/);
    expect(s).toMatch(/ON DELETE RESTRICT/);
    expect(s).not.toMatch(/ON DELETE CASCADE/);
  });

  it("stores no provider fee, ledger/invoice/credit-note reference or personal data", () => {
    const table = sql().slice(sql().indexOf('CREATE TABLE "lead_fee_refunds"'), sql().indexOf('CONSTRAINT "lead_fee_refunds_pkey"'));
    // the table / enum NAMES contain "fee"; only the column definitions are checked
    const columns = table.replace(/lead_fee_refunds|LeadFeeRefund\w*/g, "");
    expect(columns).not.toMatch(/fee|ledger|invoice|creditNote|email|phone|name|address|balance/i);
  });

  it("the Prisma model mirrors it (plain scalar actor, restrict relation, no extra relation fields)", () => {
    const schema = read("prisma/schema.prisma");
    const body = schema.slice(schema.indexOf("model LeadFeeRefund {"), schema.indexOf('@@map("lead_fee_refunds")'));
    expect(body).toMatch(/actorUserId\s+String\s+@db\.Uuid/);
    expect(body).not.toMatch(/actor\s+User/);
    expect(body).toMatch(/onDelete: Restrict/);
    expect(schema).toMatch(/@@map\("lead_fee_refunds"\)/);
  });
});
