import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Module 149 — static contract: who may write the lead-fee ledger, that legacy payment / payout paths
 * cannot, that the confirmation wiring carries the ledger, and what the migration guarantees.
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

const LEDGER_REPO = "src/core/infrastructure/database/prisma/repositories/prisma-lead-fee-revenue-ledger-repository.ts";
const PURCHASE_REPO = "src/core/infrastructure/database/prisma/repositories/prisma-lead-purchase-repository.ts";
const WEBHOOK = "src/core/application/use-cases/lead-fee-payment/process-lead-fee-payment-webhook.use-case.ts";
const COMPOSE = "src/core/application/use-cases/lead-fee-payment/compose.ts";
const MIGRATION = "prisma/migrations/20261013000000_add_module_149_lead_fee_revenue_ledger/migration.sql";

describe("M149 — ledger write boundary", () => {
  it("only the two Prisma adapters touch the ledger table", () => {
    const users = SRC.filter((f) => /leadFeeLedgerEntry\b/.test(code(f)));
    expect(users.sort()).toEqual([LEDGER_REPO, PURCHASE_REPO].sort());
  });

  it("the ledger adapter exposes no update / delete / upsert", () => {
    const src = code(LEDGER_REPO);
    expect(src).not.toMatch(/leadFeeLedgerEntry\.(update|updateMany|delete|deleteMany|upsert)\b/);
    expect(code(PURCHASE_REPO)).not.toMatch(/leadFeeLedgerEntry\.(update|updateMany|delete|deleteMany|upsert)\b/);
  });

  it("legacy customer-payment, payout, commission, invoice and affiliate code never reference the lead-fee ledger", () => {
    const legacy = SRC.filter((f) => /use-cases\/(payments|payout|payouts|commission|financial|invoicing|invoice|affiliate|partner|reconciliation)\//.test(f) || /repositories\/prisma-(payment|payout|commission|financial|invoice|transaction)/.test(f));
    expect(legacy.length).toBeGreaterThan(5);
    for (const f of legacy) expect(code(f), f).not.toMatch(/lead-fee-revenue-ledger|LeadFeeLedger|leadFeeLedgerEntry/);
  });

  it("the ledger does not feed or read the legacy Transaction ledger", () => {
    expect(code(LEDGER_REPO)).not.toMatch(/\.transaction\b|prisma\.payment|prisma\.payout/);
    expect(code(PURCHASE_REPO)).not.toMatch(/prisma\.transaction\b|tx\.transaction\b/);
  });
});

describe("M149 — confirmation wiring", () => {
  it("the webhook passes the verified event as ledgerSource to the existing confirmer and wires the idempotent path", () => {
    const src = code(WEBHOOK);
    expect(src).toMatch(/this\.confirmer\.confirmWithLedgerSource\(purchase\.id, ledgerSource\)/);
    expect(src).toMatch(/providerEventId: event\.id/);
    expect(src).toMatch(/this\.ledger\.recordIfAbsent\(buildLeadFeeRevenueLedgerEntry\(purchase, ledgerSource\)\)/);
    // the ledger never takes an amount from the event
    expect(src).not.toMatch(/amountMinorUnits[^;\n]*ledger|ledger[^;\n]*amountMinorUnits/i);
  });

  it("the ledger entry is built only after the facts were validated against the snapshot", () => {
    const src = code(WEBHOOK);
    const succeeded = src.slice(src.indexOf("private async onSucceeded"));
    expect(succeeded.indexOf("validateLeadFeePaymentFacts")).toBeGreaterThan(-1);
    expect(succeeded.indexOf("validateLeadFeePaymentFacts")).toBeLessThan(succeeded.indexOf("recordIfAbsent"));
    expect(succeeded.indexOf("validateLeadFeePaymentFacts")).toBeLessThan(succeeded.indexOf("this.confirmer.confirmWithLedgerSource"));
    // only onSucceeded touches the ledger
    expect(src.slice(0, src.indexOf("private async onSucceeded")).match(/recordIfAbsent\(/g)?.length ?? 0).toBe(0);
    expect(src.slice(src.indexOf("private async onFailed"), src.indexOf("/** Module 145")).match(/recordIfAbsent|ledgerSource/g)).toBeNull();
  });

  it("the composition root injects the Prisma ledger repository", () => {
    expect(code(COMPOSE)).toMatch(/new PrismaLeadFeeRevenueLedgerRepository\(\)/);
  });

  it("the Prisma transition writes status and entry in one $transaction and only for CONFIRMED", () => {
    const src = code(PURCHASE_REPO);
    const method = src.slice(src.indexOf("private async confirmWithLedgerEntry"), src.indexOf("async recordPaymentReference"));
    expect(method).toMatch(/prisma\.\$transaction/);
    expect(method.indexOf("tx.leadPurchase.updateMany")).toBeLessThan(method.indexOf("tx.leadFeeLedgerEntry.create"));
    expect(method).not.toMatch(/prisma\.leadFeeLedgerEntry/);
    expect(src).toMatch(/if \(to !== "CONFIRMED"\) throw new Error/);
  });

  it("no module-149 code adds invoices, credit notes, refunds, Stripe transfers or amounts from the client", () => {
    for (const f of [LEDGER_REPO, "src/core/domain/services/lead-fee-revenue-ledger.ts", "src/core/domain/repositories/lead-fee-revenue-ledger-repository.ts"]) {
      expect(code(f), f).not.toMatch(/stripe|transfer|payout|invoice|creditNote|refund\(|request\.|formData/i);
    }
  });
});

describe("M149 — migration guarantees", () => {
  const sql = read(MIGRATION);
  it("is additive only", () => {
    const ddl = sql.replace(/^\s*--.*$/gm, "");
    expect(ddl).not.toMatch(/\b(DROP|TRUNCATE|DELETE\s+FROM|UPDATE\s+")/i);
    expect(ddl.match(/ALTER TABLE "([^"]+)"/g)!.every((m) => m === 'ALTER TABLE "lead_fee_ledger_entries"')).toBe(true);
  });
  it("enforces one entry per purchase and per provider payment, exact money, and append-only", () => {
    expect(sql).toMatch(/CREATE UNIQUE INDEX "lead_fee_ledger_entries_leadPurchaseId_entryType_key"/);
    expect(sql).toMatch(/CREATE UNIQUE INDEX "lead_fee_ledger_entries_paymentReference_entryType_key"/);
    expect(sql).toMatch(/"totalCollectedAmount" = "netFeeAmount" \+ "taxAmount"/);
    expect(sql).toMatch(/DECIMAL\(10,2\)/);
    expect(sql).toMatch(/BEFORE UPDATE OR DELETE ON "lead_fee_ledger_entries"/);
    expect(sql).toMatch(/ON DELETE RESTRICT/);
  });
});
