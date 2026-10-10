import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Module 150 — static contract: who may write / read the lead-fee invoice table, isolation from legacy invoicing
 * and payment flows, that nothing triggers issuance automatically, M149/M146 boundaries, and what the migration
 * guarantees (and does not touch).
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

const REPO = "src/core/infrastructure/database/prisma/repositories/prisma-lead-fee-invoice-repository.ts";
const DOMAIN = "src/core/domain/services/lead-fee-invoice.ts";
const PORT = "src/core/domain/repositories/lead-fee-invoice-repository.ts";
const USE_CASE = "src/core/application/use-cases/lead-fee-invoice/issue-lead-fee-invoice.use-case.ts";
const COMPOSE = "src/core/application/use-cases/lead-fee-invoice/compose.ts";
const M150_FILES = [REPO, DOMAIN, PORT, USE_CASE, COMPOSE];
/** M151 files that legitimately name the invoice (its types / port). The closed list is extended here, as M147/M150 did for their predecessors; M151's own boundary test pins that they only READ via the existing port. */
const M151_CONSUMERS = [
  "src/core/domain/services/lead-fee-credit-note.ts",
  "src/core/application/use-cases/lead-fee-credit-note/issue-lead-fee-credit-note.use-case.ts",
  "src/core/application/use-cases/lead-fee-credit-note/compose.ts",
];
const MIGRATION = "prisma/migrations/20261014000000_add_module_150_lead_fee_invoice/migration.sql";
const LEDGER_REPO = "src/core/infrastructure/database/prisma/repositories/prisma-lead-fee-revenue-ledger-repository.ts";
const PURCHASE_REPO = "src/core/infrastructure/database/prisma/repositories/prisma-lead-purchase-repository.ts";

const mentionsInvoice = (f: string) => /leadFeeInvoice\b|lead_fee_invoices|LeadFeeInvoice|lead-fee-invoice/.test(code(f));

describe("M150 — write / read boundary", () => {
  it("only the Prisma adapter touches the lead_fee_invoices table / client accessor", () => {
    expect(SRC.filter((f) => /leadFeeInvoice\b|lead_fee_invoices/.test(code(f)))).toEqual([REPO]);
  });

  it("the adapter exposes no update / delete / upsert (invoices are immutable)", () => {
    expect(code(REPO)).not.toMatch(/leadFeeInvoice\.(update|updateMany|delete|deleteMany|upsert|createMany)\b/);
  });

  it("the whole M150 surface is exactly these five source files plus the known consumers (M151 credit-note files, which reference the invoice by design)", () => {
    const users = SRC.filter(mentionsInvoice).sort();
    expect(users).toEqual([...M150_FILES, ...M151_CONSUMERS].sort());
  });

  it("the use case is constructed only by its composition root, and nothing else imports that root (no route, action, webhook, job or UI)", () => {
    expect(SRC.filter((f) => /new IssueLeadFeeInvoiceUseCase\b/.test(code(f)))).toEqual([COMPOSE]);
    expect(SRC.filter((f) => /use-cases\/lead-fee-invoice\/compose|makeIssueLeadFeeInvoiceUseCase/.test(code(f)) && f !== COMPOSE)).toEqual([]);
  });

  it("issuance is never triggered by payment initiation, the webhook, confirmation, notifications or purchase code", () => {
    const flows = SRC.filter((f) => /use-cases\/(lead-fee-payment|lead-purchase|lead-purchase-eligibility|notification|lead|onboarding)\//.test(f) || /app\/api\//.test(f));
    expect(flows.length).toBeGreaterThan(10);
    for (const f of flows) expect(code(f), f).not.toMatch(/LeadFeeInvoice|lead-fee-invoice|lead_fee_invoices/);
  });
});

describe("M150 — isolation from legacy invoicing and payments", () => {
  it("legacy invoicing / payment / payout / commission / financial / affiliate code never references the lead-fee invoice", () => {
    const legacy = SRC.filter((f) => /use-cases\/(payments|payout|payouts|commission|financial|invoicing|invoice|affiliate|partner|reconciliation)\//.test(f) || /repositories\/prisma-(payment|payout|commission|financial|invoice|credit-note|transaction)/.test(f));
    expect(legacy.length).toBeGreaterThan(10);
    for (const f of legacy) expect(code(f), f).not.toMatch(/LeadFeeInvoice|lead-fee-invoice|lead_fee_invoices/);
  });

  it("M150 code never reads or writes the legacy invoice / credit-note / payment / payout / transaction tables or their number series", () => {
    for (const f of M150_FILES) {
      expect(code(f), f).not.toMatch(/prisma\.(invoice|creditNote|payment|payout|commission|transaction|selfBillingAuthorization)\b|tx\.(invoice|creditNote|payment|payout|transaction)\b/);
      expect(code(f), f).not.toMatch(/PrismaInvoiceRepository|PrismaCreditNoteRepository|PrismaDocumentNumberAllocator|invoice-lifecycle|invoice-document|InvoiceNumberAllocator|"INV"|"CN"/);
    }
    expect(code(REPO)).toMatch(/allocateNextDocumentSequence\(tx, LEAD_FEE_INVOICE_SERIES, year\)/);
  });

  it("M150 does not import the legacy issuer constants (they silently default the legal name); only the pure placeholder predicate is shared", () => {
    for (const f of M150_FILES) {
      expect(code(f), f).not.toMatch(/import\s*\{[^}]*MAESTROYA_ISSUER_[^}]*\}\s*from\s*"@\/domain\/services\/invoicing-issuer"/);
    }
    expect(code(DOMAIN)).toMatch(/import \{ isPlaceholderIssuerTaxId \} from "@\/domain\/services\/invoicing-issuer"/);
  });

  it("the domain layer imports no infrastructure, Prisma or application code", () => {
    for (const f of [DOMAIN, PORT]) expect(code(f), f).not.toMatch(/@prisma\/client|@\/infrastructure|@\/application|from "next|process\.env/);
  });

  it("the use case depends on ports and the M146 readiness use case only (no Prisma / infrastructure import)", () => {
    expect(code(USE_CASE)).not.toMatch(/@prisma\/client|@\/infrastructure/);
    expect(code(USE_CASE)).toMatch(/GetProfessionalBillingReadinessUseCase/);
  });
});

describe("M150 — M149 / M146 / M147 boundaries", () => {
  it("the ledger and purchase adapters are unchanged in their write surface: they know nothing of invoices", () => {
    for (const f of [LEDGER_REPO, PURCHASE_REPO, "src/core/domain/services/lead-fee-revenue-ledger.ts", "src/core/domain/repositories/lead-fee-revenue-ledger-repository.ts"]) {
      expect(code(f), f).not.toMatch(/LeadFeeInvoice|lead-fee-invoice|lead_fee_invoices|leadFeeInvoice/);
    }
  });

  it("the invoice adapter never touches the ledger table accessor (M149 stays append-only and writer-restricted)", () => {
    expect(code(REPO)).not.toMatch(/leadFeeLedgerEntry\b|lead_fee_ledger_entries/);
    expect(code(REPO)).not.toMatch(/professionalBillingIdentity\.(update|updateMany|create|delete|upsert)/);
  });

  it("M146 readiness is consumed only through GetProfessionalBillingReadinessUseCase (no direct billing-identity repository in the use case)", () => {
    expect(code(USE_CASE)).not.toMatch(/ProfessionalBillingIdentityRepository|prisma-professional-billing-identity-repository/);
    expect(code(COMPOSE)).toMatch(/makeGetProfessionalBillingReadinessUseCase\(\)/);
  });

  it("M147 eligibility and M148 onboarding code do not mention the invoice", () => {
    for (const f of SRC.filter((x) => /lead-purchase-eligibility|professional-onboarding|use-cases\/onboarding\//.test(x))) expect(code(f), f).not.toMatch(/LeadFeeInvoice|lead-fee-invoice/);
  });

  it("the composition root reads configuration from the environment on each call and wires the Prisma ledger, purchase and invoice adapters", () => {
    const src = code(COMPOSE);
    expect(src).toMatch(/\(\) => resolveLeadFeeInvoiceIssuanceConfig\(process\.env\)/);
    expect(src).toMatch(/new PrismaLeadFeeRevenueLedgerRepository\(\)/);
    expect(src).toMatch(/new PrismaLeadFeeInvoiceRepository\(\)/);
    expect(src).toMatch(/new PrismaLeadPurchaseRepository\(\)/);
  });
});

describe("M150 — migration and schema", () => {
  const sql = () => read(MIGRATION);
  const nonComment = () => sql().split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

  it("is additive: creates only the lead_fee_invoices table, its indexes/constraints/triggers and two functions", () => {
    const s = nonComment();
    expect(s.match(/CREATE TABLE "[^"]+"/g)).toEqual(['CREATE TABLE "lead_fee_invoices"']);
    expect(s).not.toMatch(/\bDROP\b|\bTRUNCATE\b|\bCREATE TYPE\b|^\s*(INSERT INTO|DELETE FROM|UPDATE\s+")/im); // DDL only: no data statements
    expect(s.match(/ALTER TABLE "([^"]+)"/g)!.every((m) => m === 'ALTER TABLE "lead_fee_invoices"')).toBe(true);
  });

  it("does not alter, backfill or add triggers to the M149 ledger, lead purchases, billing identities or legacy invoices", () => {
    const s = nonComment();
    for (const table of ["lead_fee_ledger_entries", "lead_purchases", "professional_billing_identities", "invoices", "credit_notes", "invoice_number_counters"]) {
      expect(s, table).not.toMatch(new RegExp(`(ALTER TABLE|TRIGGER[^;]*ON|INSERT INTO|UPDATE|DELETE FROM)\\s+"${table}"`));
    }
  });

  it("declares the uniqueness, FK, CHECK and trigger guarantees the use case relies on", () => {
    const s = sql();
    expect(s).toMatch(/CREATE UNIQUE INDEX "lead_fee_invoices_invoiceNumber_key"/);
    expect(s).toMatch(/CREATE UNIQUE INDEX "lead_fee_invoices_ledgerEntryId_key"/);
    expect(s).toMatch(/CREATE UNIQUE INDEX "lead_fee_invoices_leadPurchaseId_key"/);
    expect(s).toMatch(/FOREIGN KEY \("ledgerEntryId"\) REFERENCES "lead_fee_ledger_entries"\("id"\) ON DELETE RESTRICT/);
    expect(s).toMatch(/"totalAmount" = "netFeeAmount" \+ "taxAmount"/);
    expect(s).toMatch(/"issuerTaxId" <> 'PENDING-CIF-CONFIRMATION'/);
    expect(s).toMatch(/BEFORE INSERT ON "lead_fee_invoices"/);
    expect(s).toMatch(/BEFORE UPDATE OR DELETE ON "lead_fee_invoices"/);
    expect(s).toMatch(/FOR SHARE/);
    expect(s).toMatch(/'CONFIRMED'/);
  });

  it("uses exact decimals for money and no float type anywhere in the table", () => {
    const table = sql().slice(sql().indexOf('CREATE TABLE "lead_fee_invoices"'), sql().indexOf("CONSTRAINT \"lead_fee_invoices_pkey\""));
    expect(table.match(/DECIMAL\(10,2\)/g)).toHaveLength(3);
    expect(table).not.toMatch(/DOUBLE|FLOAT|REAL|MONEY/i);
  });

  it("the Prisma model and ledger back-relation exist, with RESTRICT deletion and Decimal(10,2) money", () => {
    const schema = read("prisma/schema.prisma");
    const model = schema.slice(schema.indexOf("model LeadFeeInvoice {"));
    const body = model.slice(0, model.indexOf("\n}\n"));
    expect(body).toMatch(/invoiceNumber\s+String\s+@unique/);
    expect(body).toMatch(/ledgerEntryId\s+String\s+@unique/);
    expect(body).toMatch(/leadPurchaseId\s+String\s+@unique/);
    expect(body).toMatch(/onDelete: Restrict/);
    expect(body.match(/@db\.Decimal\(10, 2\)/g)).toHaveLength(3);
    expect(body).toMatch(/@@map\("lead_fee_invoices"\)/);
    expect(schema).toMatch(/invoice LeadFeeInvoice\?/);
  });
});
