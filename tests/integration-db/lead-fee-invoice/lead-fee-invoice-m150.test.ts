/**
 * Module 150 — Lead-Fee Invoice against REAL PostgreSQL.
 *
 * Proves what mocks cannot: the migration's DDL, the unique indexes, CHECKs and INSERT / append-only triggers, the
 * transactional number allocation (rollback burns no number), the per-ledger-entry advisory lock under genuinely
 * concurrent issuance, the FOR SHARE re-check of the billing identity, snapshot stability, and isolation from the
 * legacy invoice / payment tables. Run with `npm run test:integration:db`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StripePaymentWebhookEvent } from "@/application/ports/stripe-payment-webhook-verifier";
import { GetProfessionalBillingReadinessUseCase } from "@/application/use-cases/billing-identity/get-professional-billing-readiness.use-case";
import { ProcessLeadFeePaymentWebhookUseCase } from "@/application/use-cases/lead-fee-payment/process-lead-fee-payment-webhook.use-case";
import { IssueLeadFeeInvoiceUseCase } from "@/application/use-cases/lead-fee-invoice/issue-lead-fee-invoice.use-case";
import { ConfirmLeadPurchaseUseCase } from "@/application/use-cases/lead-purchase/confirm-lead-purchase.use-case";
import { TransitionLeadPurchaseUseCase } from "@/application/use-cases/lead-purchase/transition-lead-purchase.use-case";
import {
  LeadFeeInvoiceNotIssuableError,
  buildLeadFeeInvoiceDraft,
  type LeadFeeInvoiceIssuanceConfig,
  type LeadFeeInvoiceRejectionReason,
} from "@/domain/services/lead-fee-invoice";
import { assertValidBillingIdentityDetails } from "@/domain/services/professional-billing-identity";
import { prisma } from "@/infrastructure/database/prisma/client";
import { PrismaExternalWebhookEventRepository } from "@/infrastructure/database/prisma/repositories/prisma-external-webhook-event-repository";
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

const CONFIG: LeadFeeInvoiceIssuanceConfig = {
  issuer: { legalName: "Issuer Test S.L.", taxId: "B87654321", address: "Calle Falsa 123, 28001 Madrid, ES" },
  policyApprovalReference: "TEST-APPROVAL-REF-1",
};
const ISSUED_AT = new Date("2026-10-10T08:30:00.000Z");
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

describe("Module 150 — lead-fee invoice (real PostgreSQL)", () => {
  setupDbTestLifecycle();

  /**
   * Test isolation for the document-sequence counter. `invoice_number_counters` has no FK to any table the shared
   * harness truncates (see `reset-database.ts`), so `TRUNCATE ... CASCADE` never resets it and an LFI counter row
   * would otherwise leak from test to test (and from earlier runs against the same test database), making
   * "no number consumed" / "first number is 000001" assertions order-dependent. This is NOT a production defect:
   * the production allocator keeps its counter row by design (a rolled-back transaction removes it only if that
   * transaction created it). The reset is scoped to this module's own series "LFI" — never INV/CN — and only ever
   * runs against the guarded test database (`resolveTestDatabaseUrl`).
   */
  beforeEach(async () => {
    await prisma.invoiceNumberCounter.deleteMany({ where: { series: "LFI" } });
  });

  const leads = new PrismaLeadRepository();
  const purchases = new PrismaLeadPurchaseRepository();
  const ledger = new PrismaLeadFeeRevenueLedgerRepository();
  const identities = new PrismaProfessionalBillingIdentityRepository();
  const invoices = new PrismaLeadFeeInvoiceRepository();

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
  const issuer = (config: LeadFeeInvoiceIssuanceConfig = CONFIG) =>
    new IssueLeadFeeInvoiceUseCase(ledger, purchases, new GetProfessionalBillingReadinessUseCase(identities), invoices, () => config, () => ISSUED_AT);

  let seq = 0;
  let evt = 0;

  /** A PENDING_PAYMENT purchase with a payment reference (no ledger entry yet). */
  async function pendingPurchase(price = "100.00") {
    seq += 1;
    const customerUser = await createUser(prisma, { name: "Ana Cliente", email: `m150-customer-${seq}@test.maestroya.invalid` });
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
    const reference = `pi_m150_${seq}`;
    await purchases.recordPaymentReference(purchase.id, reference);
    return { lead, purchase, reference, profile };
  }

  function event(reference: string, amountMinorUnits: number): StripePaymentWebhookEvent {
    return {
      id: `evt_m150_${++evt}`,
      type: "payment_intent.succeeded",
      createdAt: new Date(),
      paymentIntent: { paymentIntentId: reference, lastPaymentErrorMessage: null, amountMinorUnits, currency: "eur", flow: "LEAD_V1", leadPurchaseId: null, leadId: null },
      chargeRefunded: null,
      dispute: null,
      chargeUpdated: null,
    };
  }

  /** A CONFIRMED purchase with its M149 ledger entry, produced by the real verified-webhook path. */
  async function confirmedPurchase(price = "100.00", totalMinorUnits = 12100) {
    const base = await pendingPurchase(price);
    expect((await webhook().execute(event(base.reference, totalMinorUnits))).outcome).toBe("confirmed");
    const entry = await prisma.leadFeeLedgerEntry.findUniqueOrThrow({ where: { leadPurchaseId_entryType: { leadPurchaseId: base.purchase.id, entryType: "LEAD_FEE_PAYMENT_SUCCEEDED" } } });
    return { ...base, entry };
  }

  async function verifiedBilling(professionalProfileId: string, patch: Record<string, unknown> = {}) {
    const admin = await createUser(prisma, { name: "Admin" });
    const { record } = await identities.saveDetails(professionalProfileId, assertValidBillingIdentityDetails({ ...BILLING, ...patch }));
    const verified = await identities.markVerified(record.id, record.revision, { adminUserId: admin.id, now: new Date() });
    expect(verified).not.toBeNull();
    return verified!;
  }

  async function reasonOf(promise: Promise<unknown>): Promise<LeadFeeInvoiceRejectionReason> {
    try {
      await promise;
    } catch (error) {
      expect(error).toBeInstanceOf(LeadFeeInvoiceNotIssuableError);
      return (error as LeadFeeInvoiceNotIssuableError).reason;
    }
    throw new Error("expected LeadFeeInvoiceNotIssuableError");
  }

  const counters = () => prisma.invoiceNumberCounter.findMany({ where: { series: "LFI" } });
  const invoiceCount = () => prisma.leadFeeInvoice.count();

  // ---------------------------------------------------------------- issuance
  it("issues one invoice for a confirmed ledger entry: persisted amounts, number, FK, recipient and issuer snapshot", async () => {
    const { purchase, entry, profile } = await confirmedPurchase();
    const identity = await verifiedBilling(profile.id);

    const { created, invoice } = await issuer().execute(purchase.id);
    expect(created).toBe(true);
    expect(invoice.invoiceNumber).toBe("LFI-2026-000001");

    const row = await prisma.leadFeeInvoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(row).toMatchObject({
      ledgerEntryId: entry.id,
      leadPurchaseId: purchase.id,
      professionalProfileId: profile.id,
      currency: "EUR",
      taxRateBps: 2100,
      recipientLegalName: BILLING.legalName,
      recipientTaxId: BILLING.taxId,
      recipientCity: "Gandia",
      billingIdentityRevision: identity.revision,
      issuerLegalName: CONFIG.issuer!.legalName,
      policyApprovalReference: "TEST-APPROVAL-REF-1",
    });
    expect([String(row.netFeeAmount), String(row.taxAmount), String(row.totalAmount)]).toEqual(["100", "21", "121"]);
    expect(row.paymentConfirmedAt.getTime()).toBe(entry.paymentConfirmedAt.getTime());
    expect((await counters())[0]?.lastValue).toBe(1);
  });

  it("preserves exact decimals for awkward fees (net, IVA, total) from the ledger, with no float drift", async () => {
    const { purchase, entry, profile } = await confirmedPurchase("18.07", 2186);
    await verifiedBilling(profile.id);
    const { invoice } = await issuer().execute(purchase.id);
    expect([invoice.netFeeAmount, invoice.taxAmount, invoice.totalAmount]).toEqual(["18.07", "3.79", "21.86"]);
    const row = await prisma.leadFeeInvoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect([String(row.netFeeAmount), String(row.taxAmount), String(row.totalAmount)]).toEqual([String(entry.netFeeAmount), String(entry.taxAmount), String(entry.totalCollectedAmount)]);
    expect([String(row.netFeeAmount), String(row.taxAmount), String(row.totalAmount)]).toEqual(["18.07", "3.79", "21.86"]);
  });

  it("rejects when no ledger entry exists (a purchase with a payment attempt but no confirmed payment) and writes nothing", async () => {
    const { purchase } = await pendingPurchase();
    expect(await reasonOf(issuer().execute(purchase.id))).toBe("LEDGER_ENTRY_MISSING");
    expect(await invoiceCount()).toBe(0);
    expect(await counters()).toHaveLength(0);
  });

  it("rejects failed / cancelled purchases (no entry) and refunded / revoked purchases (entry exists, purchase no longer CONFIRMED)", async () => {
    const failed = await pendingPurchase();
    await purchases.transition(failed.purchase.id, "PENDING_PAYMENT", "FAILED", new Date());
    expect(await reasonOf(issuer().execute(failed.purchase.id))).toBe("LEDGER_ENTRY_MISSING");

    const cancelled = await pendingPurchase();
    await purchases.transition(cancelled.purchase.id, "PENDING_PAYMENT", "CANCELLED", new Date());
    expect(await reasonOf(issuer().execute(cancelled.purchase.id))).toBe("LEDGER_ENTRY_MISSING");

    for (const to of ["REFUNDED", "REVOKED"] as const) {
      const confirmed = await confirmedPurchase();
      await verifiedBilling(confirmed.profile.id);
      await purchases.transition(confirmed.purchase.id, "CONFIRMED", to, new Date());
      expect(await reasonOf(issuer().execute(confirmed.purchase.id))).toBe("PURCHASE_NOT_CONFIRMED");
    }
    expect(await invoiceCount()).toBe(0);
    expect(await counters()).toHaveLength(0);
  });

  it("rejects missing, pending-review, administrator-rejected and later-edited billing identities", async () => {
    const missing = await confirmedPurchase();
    expect(await reasonOf(issuer().execute(missing.purchase.id))).toBe("BILLING_IDENTITY_NOT_READY");

    const pending = await confirmedPurchase();
    await identities.saveDetails(pending.profile.id, assertValidBillingIdentityDetails(BILLING));
    expect(await reasonOf(issuer().execute(pending.purchase.id))).toBe("BILLING_IDENTITY_NOT_READY");

    const rejected = await confirmedPurchase();
    const admin = await createUser(prisma, { name: "Admin" });
    const { record } = await identities.saveDetails(rejected.profile.id, assertValidBillingIdentityDetails(BILLING));
    await identities.markRejected(record.id, record.revision, { adminUserId: admin.id, now: new Date(), reason: "TAX_ID_MISMATCH", note: null });
    expect(await reasonOf(issuer().execute(rejected.purchase.id))).toBe("BILLING_IDENTITY_NOT_READY");

    const edited = await confirmedPurchase();
    await verifiedBilling(edited.profile.id);
    await identities.saveDetails(edited.profile.id, assertValidBillingIdentityDetails({ ...BILLING, city: "Valencia" }));
    expect(await reasonOf(issuer().execute(edited.purchase.id))).toBe("BILLING_IDENTITY_NOT_READY");
    expect(await invoiceCount()).toBe(0);
  });

  it("rejects unsupported tax scope (foreign country, Canarias) and unconfigured issuance (no approval, no issuer)", async () => {
    const foreign = await confirmedPurchase();
    await verifiedBilling(foreign.profile.id, { taxCountry: "DE", country: "DE", postalCode: "10115" });
    expect(await reasonOf(issuer().execute(foreign.purchase.id))).toBe("UNSUPPORTED_RECIPIENT_COUNTRY");

    const canarias = await confirmedPurchase();
    await verifiedBilling(canarias.profile.id, { postalCode: "35001" });
    expect(await reasonOf(issuer().execute(canarias.purchase.id))).toBe("UNSUPPORTED_TAX_TERRITORY");

    const ok = await confirmedPurchase();
    await verifiedBilling(ok.profile.id);
    expect(await reasonOf(issuer({ ...CONFIG, policyApprovalReference: null }).execute(ok.purchase.id))).toBe("POLICY_NOT_APPROVED");
    expect(await reasonOf(issuer({ ...CONFIG, issuer: null }).execute(ok.purchase.id))).toBe("ISSUER_NOT_CONFIGURED");
    expect(await invoiceCount()).toBe(0);
    expect(await counters()).toHaveLength(0);
  });

  // ---------------------------------------------------------------- idempotency / concurrency
  it("a duplicate issuance returns the SAME invoice, creates no row and consumes no number", async () => {
    const { purchase, profile } = await confirmedPurchase();
    await verifiedBilling(profile.id);
    const first = await issuer().execute(purchase.id);
    const second = await issuer().execute(purchase.id);
    expect(second.created).toBe(false);
    expect(second.invoice.id).toBe(first.invoice.id);
    expect(await invoiceCount()).toBe(1);
    expect((await counters())[0]?.lastValue).toBe(1);
  });

  it("concurrent issuance attempts for the same entry create exactly one invoice and consume exactly one number", async () => {
    const { purchase, profile } = await confirmedPurchase();
    await verifiedBilling(profile.id);
    const results = await Promise.all(Array.from({ length: 8 }, () => issuer().execute(purchase.id)));
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(new Set(results.map((r) => r.invoice.id)).size).toBe(1);
    expect(await invoiceCount()).toBe(1);
    expect((await counters())[0]?.lastValue).toBe(1);
  });

  it("concurrent issuance for different entries yields distinct, gapless numbers", async () => {
    const a = await confirmedPurchase();
    const b = await confirmedPurchase();
    const c = await confirmedPurchase();
    for (const p of [a, b, c]) await verifiedBilling(p.profile.id);
    const results = await Promise.all([a, b, c].flatMap((p) => [issuer().execute(p.purchase.id), issuer().execute(p.purchase.id)]));
    expect(results.filter((r) => r.created)).toHaveLength(3);
    const numbers = (await prisma.leadFeeInvoice.findMany({ orderBy: { invoiceNumber: "asc" } })).map((r) => r.invoiceNumber);
    expect(numbers).toEqual(["LFI-2026-000001", "LFI-2026-000002", "LFI-2026-000003"]);
    expect((await counters())[0]?.lastValue).toBe(3);
  });

  // ---------------------------------------------------------------- transactions
  it("a failure inside the issuing transaction rolls back the allocated number and leaves no invoice", async () => {
    const { purchase, entry, profile } = await confirmedPurchase();
    const identity = await verifiedBilling(profile.id);
    const readiness = await new GetProfessionalBillingReadinessUseCase(identities).execute(profile.id);
    const good = buildLeadFeeInvoiceDraft({
      ledgerEntry: { ...(await ledger.findByLeadPurchaseId(purchase.id))! },
      purchase: (await purchases.findById(purchase.id))!,
      billing: readiness.snapshot,
      config: CONFIG,
      issuedAt: ISSUED_AT,
    });
    // Passes every application check but the INSERT trigger rejects the amount: the number was allocated first.
    const forged = { ...good, taxAmount: "20.00", totalAmount: "120.00" };
    await expect(invoices.issue(forged)).rejects.toThrow();
    expect(await invoiceCount()).toBe(0);
    expect(await counters()).toHaveLength(0); // the counter row itself was rolled back with the transaction

    // The next real issuance still gets number 1 (no gap).
    const { invoice } = await invoices.issue(good);
    expect(invoice.invoiceNumber).toBe("LFI-2026-000001");
    expect(identity.revision).toBe(good.billingIdentityRevision);
    expect(entry.id).toBe(good.ledgerEntryId);
  });

  it("rejects BILLING_IDENTITY_CHANGED when the identity was edited after the draft was built, allocating no number", async () => {
    const { purchase, profile } = await confirmedPurchase();
    await verifiedBilling(profile.id);
    const readiness = await new GetProfessionalBillingReadinessUseCase(identities).execute(profile.id);
    const draft = buildLeadFeeInvoiceDraft({
      ledgerEntry: (await ledger.findByLeadPurchaseId(purchase.id))!,
      purchase: (await purchases.findById(purchase.id))!,
      billing: readiness.snapshot,
      config: CONFIG,
      issuedAt: ISSUED_AT,
    });
    await identities.saveDetails(profile.id, assertValidBillingIdentityDetails({ ...BILLING, city: "Valencia" })); // revision + 1, UNVERIFIED
    expect(await reasonOf(invoices.issue(draft))).toBe("BILLING_IDENTITY_CHANGED");
    expect(await invoiceCount()).toBe(0);
    expect(await counters()).toHaveLength(0);
  });

  // ---------------------------------------------------------------- snapshot stability
  it("the issued invoice never changes when the professional's billing identity changes later", async () => {
    const { purchase, profile } = await confirmedPurchase();
    await verifiedBilling(profile.id);
    const { invoice } = await issuer().execute(purchase.id);
    const before = JSON.stringify(await prisma.leadFeeInvoice.findUniqueOrThrow({ where: { id: invoice.id } }));

    await identities.saveDetails(profile.id, assertValidBillingIdentityDetails({ ...BILLING, legalName: "Otro Nombre S.L.", taxId: "B99999999", addressLine1: "Otra Calle 1", city: "Sevilla", postalCode: "41001" }));
    await prisma.professionalProfile.update({ where: { id: profile.id }, data: { businessName: "Changed Name", taxId: "X1234567L" } });

    expect(JSON.stringify(await prisma.leadFeeInvoice.findUniqueOrThrow({ where: { id: invoice.id } }))).toBe(before);
    const replay = await issuer().execute(purchase.id); // identity is UNVERIFIED now, yet the replay returns the original
    expect(replay).toMatchObject({ created: false });
    expect(replay.invoice.recipientLegalName).toBe(BILLING.legalName);
    expect(replay.invoice.recipientTaxId).toBe(BILLING.taxId);
  });

  // ---------------------------------------------------------------- database constraints
  describe("database constraints and triggers", () => {
    async function issued() {
      const c = await confirmedPurchase();
      await verifiedBilling(c.profile.id);
      const { invoice } = await issuer().execute(c.purchase.id);
      return { ...c, invoice };
    }
    const sqlError = async (promise: Promise<unknown>) => {
      try {
        await promise;
      } catch (error) {
        return String((error as Error).message);
      }
      throw new Error("expected a database error");
    };

    it("is unique per ledger entry, per purchase and per invoice number", async () => {
      const a = await issued();
      const b = await confirmedPurchase();
      await verifiedBilling(b.profile.id);
      const base = (await prisma.leadFeeInvoice.findUniqueOrThrow({ where: { id: a.invoice.id } }));
      const { id: _id, createdAt: _c, ...copy } = base;
      void _id; void _c;
      // same ledger entry again
      expect(await sqlError(prisma.leadFeeInvoice.create({ data: { ...copy, invoiceNumber: "LFI-2026-000099" } }))).toMatch(/Unique constraint|duplicate key|ledgerEntryId/i);
      // another entry reusing the number
      const readiness = await new GetProfessionalBillingReadinessUseCase(identities).execute(b.profile.id);
      const draft = buildLeadFeeInvoiceDraft({ ledgerEntry: (await ledger.findByLeadPurchaseId(b.purchase.id))!, purchase: (await purchases.findById(b.purchase.id))!, billing: readiness.snapshot, config: CONFIG, issuedAt: ISSUED_AT });
      const { toLeadFeeInvoiceCreateData } = await import("@/infrastructure/database/prisma/repositories/prisma-lead-fee-invoice-repository");
      expect(await sqlError(prisma.leadFeeInvoice.create({ data: toLeadFeeInvoiceCreateData(draft, a.invoice.invoiceNumber) }))).toMatch(/Unique constraint|duplicate key|invoiceNumber/i);
      expect(await invoiceCount()).toBe(1);
    });

    it("CHECK constraints reject forged amounts, number shapes, the placeholder issuer tax id and blank mandatory text", async () => {
      const a = await issued();
      const readinessFor = async (profileId: string) => (await new GetProfessionalBillingReadinessUseCase(identities).execute(profileId)).snapshot;
      const { toLeadFeeInvoiceCreateData } = await import("@/infrastructure/database/prisma/repositories/prisma-lead-fee-invoice-repository");
      const b = await confirmedPurchase();
      await verifiedBilling(b.profile.id);
      const draft = buildLeadFeeInvoiceDraft({ ledgerEntry: (await ledger.findByLeadPurchaseId(b.purchase.id))!, purchase: (await purchases.findById(b.purchase.id))!, billing: await readinessFor(b.profile.id), config: CONFIG, issuedAt: ISSUED_AT });
      const attempt = (patch: Record<string, unknown>, number = "LFI-2026-000050") => prisma.leadFeeInvoice.create({ data: { ...toLeadFeeInvoiceCreateData(draft, number), ...patch } });
      expect(await sqlError(attempt({}, "INV-2026-000050"))).toMatch(/number_check|check constraint/i);
      expect(await sqlError(attempt({ issuerTaxId: "PENDING-CIF-CONFIRMATION" }))).toMatch(/issuer_tax_id_check|check constraint/i);
      expect(await sqlError(attempt({ recipientLegalName: "   " }))).toMatch(/mandatory_text_check|check constraint/i);
      expect(await sqlError(attempt({ issuerAddress: "" }))).toMatch(/mandatory_text_check|check constraint/i);
      expect(await sqlError(attempt({ policyApprovalReference: " " }))).toMatch(/mandatory_text_check|check constraint/i);
      expect(await invoiceCount()).toBe(1);
      expect(a.invoice.invoiceNumber).toBe("LFI-2026-000001");
    });

    it("the INSERT trigger rejects amounts, tax policy, professional or confirmation time that differ from the ledger entry", async () => {
      const b = await confirmedPurchase();
      await verifiedBilling(b.profile.id);
      const readiness = await new GetProfessionalBillingReadinessUseCase(identities).execute(b.profile.id);
      const draft = buildLeadFeeInvoiceDraft({ ledgerEntry: (await ledger.findByLeadPurchaseId(b.purchase.id))!, purchase: (await purchases.findById(b.purchase.id))!, billing: readiness.snapshot, config: CONFIG, issuedAt: ISSUED_AT });
      const { toLeadFeeInvoiceCreateData } = await import("@/infrastructure/database/prisma/repositories/prisma-lead-fee-invoice-repository");
      const attempt = (patch: Record<string, unknown>) => prisma.leadFeeInvoice.create({ data: { ...toLeadFeeInvoiceCreateData(draft, "LFI-2026-000070"), ...patch } });
      const re = /does not match its lead-fee ledger entry/;
      expect(await sqlError(attempt({ netFeeAmount: "101.00", totalAmount: "122.00" }))).toMatch(re);
      expect(await sqlError(attempt({ taxPolicyVersion: "lead-fee-tax-policy-v2" }))).toMatch(re);
      expect(await sqlError(attempt({ paymentConfirmedAt: new Date("2026-01-01T00:00:00Z") }))).toMatch(re);
      expect(await sqlError(attempt({ currency: "USD" }))).toMatch(re);
      expect(await invoiceCount()).toBe(0);
    });

    it("the INSERT trigger rejects a purchase that is not CONFIRMED and an identity that is not VERIFIED at the snapshotted revision", async () => {
      const b = await confirmedPurchase();
      await verifiedBilling(b.profile.id);
      const readiness = await new GetProfessionalBillingReadinessUseCase(identities).execute(b.profile.id);
      const draft = buildLeadFeeInvoiceDraft({ ledgerEntry: (await ledger.findByLeadPurchaseId(b.purchase.id))!, purchase: (await purchases.findById(b.purchase.id))!, billing: readiness.snapshot, config: CONFIG, issuedAt: ISSUED_AT });
      const { toLeadFeeInvoiceCreateData } = await import("@/infrastructure/database/prisma/repositories/prisma-lead-fee-invoice-repository");
      const attempt = (patch: Record<string, unknown> = {}) => prisma.leadFeeInvoice.create({ data: { ...toLeadFeeInvoiceCreateData(draft, "LFI-2026-000071"), ...patch } });

      expect(await sqlError(attempt({ billingIdentityRevision: draft.billingIdentityRevision + 1 }))).toMatch(/VERIFIED billing identity/);
      await purchases.transition(b.purchase.id, "CONFIRMED", "REFUNDED", new Date());
      expect(await sqlError(attempt())).toMatch(/requires a CONFIRMED lead purchase/);
      expect(await invoiceCount()).toBe(0);
    });

    it("an issued invoice is append-only: UPDATE and DELETE are rejected", async () => {
      const a = await issued();
      expect(await sqlError(prisma.leadFeeInvoice.update({ where: { id: a.invoice.id }, data: { description: "tampered" } }))).toMatch(/append-only/);
      expect(await sqlError(prisma.leadFeeInvoice.delete({ where: { id: a.invoice.id } }))).toMatch(/append-only/);
      expect((await prisma.leadFeeInvoice.findUniqueOrThrow({ where: { id: a.invoice.id } })).description).toBe(a.invoice.description);
    });

    it("an invoiced ledger entry can be neither changed nor deleted (M149 stays append-only; FK is RESTRICT)", async () => {
      const a = await issued();
      expect(await sqlError(prisma.leadFeeLedgerEntry.delete({ where: { id: a.entry.id } }))).toMatch(/append-only|foreign key|violates/i);
      expect(await sqlError(prisma.leadFeeLedgerEntry.update({ where: { id: a.entry.id }, data: { currency: "USD" } }))).toMatch(/append-only/);
      expect(await sqlError(prisma.leadPurchase.delete({ where: { id: a.purchase.id } }))).toMatch(/foreign key|violates/i);
    });
  });

  // ---------------------------------------------------------------- isolation / regression
  it("never touches legacy invoices, credit notes, payments, payouts, transactions or their number series", async () => {
    const legacyCounters = () => prisma.invoiceNumberCounter.findMany({ where: { series: { in: ["INV", "CN"] } }, orderBy: [{ series: "asc" }, { year: "asc" }] });
    const legacyBefore = await legacyCounters(); // may be non-empty if another test/earlier run used INV/CN: compare, don't assume empty
    const { purchase, profile } = await confirmedPurchase();
    await verifiedBilling(profile.id);
    await issuer().execute(purchase.id);
    expect(await prisma.invoice.count()).toBe(0);
    expect(await prisma.creditNote.count()).toBe(0);
    expect(await prisma.payment.count()).toBe(0);
    expect(await prisma.payout.count()).toBe(0);
    expect(await prisma.transaction.count()).toBe(0);
    expect(await legacyCounters()).toEqual(legacyBefore);
  });

  it("regression: M149 still records exactly one entry per confirmed purchase, and M146 identity rules (reset on edit) still hold", async () => {
    const { purchase, profile } = await confirmedPurchase();
    expect(await prisma.leadFeeLedgerEntry.count({ where: { leadPurchaseId: purchase.id } })).toBe(1);
    const verified = await verifiedBilling(profile.id);
    expect(verified.verificationStatus).toBe("VERIFIED");
    const { record } = await identities.saveDetails(profile.id, assertValidBillingIdentityDetails({ ...BILLING, city: "Valencia" }));
    expect(record).toMatchObject({ verificationStatus: "UNVERIFIED", revision: verified.revision + 1, verifiedAt: null });
    await issuer().execute(purchase.id).catch(() => undefined);
    expect(await prisma.leadFeeLedgerEntry.count({ where: { leadPurchaseId: purchase.id } })).toBe(1);
  });
});
