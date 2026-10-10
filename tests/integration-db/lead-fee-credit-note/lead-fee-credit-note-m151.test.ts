/**
 * Module 151 — Lead-Fee Credit Note against REAL PostgreSQL.
 *
 * Proves what mocks cannot: the migration's DDL, the unique indexes, CHECKs and INSERT / append-only triggers, the
 * transactional number allocation (rollback burns no number), the per-invoice advisory lock under genuinely concurrent
 * issuance, immutability of the invoice / ledger / purchase the credit note refers to, and the absence of side effects.
 * Run with `npm run test:integration:db` (requires the guarded test database — see tests/test-utils/db).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StripePaymentWebhookEvent } from "@/application/ports/stripe-payment-webhook-verifier";
import { GetProfessionalBillingReadinessUseCase } from "@/application/use-cases/billing-identity/get-professional-billing-readiness.use-case";
import { ProcessLeadFeePaymentWebhookUseCase } from "@/application/use-cases/lead-fee-payment/process-lead-fee-payment-webhook.use-case";
import { IssueLeadFeeCreditNoteUseCase } from "@/application/use-cases/lead-fee-credit-note/issue-lead-fee-credit-note.use-case";
import { IssueLeadFeeInvoiceUseCase } from "@/application/use-cases/lead-fee-invoice/issue-lead-fee-invoice.use-case";
import { ConfirmLeadPurchaseUseCase } from "@/application/use-cases/lead-purchase/confirm-lead-purchase.use-case";
import { TransitionLeadPurchaseUseCase } from "@/application/use-cases/lead-purchase/transition-lead-purchase.use-case";
import {
  LeadFeeCreditNoteNotIssuableError,
  buildLeadFeeCreditNoteDraft,
  type LeadFeeCreditNoteIssuanceConfig,
  type LeadFeeCreditNoteRejectionReason,
} from "@/domain/services/lead-fee-credit-note";
import type { LeadFeeInvoiceIssuanceConfig, LeadFeeInvoiceRecord } from "@/domain/services/lead-fee-invoice";
import { assertValidBillingIdentityDetails } from "@/domain/services/professional-billing-identity";
import { prisma } from "@/infrastructure/database/prisma/client";
import { PrismaExternalWebhookEventRepository } from "@/infrastructure/database/prisma/repositories/prisma-external-webhook-event-repository";
import { PrismaLeadFeeCreditNoteRepository, toLeadFeeCreditNoteCreateData } from "@/infrastructure/database/prisma/repositories/prisma-lead-fee-credit-note-repository";
import { PrismaLeadFeeInvoiceRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-fee-invoice-repository";
import { PrismaLeadFeeRevenueLedgerRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-fee-revenue-ledger-repository";
import { PrismaLeadPurchaseRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-purchase-repository";
import { PrismaLeadRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-repository";
import { PrismaProfessionalBillingIdentityRepository } from "@/infrastructure/database/prisma/repositories/prisma-professional-billing-identity-repository";
import { PrismaServiceRequestRepository } from "@/infrastructure/database/prisma/repositories/prisma-service-request-repository";

import { SNAPSHOT_DATA } from "../../test-utils/lead-publication-fixtures";
import { setupDbTestLifecycle } from "../../test-utils/db/db-test-lifecycle";
import {
  createAddress,
  createCustomerProfile,
  createProfessionalProfile,
  createServiceCategory,
  createServiceRequest,
  createUser,
} from "../../test-utils/db/seed-helpers";

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

describe("Module 151 — lead-fee credit note (real PostgreSQL)", () => {
  setupDbTestLifecycle();

  /**
   * Test isolation for the document-sequence counters. `invoice_number_counters` has no FK to any table the shared
   * harness truncates, so `TRUNCATE ... CASCADE` never resets it and a counter row would otherwise leak between tests
   * (and earlier runs), making "no number consumed" / "first number is 000001" assertions order-dependent. NOT a
   * production defect. Scoped to this module's own series ("LFC") and the M150 series ("LFI") the fixtures consume —
   * never INV/CN — and only ever runs against the guarded test database (`resolveTestDatabaseUrl`).
   */
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
  const invoiceIssuer = () =>
    new IssueLeadFeeInvoiceUseCase(ledger, purchases, new GetProfessionalBillingReadinessUseCase(identities), invoices, () => INVOICE_CONFIG, () => INVOICE_AT);
  const issuer = (config: LeadFeeCreditNoteIssuanceConfig = CREDIT_CONFIG) =>
    new IssueLeadFeeCreditNoteUseCase(invoices, creditNotes, () => config, () => CREDIT_AT);

  let seq = 0;
  let evt = 0;

  async function pendingPurchase(price = "100.00") {
    seq += 1;
    const customerUser = await createUser(prisma, { name: "Ana Cliente", email: `m151-customer-${seq}@test.maestroya.invalid` });
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
    const reference = `pi_m151_${seq}`;
    await purchases.recordPaymentReference(purchase.id, reference);
    return { lead, purchase, reference, profile };
  }

  function event(reference: string, amountMinorUnits: number): StripePaymentWebhookEvent {
    return {
      id: `evt_m151_${++evt}`,
      type: "payment_intent.succeeded",
      createdAt: new Date(),
      paymentIntent: { paymentIntentId: reference, lastPaymentErrorMessage: null, amountMinorUnits, currency: "eur", flow: "LEAD_V1", leadPurchaseId: null, leadId: null },
      chargeRefunded: null,
      dispute: null,
      chargeUpdated: null,
    };
  }

  async function verifiedBilling(professionalProfileId: string, patch: Record<string, unknown> = {}) {
    const admin = await createUser(prisma, { name: "Admin" });
    const { record } = await identities.saveDetails(professionalProfileId, assertValidBillingIdentityDetails({ ...BILLING, ...patch }));
    const verified = await identities.markVerified(record.id, record.revision, { adminUserId: admin.id, now: new Date() });
    expect(verified).not.toBeNull();
    return verified!;
  }

  /** CONFIRMED purchase (real verified-webhook path) with its M149 ledger entry, a verified billing identity and a real M150 invoice. */
  async function invoicedPurchase(price = "100.00", totalMinorUnits = 12100) {
    const base = await pendingPurchase(price);
    expect((await webhook().execute(event(base.reference, totalMinorUnits))).outcome).toBe("confirmed");
    const entry = await prisma.leadFeeLedgerEntry.findUniqueOrThrow({ where: { leadPurchaseId_entryType: { leadPurchaseId: base.purchase.id, entryType: "LEAD_FEE_PAYMENT_SUCCEEDED" } } });
    await verifiedBilling(base.profile.id);
    const { invoice } = await invoiceIssuer().execute(base.purchase.id);
    return { ...base, entry, invoice };
  }

  async function reasonOf(promise: Promise<unknown>): Promise<LeadFeeCreditNoteRejectionReason> {
    try {
      await promise;
    } catch (error) {
      expect(error).toBeInstanceOf(LeadFeeCreditNoteNotIssuableError);
      return (error as LeadFeeCreditNoteNotIssuableError).reason;
    }
    throw new Error("expected LeadFeeCreditNoteNotIssuableError");
  }

  const creditCounters = () => prisma.invoiceNumberCounter.findMany({ where: { series: "LFC" } });
  const creditNoteCount = () => prisma.leadFeeCreditNote.count();
  const sqlError = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      return String((error as Error).message);
    }
    throw new Error("expected a database error");
  };
  const draftFor = (invoice: LeadFeeInvoiceRecord, over: Record<string, unknown> = {}) => ({
    ...buildLeadFeeCreditNoteDraft({ invoice, reason: "Lead not delivered", config: CREDIT_CONFIG, issuedAt: CREDIT_AT }),
    ...over,
  });

  // ---------------------------------------------------------------- issuance
  it("issues one FULL credit note for an existing invoice: persisted amounts, number, FK, snapshots — and changes nothing else", async () => {
    const { purchase, entry, invoice, profile } = await invoicedPurchase();
    const invoiceBefore = JSON.stringify(await prisma.leadFeeInvoice.findUniqueOrThrow({ where: { id: invoice.id } }));
    const entryBefore = JSON.stringify(await prisma.leadFeeLedgerEntry.findUniqueOrThrow({ where: { id: entry.id } }));
    const purchaseBefore = JSON.stringify(await prisma.leadPurchase.findUniqueOrThrow({ where: { id: purchase.id } }));
    const invoiceCounterBefore = JSON.stringify((await prisma.invoiceNumberCounter.findMany({ where: { series: "LFI" } })).map((c) => [c.year, c.lastValue]));

    const { created, creditNote } = await issuer().execute({ leadPurchaseId: purchase.id, reason: "Lead not delivered" });
    expect(created).toBe(true);
    expect(creditNote.creditNoteNumber).toBe("LFC-2026-000001");

    const row = await prisma.leadFeeCreditNote.findUniqueOrThrow({ where: { id: creditNote.id } });
    expect(row).toMatchObject({
      leadFeeInvoiceId: invoice.id,
      originalInvoiceNumber: invoice.invoiceNumber,
      ledgerEntryId: entry.id,
      leadPurchaseId: purchase.id,
      professionalProfileId: profile.id,
      creditKind: "FULL",
      reason: "Lead not delivered",
      currency: "EUR",
      taxRateBps: 2100,
      recipientLegalName: BILLING.legalName,
      recipientTaxId: BILLING.taxId,
      issuerTaxId: ISSUER.taxId,
      policyApprovalReference: "TEST-CN-APPROVAL-1",
    });
    expect([String(row.creditedNetAmount), String(row.creditedTaxAmount), String(row.creditedTotalAmount)]).toEqual(["100", "21", "121"]);
    expect(row.originalInvoiceIssuedAt.getTime()).toBe(invoice.issuedAt.getTime());
    expect((await creditCounters())[0]?.lastValue).toBe(1);

    // The invoice, the M149 ledger entry, the purchase and the M150 counter are byte-for-byte untouched.
    expect(JSON.stringify(await prisma.leadFeeInvoice.findUniqueOrThrow({ where: { id: invoice.id } }))).toBe(invoiceBefore);
    expect(JSON.stringify(await prisma.leadFeeLedgerEntry.findUniqueOrThrow({ where: { id: entry.id } }))).toBe(entryBefore);
    expect(JSON.stringify(await prisma.leadPurchase.findUniqueOrThrow({ where: { id: purchase.id } }))).toBe(purchaseBefore);
    expect(JSON.stringify((await prisma.invoiceNumberCounter.findMany({ where: { series: "LFI" } })).map((c) => [c.year, c.lastValue]))).toBe(invoiceCounterBefore);
  });

  it("preserves exact decimals for awkward fees (net, IVA, total) with no float drift", async () => {
    const { purchase, invoice } = await invoicedPurchase("18.07", 2186);
    const { creditNote } = await issuer().execute({ leadPurchaseId: purchase.id, reason: "r" });
    expect([creditNote.creditedNetAmount, creditNote.creditedTaxAmount, creditNote.creditedTotalAmount]).toEqual(["18.07", "3.79", "21.86"]);
    const row = await prisma.leadFeeCreditNote.findUniqueOrThrow({ where: { id: creditNote.id } });
    expect([String(row.creditedNetAmount), String(row.creditedTaxAmount), String(row.creditedTotalAmount)]).toEqual([invoice.netFeeAmount, invoice.taxAmount, invoice.totalAmount]);
  });

  it("a refunded / revoked purchase can still be credited (eligibility is the invoice, not the purchase status) and the status is never changed by M151", async () => {
    for (const to of ["REFUNDED", "REVOKED"] as const) {
      const c = await invoicedPurchase();
      await purchases.transition(c.purchase.id, "CONFIRMED", to, new Date());
      const { created } = await issuer().execute({ leadPurchaseId: c.purchase.id, reason: "r" });
      expect(created).toBe(true);
      expect((await prisma.leadPurchase.findUniqueOrThrow({ where: { id: c.purchase.id } })).status).toBe(to);
    }
  });

  // ---------------------------------------------------------------- rejections
  it("rejects a purchase with no invoice (including one with a confirmed payment and ledger entry) and writes nothing", async () => {
    const base = await pendingPurchase();
    expect((await webhook().execute(event(base.reference, 12100))).outcome).toBe("confirmed");
    expect(await reasonOf(issuer().execute({ leadPurchaseId: base.purchase.id, reason: "r" }))).toBe("INVOICE_NOT_FOUND");
    expect(await reasonOf(issuer().execute({ leadPurchaseId: "99999999-9999-4999-8999-999999999999", reason: "r" }))).toBe("INVOICE_NOT_FOUND");
    expect(await creditNoteCount()).toBe(0);
    expect(await creditCounters()).toHaveLength(0);
  });

  it("rejects missing approval, missing issuer, a different issuer, a bad reason and partial / over-credit amounts — nothing persisted, no number consumed", async () => {
    const { purchase } = await invoicedPurchase();
    expect(await reasonOf(issuer({ ...CREDIT_CONFIG, policyApprovalReference: null }).execute({ leadPurchaseId: purchase.id, reason: "r" }))).toBe("POLICY_NOT_APPROVED");
    expect(await reasonOf(issuer({ ...CREDIT_CONFIG, issuer: null }).execute({ leadPurchaseId: purchase.id, reason: "r" }))).toBe("ISSUER_NOT_CONFIGURED");
    expect(await reasonOf(issuer({ ...CREDIT_CONFIG, issuer: { ...ISSUER, taxId: "B11111111" } }).execute({ leadPurchaseId: purchase.id, reason: "r" }))).toBe("ISSUER_MISMATCH");
    expect(await reasonOf(issuer().execute({ leadPurchaseId: purchase.id, reason: "   " }))).toBe("CREDIT_REASON_INVALID");
    expect(await reasonOf(issuer().execute({ leadPurchaseId: purchase.id, reason: "r", requestedAmounts: { netAmount: "50.00", taxAmount: "10.50", totalAmount: "60.50" } }))).toBe("PARTIAL_CREDIT_NOT_SUPPORTED");
    expect(await reasonOf(issuer().execute({ leadPurchaseId: purchase.id, reason: "r", requestedAmounts: { netAmount: "100.01", taxAmount: "21.00", totalAmount: "121.01" } }))).toBe("CREDIT_EXCEEDS_INVOICE");
    expect(await creditNoteCount()).toBe(0);
    expect(await creditCounters()).toHaveLength(0);
  });

  // ---------------------------------------------------------------- idempotency / concurrency
  it("a duplicate request returns the SAME credit note, creates no row and consumes no number — even after the gate is closed", async () => {
    const { purchase } = await invoicedPurchase();
    const first = await issuer().execute({ leadPurchaseId: purchase.id, reason: "original" });
    const second = await issuer().execute({ leadPurchaseId: purchase.id, reason: "different text" });
    const closed = await issuer({ issuer: null, policyApprovalReference: null }).execute({ leadPurchaseId: purchase.id, reason: "original" });
    for (const replay of [second, closed]) {
      expect(replay.created).toBe(false);
      expect(replay.creditNote.id).toBe(first.creditNote.id);
      expect(replay.creditNote.reason).toBe("original");
    }
    expect(await creditNoteCount()).toBe(1);
    expect((await creditCounters())[0]?.lastValue).toBe(1);
  });

  it("concurrent requests for the same invoice create exactly one credit note and consume exactly one number", async () => {
    const { purchase } = await invoicedPurchase();
    const results = await Promise.all(Array.from({ length: 8 }, () => issuer().execute({ leadPurchaseId: purchase.id, reason: "r" })));
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(new Set(results.map((r) => r.creditNote.id)).size).toBe(1);
    expect(await creditNoteCount()).toBe(1);
    expect((await creditCounters())[0]?.lastValue).toBe(1);
  });

  it("concurrent requests for different invoices yield distinct, gapless LFC numbers that never collide with LFI invoice numbers", async () => {
    const a = await invoicedPurchase();
    const b = await invoicedPurchase();
    const c = await invoicedPurchase();
    const results = await Promise.all([a, b, c].flatMap((p) => [issuer().execute({ leadPurchaseId: p.purchase.id, reason: "r" }), issuer().execute({ leadPurchaseId: p.purchase.id, reason: "r" })]));
    expect(results.filter((r) => r.created)).toHaveLength(3);
    const numbers = (await prisma.leadFeeCreditNote.findMany({ orderBy: { creditNoteNumber: "asc" } })).map((r) => r.creditNoteNumber);
    expect(numbers).toEqual(["LFC-2026-000001", "LFC-2026-000002", "LFC-2026-000003"]);
    const invoiceNumbers = (await prisma.leadFeeInvoice.findMany()).map((r) => r.invoiceNumber);
    expect(invoiceNumbers.filter((n) => numbers.includes(n))).toEqual([]);
    expect((await creditCounters())[0]?.lastValue).toBe(3);
  });

  // ---------------------------------------------------------------- transactions
  it("a failure inside the issuing transaction rolls back the allocated number and leaves no credit note", async () => {
    const { invoice } = await invoicedPurchase();
    const good = draftFor(invoice);
    // Passes every application check but the INSERT trigger rejects the amounts: the number was allocated first.
    const forged = { ...good, creditedNetAmount: "50.00", creditedTaxAmount: "10.50", creditedTotalAmount: "60.50" };
    await expect(creditNotes.issue(forged)).rejects.toThrow();
    expect(await creditNoteCount()).toBe(0);
    expect(await creditCounters()).toHaveLength(0); // the counter row itself was rolled back with the transaction

    const { creditNote } = await creditNotes.issue(good);
    expect(creditNote.creditNoteNumber).toBe("LFC-2026-000001"); // no gap
  });

  it("a draft that points at a nonexistent invoice is rejected by the database, leaving no row and no consumed number", async () => {
    const { invoice } = await invoicedPurchase();
    await expect(creditNotes.issue(draftFor(invoice, { leadFeeInvoiceId: "99999999-9999-4999-8999-999999999999" }))).rejects.toThrow();
    expect(await creditNoteCount()).toBe(0);
    expect(await creditCounters()).toHaveLength(0);
  });

  // ---------------------------------------------------------------- snapshot stability
  it("the issued credit note never changes when the professional's billing identity changes later; the replay returns the original", async () => {
    const { purchase, profile } = await invoicedPurchase();
    const { creditNote } = await issuer().execute({ leadPurchaseId: purchase.id, reason: "r" });
    const before = JSON.stringify(await prisma.leadFeeCreditNote.findUniqueOrThrow({ where: { id: creditNote.id } }));
    await identities.saveDetails(profile.id, assertValidBillingIdentityDetails({ ...BILLING, legalName: "Otro Nombre S.L.", taxId: "B99999999", addressLine1: "Otra Calle 1", city: "Sevilla", postalCode: "41001" }));
    expect(JSON.stringify(await prisma.leadFeeCreditNote.findUniqueOrThrow({ where: { id: creditNote.id } }))).toBe(before);
    const replay = await issuer().execute({ leadPurchaseId: purchase.id, reason: "r" });
    expect(replay).toMatchObject({ created: false });
    expect(replay.creditNote.recipientLegalName).toBe(BILLING.legalName);
  });

  // ---------------------------------------------------------------- database constraints
  describe("database constraints and triggers", () => {
    async function credited() {
      const c = await invoicedPurchase();
      const { creditNote } = await issuer().execute({ leadPurchaseId: c.purchase.id, reason: "r" });
      return { ...c, creditNote };
    }
    const create = (invoice: LeadFeeInvoiceRecord, number: string, patch: Record<string, unknown> = {}) =>
      prisma.leadFeeCreditNote.create({ data: { ...toLeadFeeCreditNoteCreateData(draftFor(invoice), number), ...patch } });

    it("is unique per invoice and per credit-note number (a second credit — e.g. a 'partial' one after a full one — is impossible)", async () => {
      const a = await credited();
      const b = await invoicedPurchase();
      expect(await sqlError(create(a.invoice, "LFC-2026-000099"))).toMatch(/Unique constraint|duplicate key|leadFeeInvoiceId/i);
      expect(await sqlError(create(b.invoice, a.creditNote.creditNoteNumber))).toMatch(/Unique constraint|duplicate key|creditNoteNumber/i);
      expect(await creditNoteCount()).toBe(1);
    });

    /**
     * Declarative constraints in isolation. PostgreSQL runs BEFORE INSERT row triggers BEFORE it evaluates CHECK
     * constraints, so a row that is wrong in a column the source-invoice trigger also compares (currency, amounts, issuer,
     * original invoice number) is rejected by the trigger and can never reveal which CHECK would also have fired. To
     * prove each CHECK independently, this helper inserts through the real Prisma model with triggers disabled for ONE
     * transaction (`SET LOCAL session_replication_role = replica`, which needs the test database's superuser and never
     * outlives the transaction); CHECK constraints are still enforced in that mode. Production code never does this.
     */
    const checkOnly = (invoice: LeadFeeInvoiceRecord, number: string, patch: Record<string, unknown> = {}) =>
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
        return tx.leadFeeCreditNote.create({ data: { ...toLeadFeeCreditNoteCreateData(draftFor(invoice), number), ...patch } });
      });

    it("each CHECK constraint rejects its own invariant in isolation (triggers disabled for the probe): number shapes, EUR, FULL kind, amounts, reason, placeholder issuer", async () => {
      const b = await invoicedPurchase();
      // Every case changes exactly ONE column of an otherwise valid row.
      for (const number of ["LFI-2026-000050", "INV-2026-000050", "CN-2026-000050", "LFC-26-1"]) {
        expect(await sqlError(checkOnly(b.invoice, number)), number).toMatch(/lead_fee_credit_notes_number_check/);
      }
      expect(await sqlError(checkOnly(b.invoice, "LFC-2026-000050", { originalInvoiceNumber: "INV-2026-000001" }))).toMatch(/lead_fee_credit_notes_number_check/);
      expect(await sqlError(checkOnly(b.invoice, "LFC-2026-000050", { currency: "USD" }))).toMatch(/lead_fee_credit_notes_kind_currency_check/);
      expect(await sqlError(checkOnly(b.invoice, "LFC-2026-000050", { creditKind: "PARTIAL" }))).toMatch(/lead_fee_credit_notes_kind_currency_check/);
      expect(await sqlError(checkOnly(b.invoice, "LFC-2026-000050", { creditedTotalAmount: "120.00" }))).toMatch(/lead_fee_credit_notes_amounts_check/); // 100 + 21 != 120
      expect(await sqlError(checkOnly(b.invoice, "LFC-2026-000050", { creditedNetAmount: "-100.00", creditedTotalAmount: "-79.00" }))).toMatch(/lead_fee_credit_notes_amounts_check/); // total = net + tax, but net <= 0
      expect(await sqlError(checkOnly(b.invoice, "LFC-2026-000050", { taxRateBps: 10001 }))).toMatch(/lead_fee_credit_notes_amounts_check/);
      expect(await sqlError(checkOnly(b.invoice, "LFC-2026-000050", { reason: "  " }))).toMatch(/lead_fee_credit_notes_mandatory_text_check/);
      expect(await sqlError(checkOnly(b.invoice, "LFC-2026-000050", { issuerTaxId: "PENDING-CIF-CONFIRMATION" }))).toMatch(/lead_fee_credit_notes_issuer_tax_id_check/);
      expect(await creditNoteCount()).toBe(0);
    });

    it("with triggers ACTIVE (production behaviour) the same invalid rows are all rejected, by the source-invoice trigger where it compares the column, otherwise by the CHECK", async () => {
      const b = await invoicedPurchase();
      const triggerMessage = /does not match its source lead-fee invoice/;
      // Columns the trigger compares with the invoice: the trigger is the stronger, earlier guard (it fires before CHECKs).
      expect(await sqlError(create(b.invoice, "LFC-2026-000050", { currency: "USD" }))).toMatch(triggerMessage);
      expect(await sqlError(create(b.invoice, "LFC-2026-000050", { creditedTotalAmount: "120.00" }))).toMatch(triggerMessage);
      expect(await sqlError(create(b.invoice, "LFC-2026-000050", { creditedNetAmount: "-100.00", creditedTotalAmount: "-79.00" }))).toMatch(triggerMessage);
      expect(await sqlError(create(b.invoice, "LFC-2026-000050", { issuerTaxId: "PENDING-CIF-CONFIRMATION" }))).toMatch(triggerMessage);
      expect(await sqlError(create(b.invoice, "LFC-2026-000050", { originalInvoiceNumber: "INV-2026-000001" }))).toMatch(triggerMessage);
      // Columns the trigger does NOT compare: only the CHECK can (and does) reject them.
      for (const number of ["LFI-2026-000050", "INV-2026-000050", "CN-2026-000050", "LFC-26-1"]) {
        expect(await sqlError(create(b.invoice, number)), number).toMatch(/lead_fee_credit_notes_number_check/);
      }
      expect(await sqlError(create(b.invoice, "LFC-2026-000050", { creditKind: "PARTIAL" }))).toMatch(/lead_fee_credit_notes_kind_currency_check/);
      expect(await sqlError(create(b.invoice, "LFC-2026-000050", { reason: "  " }))).toMatch(/lead_fee_credit_notes_mandatory_text_check/);
      expect(await creditNoteCount()).toBe(0);
    });

    it("the INSERT trigger rejects partial credits, over-credits and any snapshot that differs from the invoice", async () => {
      const b = await invoicedPurchase();
      const re = /does not match its source lead-fee invoice/;
      expect(await sqlError(create(b.invoice, "LFC-2026-000060", { creditedNetAmount: "50.00", creditedTaxAmount: "10.50", creditedTotalAmount: "60.50" }))).toMatch(re); // partial
      expect(await sqlError(create(b.invoice, "LFC-2026-000060", { creditedNetAmount: "200.00", creditedTaxAmount: "42.00", creditedTotalAmount: "242.00" }))).toMatch(re); // over-credit
      expect(await sqlError(create(b.invoice, "LFC-2026-000060", { taxRateBps: 1000, creditedTaxAmount: "10.00", creditedTotalAmount: "110.00" }))).toMatch(re);
      expect(await sqlError(create(b.invoice, "LFC-2026-000060", { originalInvoiceNumber: "LFI-2026-000777" }))).toMatch(re);
      expect(await sqlError(create(b.invoice, "LFC-2026-000060", { originalInvoiceIssuedAt: new Date("2026-01-01T00:00:00Z") }))).toMatch(re);
      expect(await sqlError(create(b.invoice, "LFC-2026-000060", { issuerTaxId: "B11111111" }))).toMatch(re);
      expect(await sqlError(create(b.invoice, "LFC-2026-000060", { recipientTaxId: "B99999999" }))).toMatch(re);
      expect(await sqlError(create(b.invoice, "LFC-2026-000060", { recipientCity: "Madrid" }))).toMatch(re);
      expect(await sqlError(create(b.invoice, "LFC-2026-000060", { professionalProfileId: "99999999-9999-4999-8999-999999999999" }))).toMatch(re);
      expect(await sqlError(create(b.invoice, "LFC-2026-000060", { taxPolicyVersion: "lead-fee-tax-policy-v2" }))).toMatch(re);
      expect(await creditNoteCount()).toBe(0);
    });

    it("the INSERT trigger rejects a credit note for a nonexistent invoice", async () => {
      const b = await invoicedPurchase();
      expect(await sqlError(create(b.invoice, "LFC-2026-000061", { leadFeeInvoiceId: "99999999-9999-4999-8999-999999999999" }))).toMatch(/requires an existing lead-fee invoice/);
      expect(await creditNoteCount()).toBe(0);
    });

    it("an issued credit note is append-only: UPDATE and DELETE are rejected", async () => {
      const a = await credited();
      expect(await sqlError(prisma.leadFeeCreditNote.update({ where: { id: a.creditNote.id }, data: { reason: "tampered" } }))).toMatch(/append-only/);
      expect(await sqlError(prisma.leadFeeCreditNote.update({ where: { id: a.creditNote.id }, data: { creditedNetAmount: "1.00", creditedTaxAmount: "0.00", creditedTotalAmount: "1.00" } }))).toMatch(/append-only/);
      expect(await sqlError(prisma.leadFeeCreditNote.delete({ where: { id: a.creditNote.id } }))).toMatch(/append-only/);
      expect((await prisma.leadFeeCreditNote.findUniqueOrThrow({ where: { id: a.creditNote.id } })).reason).toBe("r");
    });

    it("a credited invoice, its ledger entry and its purchase can be neither changed nor deleted (M149 / M150 stay append-only; FKs are RESTRICT)", async () => {
      const a = await credited();
      expect(await sqlError(prisma.leadFeeInvoice.delete({ where: { id: a.invoice.id } }))).toMatch(/append-only|foreign key|violates/i);
      expect(await sqlError(prisma.leadFeeInvoice.update({ where: { id: a.invoice.id }, data: { description: "tampered" } }))).toMatch(/append-only/);
      expect(await sqlError(prisma.leadFeeLedgerEntry.delete({ where: { id: a.entry.id } }))).toMatch(/append-only|foreign key|violates/i);
      expect(await sqlError(prisma.leadFeeLedgerEntry.update({ where: { id: a.entry.id }, data: { currency: "USD" } }))).toMatch(/append-only/);
      expect(await sqlError(prisma.leadPurchase.delete({ where: { id: a.purchase.id } }))).toMatch(/foreign key|violates/i);
      expect(await creditNoteCount()).toBe(1);
    });
  });

  // ---------------------------------------------------------------- isolation / regression
  it("has no side effects beyond its own table and counter: no refund, payment, payout, transaction, webhook event, legacy invoice / credit note, INV / CN / LFI counter or purchase change", async () => {
    const c = await invoicedPurchase();
    const snapshot = async () => ({
      legacyCounters: await prisma.invoiceNumberCounter.findMany({ where: { series: { in: ["INV", "CN", "LFI"] } }, orderBy: [{ series: "asc" }, { year: "asc" }] }),
      webhookEvents: await prisma.externalWebhookEvent.count(),
      purchases: JSON.stringify(await prisma.leadPurchase.findMany({ orderBy: { id: "asc" } })),
      entries: JSON.stringify(await prisma.leadFeeLedgerEntry.findMany({ orderBy: { id: "asc" } })),
      invoices: JSON.stringify(await prisma.leadFeeInvoice.findMany({ orderBy: { id: "asc" } })),
      identities: JSON.stringify(await prisma.professionalBillingIdentity.findMany({ orderBy: { id: "asc" } })),
    });
    const before = await snapshot();
    await issuer().execute({ leadPurchaseId: c.purchase.id, reason: "r" });
    expect(await snapshot()).toEqual(before);
    expect(await prisma.invoice.count()).toBe(0);
    expect(await prisma.creditNote.count()).toBe(0);
    expect(await prisma.payment.count()).toBe(0);
    expect(await prisma.payout.count()).toBe(0);
    expect(await prisma.transaction.count()).toBe(0);
  });

  it("regression: M149 still records exactly one entry per confirmed purchase and M150 issuance stays idempotent after a credit note exists", async () => {
    const c = await invoicedPurchase();
    await issuer().execute({ leadPurchaseId: c.purchase.id, reason: "r" });
    expect(await prisma.leadFeeLedgerEntry.count({ where: { leadPurchaseId: c.purchase.id } })).toBe(1);
    const replay = await invoiceIssuer().execute(c.purchase.id);
    expect(replay).toMatchObject({ created: false });
    expect(replay.invoice.id).toBe(c.invoice.id);
    expect(await prisma.leadFeeInvoice.count()).toBe(1);
  });
});
