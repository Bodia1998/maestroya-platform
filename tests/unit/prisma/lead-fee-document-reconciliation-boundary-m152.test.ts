import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { LEAD_FEE_RECONCILIATION_CATALOG } from "@/domain/services/lead-fee-document-reconciliation";

/**
 * Module 152 — static contract: the reconciliation is READ-ONLY, queries only, has no schema/migration of its own, is wired to no
 * route / action / webhook / cron / job / queue / scheduler, is deterministic by construction, and M149–M151 know nothing of it.
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

const DOMAIN = "src/core/domain/services/lead-fee-document-reconciliation.ts";
const PORT = "src/core/domain/repositories/lead-fee-document-reconciliation-reader.ts";
const READER = "src/core/infrastructure/database/prisma/repositories/prisma-lead-fee-document-reconciliation-reader.ts";
const USE_CASE = "src/core/application/use-cases/lead-fee-document-reconciliation/reconcile-lead-fee-documents.use-case.ts";
const COMPOSE = "src/core/application/use-cases/lead-fee-document-reconciliation/compose.ts";
const M152_FILES = [DOMAIN, PORT, READER, USE_CASE, COMPOSE];
const DOC = "docs/MODULE_152_LEAD_FEE_DOCUMENT_RECONCILIATION.md";

const mentionsM152 = (f: string) => /lead-fee-document-reconciliation|LeadFeeDocumentReconciliation|ReconcileLeadFeeDocuments|LeadFeeReconciliation/.test(code(f));

describe("M152 — read-only boundary", () => {
  it("the whole M152 surface is exactly these five source files", () => {
    expect(SRC.filter(mentionsM152).sort()).toEqual([...M152_FILES].sort());
  });

  it("the port is query-only: one method, no write verbs", () => {
    const src = code(PORT);
    expect(src.match(/^\s+\w+\(.*\): Promise</gm)).toHaveLength(1);
    expect(src).toMatch(/readSnapshot\(\): Promise<LeadFeeReconciliationSnapshot>/);
    expect(src).not.toMatch(/\b(create|update|delete|upsert|save|issue|record|resolve|repair|fix|mark|persist|write)\w*\(/i);
  });

  it("the Prisma adapter only reads: findMany, one READ ONLY / REPEATABLE READ transaction, no writes, no other raw SQL", () => {
    const src = code(READER);
    expect(src).not.toMatch(/\.(create|createMany|update|updateMany|delete|deleteMany|upsert)\b/);
    expect(src).not.toMatch(/\$queryRaw|\$executeRaw\b|\$executeRawUnsafe\(\s*[^"\s]|TRUNCATE|INSERT|DELETE FROM|UPDATE\s+"/);
    expect(src.match(/\$executeRawUnsafe\(/g)).toHaveLength(1);
    expect(src).toMatch(/\$executeRawUnsafe\("SET TRANSACTION READ ONLY"\)/);
    expect(src).toMatch(/Prisma\.TransactionIsolationLevel\.RepeatableRead/);
    expect(src.match(/\.findMany\(/g)!.length).toBe(4); // ledger, purchase status, invoices, credit notes
    expect(src.indexOf("SET TRANSACTION READ ONLY")).toBeLessThan(src.indexOf(".findMany("));
    expect(src).not.toMatch(/prisma\.(leadFee|leadPurchase)/); // only through the transaction client
  });

  it("the adapter reads only the ledger, invoice, credit-note tables and the purchase STATUS (no job value, billing identity, payment, payout or legacy invoice table)", () => {
    const accessors = [...code(READER).matchAll(/tx\.(\w+)\.findMany/g)].map((m) => m[1]).sort();
    expect(accessors).toEqual(["leadFeeCreditNote", "leadFeeInvoice", "leadFeeLedgerEntry", "leadPurchase"]);
    expect(code(READER)).toMatch(/select:\s*\{\s*id:\s*true,\s*status:\s*true\s*\}/);
    expect(code(READER)).not.toMatch(/reason/); // the credit note's free-text reason is never selected
    expect(code(READER)).not.toMatch(/professionalBillingIdentity|publicationEstimatedJobValue|jobValue|\.payment\b|\.payout\b|\.invoice\b|\.creditNote\b/);
  });

  it("the use case depends on the read-only port only (no Prisma / infrastructure import) and persists nothing", () => {
    const src = code(USE_CASE);
    expect(src).not.toMatch(/@prisma\/client|@\/infrastructure/);
    expect(src).toMatch(/private readonly reader: LeadFeeDocumentReconciliationReader/);
    expect(src.match(/this\.reader\.\w+\(/g)).toEqual(["this.reader.readSnapshot("]);
    expect(src).not.toMatch(/\b(save|persist|resolve|repair|issue|refund|revoke|transition)\w*\(/i);
  });

  it("no refund, Stripe, revoke, balance, e-mail, PDF, HTTP or purchase-status side effect is reachable from the M152 files", () => {
    for (const f of M152_FILES) {
      expect(code(f), f).not.toMatch(/stripe|Stripe|refund|Refund|revoke|Revoke|\.balance\b|Balance|sendEmail|resend|nodemailer|\bfetch\(|axios|pdf|Pdf|PDF|notification|Notification|transition\(|\.transition\b|allocateNextDocumentSequence/);
    }
  });

  it("the domain rules are pure and deterministic: no I/O, clock, randomness, environment or floating-point money", () => {
    const src = code(DOMAIN);
    expect(src).not.toMatch(/@prisma\/client|@\/infrastructure|@\/application|from "next|process\.env/);
    expect(src).not.toMatch(/Date\.now\(|new Date\(\)|Math\.random|randomUUID|parseFloat|toFixed\(|Number\(\s*\w*(amount|Amount|net|tax|total)/);
    expect(code(PORT)).not.toMatch(/@prisma\/client|@\/infrastructure|@\/application/);
  });

  it("the only clock is the use case's injected `now`, used for the report's generatedAt alone", () => {
    expect(code(USE_CASE).match(/new Date\(\)/g)).toHaveLength(1);
    expect(code(USE_CASE)).toMatch(/generatedAt: this\.now\(\)/);
  });
});

describe("M152 — no automatic trigger", () => {
  it("the use case is constructed only by its composition root, and nothing imports that root", () => {
    expect(SRC.filter((f) => /new ReconcileLeadFeeDocumentsUseCase\b/.test(code(f)))).toEqual([COMPOSE]);
    expect(SRC.filter((f) => /use-cases\/lead-fee-document-reconciliation\/compose|makeReconcileLeadFeeDocumentsUseCase/.test(code(f)) && f !== COMPOSE)).toEqual([]);
  });

  it("no route, page, Server Action, webhook, cron, job, queue, worker, middleware or instrumentation file references M152", () => {
    const entryPoints = SRC.filter((f) => /(^|\/)app\//.test(f) || /\/(actions?|jobs?|cron|webhooks?|queues?|workers?|schedul\w*)\//.test(f) || /^(middleware|instrumentation)\.ts$/.test(f) || /route\.ts$/.test(f) || /actions?\.ts$/.test(f));
    expect(entryPoints.length).toBeGreaterThan(10);
    for (const f of entryPoints) expect(code(f), f).not.toMatch(/lead-fee-document-reconciliation|LeadFeeDocumentReconciliation|ReconcileLeadFeeDocuments/);
  });

  it("no script, vercel cron, package script or other config references M152", () => {
    const configs = [...walk(path.join(root, "scripts")).map(rel), "vercel.json", "package.json", "instrumentation.ts", "middleware.ts"].filter((f) => existsSync(path.join(root, f)));
    expect(configs.length).toBeGreaterThan(5);
    for (const f of configs) expect(read(f), f).not.toMatch(/lead-fee-document-reconciliation|LeadFeeDocumentReconciliation|ReconcileLeadFeeDocuments|reconcile-lead-fee/);
  });

  it("the legacy reconciliation (Module 80/92) and the payment / webhook / confirmation flows never reference M152", () => {
    const flows = SRC.filter((f) => /use-cases\/(reconciliation|financial|payments|lead-fee-payment|lead-purchase|invoicing|invoice)\//.test(f) || /services\/reconciliation\//.test(f));
    expect(flows.length).toBeGreaterThan(20);
    for (const f of flows) expect(code(f), f).not.toMatch(/lead-fee-document-reconciliation|LeadFeeDocumentReconciliation|ReconcileLeadFeeDocuments/);
  });
});

describe("M152 — M149 / M150 / M151 are untouched by it", () => {
  it("their domain services, ports, use cases and composition roots know nothing of M152", () => {
    const files = SRC.filter((f) => /lead-fee-(revenue-ledger|invoice|credit-note)/.test(f) && !M152_FILES.includes(f));
    expect(files.length).toBeGreaterThanOrEqual(9);
    for (const f of files) expect(code(f), f).not.toMatch(/lead-fee-document-reconciliation|LeadFeeDocumentReconciliation|ReconcileLeadFeeDocuments|LeadFeeReconciliation/);
  });

  it("M152 introduces no schema change or migration", () => {
    const migrations = readdirSync(path.join(root, "prisma/migrations"));
    expect(migrations.filter((m) => /152|reconciliation/i.test(m) && /lead_fee|lead-fee|module_152/i.test(m))).toEqual([]);
    expect(read("prisma/schema.prisma")).not.toMatch(/Module 152|M152|LeadFeeReconciliation/);
  });
});

describe("M152 — documentation", () => {
  it("exists and states the read-only boundary, the finding catalogue, the unresolved decisions and the no-compliance disclaimer", () => {
    const doc = read(DOC);
    for (const heading of [/read-only/i, /Finding codes/i, /Severity/i, /Not automated/i, /Unresolved/i, /not a statement of legal, tax or accounting compliance/i, /Known limitations/i]) {
      expect(doc).toMatch(heading);
    }
    for (const codeName of Object.keys(LEAD_FEE_RECONCILIATION_CATALOG)) expect(doc, codeName).toContain(codeName);
  });
});
