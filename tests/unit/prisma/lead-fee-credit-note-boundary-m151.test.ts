import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Module 151 — static contract: who may write the lead-fee credit-note table, isolation from legacy invoicing, payments,
 * Stripe and the M149/M150 tables, that nothing triggers issuance automatically, and what the migration guarantees
 * (and does not touch).
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

const REPO = "src/core/infrastructure/database/prisma/repositories/prisma-lead-fee-credit-note-repository.ts";
const DOMAIN = "src/core/domain/services/lead-fee-credit-note.ts";
const PORT = "src/core/domain/repositories/lead-fee-credit-note-repository.ts";
const USE_CASE = "src/core/application/use-cases/lead-fee-credit-note/issue-lead-fee-credit-note.use-case.ts";
const COMPOSE = "src/core/application/use-cases/lead-fee-credit-note/compose.ts";
const M151_FILES = [REPO, DOMAIN, PORT, USE_CASE, COMPOSE];
const MIGRATION = "prisma/migrations/20261015000000_add_module_151_lead_fee_credit_notes/migration.sql";

const mentionsCreditNote = (f: string) => /leadFeeCreditNote\b|lead_fee_credit_notes|LeadFeeCreditNote|lead-fee-credit-note/.test(code(f));

describe("M151 — write / read boundary", () => {
  it("only the Prisma adapter touches the lead_fee_credit_notes table / client accessor", () => {
    expect(SRC.filter((f) => /leadFeeCreditNote\b|lead_fee_credit_notes/.test(code(f)))).toEqual([REPO]);
  });

  it("the adapter exposes no update / delete / upsert (credit notes are immutable)", () => {
    expect(code(REPO)).not.toMatch(/leadFeeCreditNote\.(update|updateMany|delete|deleteMany|upsert|createMany)\b/);
  });

  it("the whole M151 surface is exactly these five source files", () => {
    expect(SRC.filter(mentionsCreditNote).sort()).toEqual([...M151_FILES].sort());
  });

  it("the use case is constructed only by its composition root, and nothing else imports that root (no route, action, webhook, job, queue or UI)", () => {
    expect(SRC.filter((f) => /new IssueLeadFeeCreditNoteUseCase\b/.test(code(f)))).toEqual([COMPOSE]);
    expect(SRC.filter((f) => /use-cases\/lead-fee-credit-note\/compose|makeIssueLeadFeeCreditNoteUseCase/.test(code(f)) && f !== COMPOSE)).toEqual([]);
  });

  it("no route, page, Server Action, webhook, cron or job file references credit notes at all", () => {
    const entryPoints = SRC.filter((f) => /(^|\/)app\//.test(f) || /\/(actions?|jobs?|cron|webhooks?|queues?|workers?)\//.test(f) || /^(middleware|instrumentation)\.ts$/.test(f) || /route\.ts$/.test(f) || /actions?\.ts$/.test(f));
    expect(entryPoints.length).toBeGreaterThan(10);
    for (const f of entryPoints) expect(code(f), f).not.toMatch(/LeadFeeCreditNote|lead-fee-credit-note|lead_fee_credit_notes/);
  });

  it("payment initiation, the webhook, confirmation, purchase, notification and onboarding code never mention credit notes", () => {
    const flows = SRC.filter((f) => /use-cases\/(lead-fee-payment|lead-purchase|lead-purchase-eligibility|notification|lead|onboarding|billing-identity)\//.test(f));
    expect(flows.length).toBeGreaterThan(10);
    for (const f of flows) expect(code(f), f).not.toMatch(/LeadFeeCreditNote|lead-fee-credit-note|lead_fee_credit_notes/);
  });
});

describe("M151 — isolation from legacy invoicing, payments and the M149 / M150 tables", () => {
  it("legacy invoicing / payment / payout / commission / financial / affiliate code never references the lead-fee credit note", () => {
    const legacy = SRC.filter((f) => /use-cases\/(payments|payout|payouts|commission|financial|invoicing|invoice|affiliate|partner|reconciliation)\//.test(f) || /repositories\/prisma-(payment|payout|commission|financial|invoice|credit-note|transaction)/.test(f));
    expect(legacy.length).toBeGreaterThan(10);
    for (const f of legacy) expect(code(f), f).not.toMatch(/LeadFeeCreditNote|lead-fee-credit-note|lead_fee_credit_notes/);
  });

  it("M151 code never reads or writes the legacy invoice / credit-note / payment / payout / transaction tables or their number series", () => {
    for (const f of M151_FILES) {
      expect(code(f), f).not.toMatch(/prisma\.(invoice|creditNote|payment|payout|commission|transaction|selfBillingAuthorization)\b|tx\.(invoice|creditNote|payment|payout|transaction)\b/);
      expect(code(f), f).not.toMatch(/PrismaInvoiceRepository|PrismaCreditNoteRepository|PrismaDocumentNumberAllocator|invoice-lifecycle|invoice-document|InvoiceNumberAllocator|CreateCreditNoteUseCase|"INV"|"CN"/);
    }
    expect(code(REPO)).toMatch(/allocateNextDocumentSequence\(tx, LEAD_FEE_CREDIT_NOTE_SERIES, year\)/);
  });

  it("the credit-note adapter never touches the invoice, ledger, purchase or billing-identity tables (it writes only its own table + the counter)", () => {
    expect(code(REPO)).not.toMatch(/leadFeeInvoice\b|lead_fee_invoices|leadFeeLedgerEntry\b|lead_fee_ledger_entries|leadPurchase\b|lead_purchases|professionalBillingIdentity|professional_billing_identities/);
  });

  it("M149 / M150 sources are unchanged in their write surface: they know nothing of credit notes", () => {
    for (const f of [
      "src/core/infrastructure/database/prisma/repositories/prisma-lead-fee-revenue-ledger-repository.ts",
      "src/core/infrastructure/database/prisma/repositories/prisma-lead-purchase-repository.ts",
      "src/core/domain/services/lead-fee-revenue-ledger.ts",
      "src/core/domain/repositories/lead-fee-revenue-ledger-repository.ts",
      "src/core/infrastructure/database/prisma/repositories/prisma-lead-fee-invoice-repository.ts",
      "src/core/domain/services/lead-fee-invoice.ts",
      "src/core/domain/repositories/lead-fee-invoice-repository.ts",
      "src/core/application/use-cases/lead-fee-invoice/issue-lead-fee-invoice.use-case.ts",
      "src/core/application/use-cases/lead-fee-invoice/compose.ts",
    ]) {
      expect(code(f), f).not.toMatch(/LeadFeeCreditNote|lead-fee-credit-note|lead_fee_credit_notes|leadFeeCreditNote/);
    }
  });

  it("no refund, Stripe, revoke, balance, e-mail, PDF or HTTP side effect is reachable from the M151 files", () => {
    for (const f of M151_FILES) {
      expect(code(f), f).not.toMatch(/stripe|Stripe|refund|Refund|revoke|Revoke|balance|Balance|sendEmail|resend|nodemailer|\bfetch\(|axios|pdf|Pdf|PDF|notification|Notification|transition\(|\.transition\b/);
    }
  });

  it("the domain layer imports no infrastructure, Prisma or application code and reads no environment itself", () => {
    for (const f of [DOMAIN, PORT]) expect(code(f), f).not.toMatch(/@prisma\/client|@\/infrastructure|@\/application|from "next|process\.env/);
  });

  it("the use case depends on ports only (no Prisma / infrastructure import) and takes the invoice through the existing M150 port", () => {
    expect(code(USE_CASE)).not.toMatch(/@prisma\/client|@\/infrastructure/);
    expect(code(USE_CASE)).toMatch(/Pick<LeadFeeInvoiceRepository, "findByLeadPurchaseId">/);
  });

  it("the composition root reads configuration from the environment on each call and wires the Prisma invoice and credit-note adapters", () => {
    const src = code(COMPOSE);
    expect(src).toMatch(/\(\) => resolveLeadFeeCreditNoteIssuanceConfig\(process\.env\)/);
    expect(src).toMatch(/new PrismaLeadFeeInvoiceRepository\(\)/);
    expect(src).toMatch(/new PrismaLeadFeeCreditNoteRepository\(\)/);
  });

  it("the M150 approval variable is never treated as approval of credit notes", () => {
    expect(code(DOMAIN)).not.toMatch(/env\[LEAD_FEE_INVOICE_ENV\.policyApprovalReference\]|LEAD_FEE_INVOICE_POLICY_APPROVAL_REF/);
    expect(code(DOMAIN)).toMatch(/LEAD_FEE_CREDIT_NOTE_POLICY_APPROVAL_REF/);
  });
});

describe("M151 — migration and schema", () => {
  const sql = () => read(MIGRATION);
  const nonComment = () => sql().split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

  it("is additive: creates only the lead_fee_credit_notes table, its indexes/constraints/triggers and two functions", () => {
    const s = nonComment();
    expect(s.match(/CREATE TABLE "[^"]+"/g)).toEqual(['CREATE TABLE "lead_fee_credit_notes"']);
    expect(s).not.toMatch(/\bDROP\b|\bTRUNCATE\b|\bCREATE TYPE\b|^\s*(INSERT INTO|DELETE FROM|UPDATE\s+")/im);
    expect(s.match(/ALTER TABLE "([^"]+)"/g)!.every((m) => m === 'ALTER TABLE "lead_fee_credit_notes"')).toBe(true);
    expect(s.match(/CREATE (OR REPLACE )?FUNCTION [a-z_]+/g)).toHaveLength(2);
  });

  it("does not alter, backfill or add triggers to the M149 ledger, M150 invoices, lead purchases, billing identities, legacy invoices or counters", () => {
    const s = nonComment();
    for (const table of ["lead_fee_ledger_entries", "lead_fee_invoices", "lead_purchases", "professional_billing_identities", "invoices", "credit_notes", "invoice_number_counters"]) {
      expect(s, table).not.toMatch(new RegExp(`(ALTER TABLE|TRIGGER[^;]*ON|INSERT INTO|UPDATE|DELETE FROM)\\s+"${table}"`));
    }
  });

  it("declares the uniqueness, FK, CHECK and trigger guarantees the use case relies on", () => {
    const s = sql();
    expect(s).toMatch(/CREATE UNIQUE INDEX "lead_fee_credit_notes_creditNoteNumber_key"/);
    expect(s).toMatch(/CREATE UNIQUE INDEX "lead_fee_credit_notes_leadFeeInvoiceId_key"/);
    expect(s).toMatch(/FOREIGN KEY \("leadFeeInvoiceId"\) REFERENCES "lead_fee_invoices"\("id"\) ON DELETE RESTRICT/);
    expect(s).toMatch(/"creditedTotalAmount" = "creditedNetAmount" \+ "creditedTaxAmount"/);
    expect(s).toMatch(/"creditKind" = 'FULL' AND "currency" = 'EUR'/);
    expect(s).toMatch(/\^LFC-\[0-9\]\{4\}-\[0-9\]\{6,\}\$/);
    expect(s).toMatch(/\^LFI-\[0-9\]\{4\}-\[0-9\]\{6,\}\$/);
    expect(s).toMatch(/"issuerTaxId" <> 'PENDING-CIF-CONFIRMATION'/);
    expect(s).toMatch(/BEFORE INSERT ON "lead_fee_credit_notes"/);
    expect(s).toMatch(/BEFORE UPDATE OR DELETE ON "lead_fee_credit_notes"/);
    for (const col of ["netFeeAmount", "taxAmount", "totalAmount", "invoiceNumber", "currency", "taxRateBps", "issuerTaxId", "recipientTaxId"]) {
      expect(s, col).toMatch(new RegExp(`inv\\."${col}" IS DISTINCT FROM NEW\\."`));
    }
  });

  it("uses exact decimals for money and no float type anywhere in the table", () => {
    const table = sql().slice(sql().indexOf('CREATE TABLE "lead_fee_credit_notes"'), sql().indexOf('CONSTRAINT "lead_fee_credit_notes_pkey"'));
    expect(table.match(/DECIMAL\(10,2\)/g)).toHaveLength(3);
    expect(table).not.toMatch(/DOUBLE|FLOAT|REAL|MONEY/i);
  });

  it("the Prisma model and invoice back-relation exist, with RESTRICT deletion, unique keys and Decimal(10,2) money", () => {
    const schema = read("prisma/schema.prisma");
    const model = schema.slice(schema.indexOf("model LeadFeeCreditNote {"));
    const body = model.slice(0, model.indexOf("\n}\n"));
    expect(body).toMatch(/creditNoteNumber\s+String\s+@unique/);
    expect(body).toMatch(/leadFeeInvoiceId\s+String\s+@unique/);
    expect(body).toMatch(/onDelete: Restrict/);
    expect(body.match(/@db\.Decimal\(10, 2\)/g)).toHaveLength(3);
    expect(body).toMatch(/@@map\("lead_fee_credit_notes"\)/);
    expect(schema).toMatch(/creditNote LeadFeeCreditNote\?/);
  });

  it("the M150 migration is untouched", () => {
    expect(read("prisma/migrations/20261014000000_add_module_150_lead_fee_invoice/migration.sql")).not.toMatch(/credit_note|CreditNote|LFC/);
  });
});
