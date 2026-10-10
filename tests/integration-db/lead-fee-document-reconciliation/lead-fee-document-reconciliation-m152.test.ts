/**
 * Module 152 — Lead-Fee Document Reconciliation against REAL PostgreSQL.
 *
 * Proves what mocks cannot: the Prisma reader's consistent REPEATABLE READ / READ ONLY snapshot and keyset paging, that a
 * dataset produced by the REAL M141 webhook → M149 ledger → M150 invoice → M151 credit-note flow reconciles cleanly, that
 * discrepancies are detected on persisted rows, and that running the reconciliation changes no row at all.
 *
 * Corrupt states cannot be produced through the application (that is the point of M149–M151's constraints and triggers).
 * To check that the reconciliation would notice them, ONE transaction at a time disables triggers and FK checks with
 * `SET LOCAL session_replication_role = replica` (needs the test database's superuser; never outlives the transaction;
 * CHECK constraints and unique indexes stay enforced) — the same technique the M151 suite uses for its constraint probes. It
 * is only ever executed against the guarded test database (`resolveTestDatabaseUrl`). Production code never does this.
 * Run with `npm run test:integration:db`.
 */
import type { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StripePaymentWebhookEvent } from "@/application/ports/stripe-payment-webhook-verifier";
import { GetProfessionalBillingReadinessUseCase } from "@/application/use-cases/billing-identity/get-professional-billing-readiness.use-case";
import { ProcessLeadFeePaymentWebhookUseCase } from "@/application/use-cases/lead-fee-payment/process-lead-fee-payment-webhook.use-case";
import { IssueLeadFeeCreditNoteUseCase } from "@/application/use-cases/lead-fee-credit-note/issue-lead-fee-credit-note.use-case";
import { IssueLeadFeeInvoiceUseCase } from "@/application/use-cases/lead-fee-invoice/issue-lead-fee-invoice.use-case";
import { ReconcileLeadFeeDocumentsUseCase } from "@/application/use-cases/lead-fee-document-reconciliation/reconcile-lead-fee-documents.use-case";
import { ConfirmLeadPurchaseUseCase } from "@/application/use-cases/lead-purchase/confirm-lead-purchase.use-case";
import { TransitionLeadPurchaseUseCase } from "@/application/use-cases/lead-purchase/transition-lead-purchase.use-case";
import type { LeadFeeCreditNoteIssuanceConfig } from "@/domain/services/lead-fee-credit-note";
import { LeadFeeReconciliationScopeTooLargeError } from "@/domain/services/lead-fee-document-reconciliation";
import type { LeadFeeInvoiceIssuanceConfig } from "@/domain/services/lead-fee-invoice";
import { assertValidBillingIdentityDetails } from "@/domain/services/professional-billing-identity";
import { prisma } from "@/infrastructure/database/prisma/client";
import { PrismaExternalWebhookEventRepository } from "@/infrastructure/database/prisma/repositories/prisma-external-webhook-event-repository";
import { PrismaLeadFeeCreditNoteRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-fee-credit-note-repository";
import { PrismaLeadFeeDocumentReconciliationReader } from "@/infrastructure/database/prisma/repositories/prisma-lead-fee-document-reconciliation-reader";
import { PrismaLeadFeeInvoiceRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-fee-invoice-repository";
import { PrismaLeadFeeRevenueLedgerRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-fee-revenue-ledger-repository";
import { PrismaLeadPurchaseRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-purchase-repository";
import { PrismaLeadRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-repository";
import { PrismaProfessionalBillingIdentityRepository } from "@/infrastructure/database/prisma/repositories/prisma-professional-billing-identity-repository";
import { PrismaServiceRequestRepository } from "@/infrastructure/database/prisma/repositories/prisma-service-request-repository";

import { SNAPSHOT_DATA } from "../../test-utils/lead-publication-fixtures";
import { setupDbTestLifecycle } from "../../test-utils/db/db-test-lifecycle";
import { createAddress, createCustomerProfile, createProfessionalProfile, createServiceCategory, createServiceRequest, createUser } from "../../test-utils/db/seed-helpers";

vi.mock("@/infrastructure/observability/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const ISSUER = { legalName: "Issuer Test S.L.", taxId: "B87654321", address: "Calle Falsa 123, 28001 Madrid, ES" };
const INVOICE_CONFIG: LeadFeeInvoiceIssuanceConfig = { issuer: ISSUER, policyApprovalReference: "TEST-APPROVAL-REF-1" };
const CREDIT_CONFIG: LeadFeeCreditNoteIssuanceConfig = { issuer: ISSUER, policyApprovalReference: "TEST-CN-APPROVAL-1" };
const INVOICE_AT = new Date("2026-10-10T08:30:00.000Z");
const CREDIT_AT = new Date("2026-10-12T09:00:00.000Z");
const BILLING = {
  entityType: "COMPANY",
  legalName: "Fontanería Mediterránea S.L.",
  taxId: "B12345674",
  taxCountry: "ES",
  addressLine1: "Carrer Major 12",
  city: "Gandia",
  region: "Valencia",
  postalCode: "46700",
  country: "ES",
};

describe("Module 152 — lead-fee document reconciliation (real PostgreSQL)", () => {
  setupDbTestLifecycle();

  /** Same document-sequence isolation as the M150 / M151 suites (counters have no FK the shared truncation reaches). Test database only. */
  beforeEach(async () => {
    await prisma.invoiceNumberCounter.deleteMany({ where: { series: { in: ["LFC", "LFI"] } } });
  });

  const leads = new PrismaLeadRepository();
  const purchases = new PrismaLeadPurchaseRepository();
  const ledger = new PrismaLeadFeeRevenueLedgerRepository();
  const identities = new PrismaProfessionalBillingIdentityRepository();
  const invoices = new PrismaLeadFeeInvoiceRepository();
  const creditNotes = new PrismaLeadFeeCreditNoteRepository();

  const webhook = () =>
    new ProcessLeadFeePaymentWebhookUseCase(
      purchases,
      leads,
      new ConfirmLeadPurchaseUseCase(purchases, leads, new PrismaServiceRequestRepository()),
      new TransitionLeadPurchaseUseCase(purchases),
      new PrismaExternalWebhookEventRepository(),
      undefined,
      ledger,
    );
  const invoiceIssuer = () => new IssueLeadFeeInvoiceUseCase(ledger, purchases, new GetProfessionalBillingReadinessUseCase(identities), invoices, () => INVOICE_CONFIG, () => INVOICE_AT);
  const creditIssuer = () => new IssueLeadFeeCreditNoteUseCase(invoices, creditNotes, () => CREDIT_CONFIG, () => CREDIT_AT);
  const reconcile = (options?: ConstructorParameters<typeof PrismaLeadFeeDocumentReconciliationReader>[0]) =>
    new ReconcileLeadFeeDocumentsUseCase(new PrismaLeadFeeDocumentReconciliationReader(options), () => new Date("2026-10-10T12:00:00.000Z")).execute();

  let seq = 0;
  let evt = 0;

  async function pendingPurchase(price = "100.00") {
    seq += 1;
    const customerUser = await createUser(prisma, { name: "Ana Cliente", email: `m152-customer-${seq}@test.maestroya.invalid` });
    const address = await createAddress(prisma, customerUser.id);
    const customer = await createCustomerProfile(prisma, customerUser.id);
    const category = await createServiceCategory(prisma);
    const request = await createServiceRequest(prisma, { customerId: customer.id, categoryId: category.id, addressId: address.id });
    await prisma.serviceRequest.update({ where: { id: request.id }, data: { flowVersion: "LEAD_V1" } });
    const draft = await leads.create({ serviceRequestId: request.id });
    const lead = (await leads.publish(draft.id, { ...SNAPSHOT_DATA, price, maxBuyers: 5 }))!;
    const proUser = await createUser(prisma, { name: "Pro" });
    const profile = await createProfessionalProfile(prisma, proUser.id);
    const purchase = await purchases.initiate({ leadId: lead.id, professionalProfileId: profile.id });
    const reference = `pi_m152_${seq}`;
    await purchases.recordPaymentReference(purchase.id, reference);
    return { lead, purchase, reference, profile };
  }

  function event(reference: string, amountMinorUnits: number): StripePaymentWebhookEvent {
    return {
      id: `evt_m152_${++evt}`,
      type: "payment_intent.succeeded",
      createdAt: new Date(),
      paymentIntent: { paymentIntentId: reference, lastPaymentErrorMessage: null, amountMinorUnits, currency: "eur", flow: "LEAD_V1", leadPurchaseId: null, leadId: null },
      chargeRefunded: null,
      dispute: null,
      chargeUpdated: null,
    };
  }

  async function verifiedBilling(professionalProfileId: string) {
    const admin = await createUser(prisma, { name: "Admin" });
    const { record } = await identities.saveDetails(professionalProfileId, assertValidBillingIdentityDetails({ ...BILLING }));
    const verified = await identities.markVerified(record.id, record.revision, { adminUserId: admin.id, now: new Date() });
    expect(verified).not.toBeNull();
  }

  /** CONFIRMED purchase through the real verified-webhook path, i.e. with its M149 ledger entry. */
  async function confirmedPurchase(price = "100.00", totalMinorUnits = 12100) {
    const base = await pendingPurchase(price);
    expect((await webhook().execute(event(base.reference, totalMinorUnits))).outcome).toBe("confirmed");
    const entry = await prisma.leadFeeLedgerEntry.findUniqueOrThrow({ where: { leadPurchaseId_entryType: { leadPurchaseId: base.purchase.id, entryType: "LEAD_FEE_PAYMENT_SUCCEEDED" } } });
    return { ...base, entry };
  }

  async function invoicedPurchase(price = "100.00", totalMinorUnits = 12100) {
    const base = await confirmedPurchase(price, totalMinorUnits);
    await verifiedBilling(base.profile.id);
    const { invoice } = await invoiceIssuer().execute(base.purchase.id);
    return { ...base, invoice };
  }

  async function creditedPurchase() {
    const base = await invoicedPurchase();
    const { creditNote } = await creditIssuer().execute({ leadPurchaseId: base.purchase.id, reason: "Lead not delivered" });
    return { ...base, creditNote };
  }

  /** Runs ONE statement with triggers and FK checks off (test database only). See the file header. */
  const corrupt = (run: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
    prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
        await run(tx);
      },
      { timeout: 60_000 },
    );

  /** Every table the reconciliation reads or must leave alone, with row versions (`xmin` changes on ANY rewrite of a row). */
  async function databaseFingerprint(): Promise<string> {
    const tables = ["lead_fee_ledger_entries", "lead_fee_invoices", "lead_fee_credit_notes", "lead_purchases", "invoice_number_counters", "professional_billing_identities", "invoices", "credit_notes", "payments", "payouts"];
    const parts: unknown[] = [];
    for (const table of tables) {
      parts.push(await prisma.$queryRawUnsafe(`SELECT t.*, t.xmin::text AS "__xmin" FROM "${table}" t ORDER BY t.ctid::text`));
    }
    return JSON.stringify(parts, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  }

  const codes = async (options?: Parameters<typeof reconcile>[0]) => (await reconcile(options)).findings.map((f) => f.code);

  // ------------------------------------------------------------------ clean data
  it("an empty database produces an empty, labelled report", async () => {
    const report = await reconcile();
    expect(report.scope).toEqual({ ledgerEntries: 0, invoices: 0, creditNotes: 0 });
    expect(report.findings).toEqual([]);
    expect(report.summary.total).toBe(0);
    expect(report.notice).toMatch(/not a statement of legal, tax or accounting compliance/);
  });

  it("data created by the REAL webhook → ledger → invoice → credit-note flow reconciles with no findings (including awkward decimals and non-confirmed purchases)", async () => {
    await invoicedPurchase();
    await creditedPurchase();
    await invoicedPurchase("18.07", 2186);
    // A refunded purchase with an invoice AND a credit note: eligibility of the credit is the invoice's, so this is consistent.
    const refunded = await creditedPurchase();
    await purchases.transition(refunded.purchase.id, "CONFIRMED", "REFUNDED", new Date());

    const report = await reconcile();
    expect(report.findings).toEqual([]);
    expect(report.scope).toEqual({ ledgerEntries: 4, invoices: 4, creditNotes: 2 });
  });

  // ------------------------------------------------------------------ ledger without invoice
  it("reports an eligible entry without an invoice as INFO / human review, and does NOT report entries of refunded or revoked purchases", async () => {
    const eligible = await confirmedPurchase();
    const refunded = await confirmedPurchase();
    const revoked = await confirmedPurchase();
    await purchases.transition(refunded.purchase.id, "CONFIRMED", "REFUNDED", new Date());
    await purchases.transition(revoked.purchase.id, "CONFIRMED", "REVOKED", new Date());

    const report = await reconcile();
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]).toMatchObject({
      code: "LEDGER_ENTRY_WITHOUT_INVOICE",
      severity: "INFO",
      verification: "HUMAN_REVIEW_REQUIRED",
      subject: { kind: "LEDGER_ENTRY", id: eligible.entry.id },
      leadPurchaseId: eligible.purchase.id,
    });
    expect(report.notEvaluated.ledgerEntriesWithPurchaseNotConfirmed).toBe(2);
  });

  // ------------------------------------------------------------------ detection on persisted rows
  it("detects amount, currency and source-reference mismatches of an invoice against its ledger entry", async () => {
    const a = await invoicedPurchase();
    const b = await invoicedPurchase();
    await corrupt((tx) => tx.$executeRaw`UPDATE "lead_fee_invoices" SET "netFeeAmount" = 101.00, "totalAmount" = 122.00 WHERE "id" = ${a.invoice.id}::uuid`);
    await corrupt((tx) => tx.$executeRaw`UPDATE "lead_fee_invoices" SET "currency" = 'USD', "leadId" = ${randomUUID()}::uuid WHERE "id" = ${b.invoice.id}::uuid`);

    const { findings } = await reconcile();
    const forA = findings.filter((f) => f.subject.id === a.invoice.id);
    expect(forA.filter((f) => f.code === "INVOICE_AMOUNT_MISMATCH").map((f) => [f.field, f.expected, f.observed, f.severity])).toEqual([
      ["netFeeAmount", "100.00", "101.00", "CRITICAL"],
      ["totalAmount", "121.00", "122.00", "CRITICAL"],
    ]);
    const forB = findings.filter((f) => f.subject.id === b.invoice.id).map((f) => f.code);
    expect(forB).toEqual(expect.arrayContaining(["INVOICE_CURRENCY_MISMATCH", "INVOICE_CURRENCY_UNSUPPORTED", "INVOICE_SOURCE_REFERENCE_MISMATCH"]));
  });

  it("detects an invoice whose ledger entry is gone, and a credit note whose invoice is gone (FK and triggers bypassed in the test database)", async () => {
    const a = await invoicedPurchase();
    const b = await creditedPurchase();
    await corrupt((tx) => tx.$executeRaw`DELETE FROM "lead_fee_ledger_entries" WHERE "id" = ${a.entry.id}::uuid`);
    await corrupt((tx) => tx.$executeRaw`DELETE FROM "lead_fee_invoices" WHERE "id" = ${b.invoice.id}::uuid`);

    const { findings } = await reconcile();
    expect(findings.find((f) => f.code === "INVOICE_LEDGER_ENTRY_MISSING")).toMatchObject({ subject: { kind: "INVOICE", id: a.invoice.id }, severity: "ERROR", verification: "AUTOMATIC" });
    expect(findings.find((f) => f.code === "CREDIT_NOTE_INVOICE_MISSING")).toMatchObject({ subject: { kind: "CREDIT_NOTE", id: b.creditNote.id } });
  });

  it("detects an over-credited and an inconsistent credit note (snapshots, currency basis, party) on persisted rows", async () => {
    const a = await creditedPurchase();
    const b = await creditedPurchase();
    await corrupt((tx) => tx.$executeRaw`UPDATE "lead_fee_credit_notes" SET "creditedNetAmount" = 100.01, "creditedTotalAmount" = 121.01 WHERE "id" = ${a.creditNote.id}::uuid`);
    await corrupt((tx) => tx.$executeRaw`UPDATE "lead_fee_credit_notes" SET "recipientCity" = 'Sevilla', "originalInvoiceNumber" = 'LFI-2026-000099' WHERE "id" = ${b.creditNote.id}::uuid`);

    const { findings } = await reconcile();
    const over = findings.filter((f) => f.code === "CREDIT_NOTE_EXCEEDS_INVOICE");
    expect(over.map((f) => [f.subject.id, f.field, f.expected, f.observed, f.severity])).toEqual([
      [a.creditNote.id, "creditedNetAmount", "100.00", "100.01", "CRITICAL"],
      [a.creditNote.id, "creditedTotalAmount", "121.00", "121.01", "CRITICAL"],
    ]);
    expect(findings.filter((f) => f.subject.id === b.creditNote.id).map((f) => [f.code, f.field])).toEqual(
      expect.arrayContaining([["CREDIT_NOTE_PARTY_SNAPSHOT_MISMATCH", "recipientCity"], ["CREDIT_NOTE_REFERENCE_MISMATCH", "originalInvoiceNumber"]]),
    );
    expect(JSON.stringify(findings)).not.toContain("Sevilla");
  });

  it("detects duplicate document numbers that differ only in zero padding (the only duplicate PostgreSQL's unique index lets through)", async () => {
    const a = await creditedPurchase();
    const b = await creditedPurchase();
    // LFI-2026-000001 / LFI-2026-000002 -> both the same sequence; the shape CHECK allows >= 6 digits, the unique index sees two strings.
    // The append-only trigger rejects a normal UPDATE, so use the guarded bypass.
    await corrupt((tx) => tx.$executeRaw`UPDATE "lead_fee_invoices" SET "invoiceNumber" = 'LFI-2026-0000001' WHERE "id" = ${b.invoice.id}::uuid`);
    await corrupt((tx) => tx.$executeRaw`UPDATE "lead_fee_credit_notes" SET "creditNoteNumber" = 'LFC-2026-0000001' WHERE "id" = ${b.creditNote.id}::uuid`);

    const { findings } = await reconcile();
    expect(findings.filter((f) => f.code === "INVOICE_NUMBER_DUPLICATE").map((f) => f.subject.id).sort()).toEqual([a.invoice.id, b.invoice.id].sort());
    expect(findings.filter((f) => f.code === "CREDIT_NOTE_NUMBER_DUPLICATE").map((f) => f.subject.id).sort()).toEqual([a.creditNote.id, b.creditNote.id].sort());
  });

  // ------------------------------------------------------------------ read-only and repeatable
  it("running the reconciliation (even with findings present) changes no row: identical content AND row versions before and after", async () => {
    const a = await creditedPurchase();
    await confirmedPurchase(); // ledger entry without invoice → an INFO finding
    await corrupt((tx) => tx.$executeRaw`UPDATE "lead_fee_credit_notes" SET "creditedNetAmount" = 100.01, "creditedTotalAmount" = 121.01 WHERE "id" = ${a.creditNote.id}::uuid`);

    const before = await databaseFingerprint();
    const report = await reconcile();
    expect(report.findings.length).toBeGreaterThanOrEqual(3);
    expect(await databaseFingerprint()).toBe(before);
  });

  it("the reader's own transaction is READ ONLY and REPEATABLE READ: a write attempted inside it is refused by the database", async () => {
    await invoicedPurchase();
    const before = await databaseFingerprint();
    let refused: unknown = null;
    let isolation = "";
    // The shared `prisma` singleton is NEVER mutated (no spy, no defineProperty, no restore): Prisma's client proxy reports
    // `$transaction` as an own data property whose value is `undefined`, so any save/restore of its descriptor destroys the method
    // for every later test. Instead the reader is handed a decorator that runs the REAL `$transaction` against PostgreSQL and
    // observes the very transaction the reader opened.
    const observing: Pick<typeof prisma, "$transaction"> = {
      $transaction: ((fn: (tx: Prisma.TransactionClient) => Promise<unknown>, options?: unknown) =>
        prisma.$transaction(async (tx) => {
          const result = await fn(tx); // the reader's own statements, including SET TRANSACTION READ ONLY, run first
          isolation = String((await tx.$queryRawUnsafe<{ transaction_isolation: string }[]>("SHOW transaction_isolation"))[0]?.transaction_isolation);
          try {
            await tx.leadFeeInvoice.deleteMany();
          } catch (error) {
            refused = error;
          }
          return result;
        }, options as never)) as never,
    };
    const transactionBefore = prisma.$transaction;
    await reconcile({ client: observing });
    expect(prisma.$transaction).toBe(transactionBefore);
    expect(typeof prisma.$transaction).toBe("function");
    expect(String(refused)).toMatch(/read-only transaction/i);
    expect(isolation).toBe("repeatable read");
    expect(await databaseFingerprint()).toBe(before);
  });

  it("repeated runs on unchanged data return identical findings, and a later normal issuance still works and consumes the next number", async () => {
    await creditedPurchase();
    await confirmedPurchase();
    const first = await reconcile();
    const second = await reconcile();
    expect(second.findings).toEqual(first.findings);
    expect(second.summary).toEqual(first.summary);

    const next = await invoicedPurchase();
    expect(next.invoice.invoiceNumber).toBe("LFI-2026-000002");
  });

  it("keeps reporting a discrepancy on every run until the data itself changes (M152 never marks anything resolved)", async () => {
    const a = await invoicedPurchase();
    await corrupt((tx) => tx.$executeRaw`UPDATE "lead_fee_invoices" SET "taxAmount" = 22.00, "totalAmount" = 122.00 WHERE "id" = ${a.invoice.id}::uuid`);
    expect(await codes()).toContain("INVOICE_AMOUNT_MISMATCH");
    expect(await codes()).toContain("INVOICE_AMOUNT_MISMATCH");
    await corrupt((tx) => tx.$executeRaw`UPDATE "lead_fee_invoices" SET "taxAmount" = 21.00, "totalAmount" = 121.00 WHERE "id" = ${a.invoice.id}::uuid`);
    expect(await codes()).toEqual([]);
  });

  // ------------------------------------------------------------------ scale and limits
  it("pages through many rows with a tiny page size and gives the same result as the default page size", async () => {
    await creditedPurchase();
    await creditedPurchase();
    await invoicedPurchase();
    await confirmedPurchase();
    const tiny = await reconcile({ pageSize: 1 });
    const two = await reconcile({ pageSize: 2 });
    const normal = await reconcile();
    expect(tiny.findings).toEqual(normal.findings);
    expect(two.findings).toEqual(normal.findings);
    expect(tiny.scope).toEqual({ ledgerEntries: 4, invoices: 3, creditNotes: 2 });
  });

  it("reconciles a large dataset (3,000 ledger entries / invoices, 1,500 credit notes) across several pages and still finds one planted defect", async () => {
    const N = 3_000;
    const professionalProfileId = randomUUID();
    const rows = Array.from({ length: N }, (_v, i) => {
      const n = String(i + 1).padStart(6, "0");
      return { entryId: randomUUID(), invoiceId: randomUUID(), noteId: randomUUID(), purchaseId: randomUUID(), leadId: randomUUID(), n };
    });
    await corrupt(async (tx) => {
      for (let start = 0; start < N; start += 500) {
        const chunk = rows.slice(start, start + 500);
        await tx.leadFeeLedgerEntry.createMany({
          data: chunk.map((r) => ({
            id: r.entryId, entryType: "LEAD_FEE_PAYMENT_SUCCEEDED" as const, leadPurchaseId: r.purchaseId, leadId: r.leadId, professionalProfileId, paymentReference: `pi_bulk_${r.n}`,
            providerEventId: `evt_bulk_${r.n}`, netFeeAmount: "100.00", taxAmount: "21.00", totalCollectedAmount: "121.00", currency: "EUR", taxPolicyVersion: "lead-fee-tax-policy-v1", paymentConfirmedAt: INVOICE_AT,
          })),
        });
        const party = {
          issuerLegalName: ISSUER.legalName, issuerTaxId: ISSUER.taxId, issuerAddress: ISSUER.address, recipientEntityType: "COMPANY" as const, recipientLegalName: BILLING.legalName, recipientTaxId: BILLING.taxId,
          recipientTaxCountry: "ES", recipientAddressLine1: BILLING.addressLine1, recipientCity: BILLING.city, recipientPostalCode: BILLING.postalCode, recipientCountry: "ES",
        };
        await tx.leadFeeInvoice.createMany({
          data: chunk.map((r) => ({
            id: r.invoiceId, invoiceNumber: `LFI-2026-${r.n}`, ledgerEntryId: r.entryId, leadPurchaseId: r.purchaseId, leadId: r.leadId, professionalProfileId, issuedAt: INVOICE_AT, paymentConfirmedAt: INVOICE_AT,
            currency: "EUR", netFeeAmount: "100.00", taxRateBps: 2100, taxAmount: "21.00", totalAmount: "121.00", taxPolicyVersion: "lead-fee-tax-policy-v1", description: "Lead access fee (LEAD_V1)",
            billingIdentityRevision: 1, billingIdentityVerifiedAt: INVOICE_AT, rulesVersion: "lead-fee-invoice-rules-v1", policyApprovalReference: "TEST-APPROVAL-REF-1", ...party,
          })),
        });
        await tx.leadFeeCreditNote.createMany({
          data: chunk.filter((_r, i) => (start + i) % 2 === 0).map((r) => ({
            id: r.noteId, creditNoteNumber: `LFC-2026-${r.n}`, leadFeeInvoiceId: r.invoiceId, originalInvoiceNumber: `LFI-2026-${r.n}`, originalInvoiceIssuedAt: INVOICE_AT, ledgerEntryId: r.entryId,
            leadPurchaseId: r.purchaseId, leadId: r.leadId, professionalProfileId, issuedAt: CREDIT_AT, creditKind: "FULL", reason: "bulk", currency: "EUR", creditedNetAmount: "100.00", taxRateBps: 2100,
            creditedTaxAmount: "21.00", creditedTotalAmount: "121.00", taxPolicyVersion: "lead-fee-tax-policy-v1", rulesVersion: "lead-fee-credit-note-rules-v1", policyApprovalReference: "TEST-CN-APPROVAL-1", ...party,
          })),
        });
      }
    });

    const clean = await reconcile();
    expect(clean.scope).toEqual({ ledgerEntries: N, invoices: N, creditNotes: N / 2 });
    expect(clean.findings).toEqual([]);
    // No purchase rows exist for the bulk entries (FK bypassed), so eligibility is not judged — and, having invoices, they need none.

    const target = rows[1235] as (typeof rows)[number]; // odd index: no credit note, so the defect stays on this one invoice
    await corrupt((tx) => tx.$executeRaw`UPDATE "lead_fee_invoices" SET "totalAmount" = 120.00, "taxAmount" = 20.00 WHERE "id" = ${target.invoiceId}::uuid`);
    const dirty = await reconcile();
    expect(dirty.findings.some((f) => f.subject.id === target.invoiceId && f.code === "INVOICE_AMOUNT_MISMATCH")).toBe(true);
    expect(dirty.findings.every((f) => f.subject.id === target.invoiceId)).toBe(true);
  }, 120_000);

  it("refuses to produce a partial result when a table exceeds the configured row limit", async () => {
    await invoicedPurchase();
    await invoicedPurchase();
    await expect(reconcile({ maxRowsPerTable: 1 })).rejects.toBeInstanceOf(LeadFeeReconciliationScopeTooLargeError);
    expect((await reconcile({ maxRowsPerTable: 2 })).findings).toEqual([]);
  });

  it("rejects invalid reader options", () => {
    expect(() => new PrismaLeadFeeDocumentReconciliationReader({ pageSize: 0 })).toThrow(RangeError);
    expect(() => new PrismaLeadFeeDocumentReconciliationReader({ maxRowsPerTable: 0 })).toThrow(RangeError);
  });
});
