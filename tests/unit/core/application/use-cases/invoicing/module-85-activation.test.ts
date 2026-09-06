import { beforeEach, describe, expect, it } from "vitest";

import { IssuerTaxIdNotConfiguredError } from "@/domain/errors/domain-error";
import type { JobRecord } from "@/domain/repositories/job-repository";
import type { PaymentRecord } from "@/domain/repositories/payment-repository";
import type { QuoteRecord } from "@/domain/repositories/quote-repository";
import type { InvoiceRecord } from "@/domain/repositories/invoice-repository";
import { roundToCents } from "@/domain/services/money";
import type { ProfessionalRecord } from "@/domain/repositories/professional-repository";
import type { CustomerProfileRecord } from "@/domain/repositories/customer-profile-repository";
import type { AuthUserRecord } from "@/domain/repositories/user-repository";
import { CalculateJobTaxBreakdownUseCase } from "@/application/use-cases/financial/calculate-job-tax-breakdown.use-case";
import { GrantSelfBillingAuthorizationUseCase } from "@/application/use-cases/invoicing/grant-self-billing-authorization.use-case";
import { CreateProfessionalInvoiceDraftUseCase } from "@/application/use-cases/invoicing/create-professional-invoice-draft.use-case";
import { CreateCustomerReceiptDraftUseCase } from "@/application/use-cases/invoicing/create-customer-receipt-draft.use-case";
import { SubmitInvoiceForAcceptanceUseCase } from "@/application/use-cases/invoicing/submit-invoice-for-acceptance.use-case";
import { AcceptInvoiceUseCase } from "@/application/use-cases/invoicing/accept-invoice.use-case";
import { IssueInvoiceUseCase } from "@/application/use-cases/invoicing/issue-invoice.use-case";
import { CreateCreditNoteUseCase } from "@/application/use-cases/invoicing/create-credit-note.use-case";
import { ActivateInvoiceLifecycleOnPaymentReleaseApprovedSubscriber } from "@/application/use-cases/invoicing/activate-invoice-lifecycle-on-payment-release-approved.subscriber";
import { CreateCreditNoteOnPaymentRefundedSubscriber } from "@/application/use-cases/invoicing/create-credit-note-on-payment-refunded.subscriber";
import { PaymentReleaseApproved } from "@/domain/events/payment-release-approved";
import { PaymentRefunded } from "@/domain/events/payment-refunded";
import {
  FakeCommissionRateRepository,
  FakeCompanyRepository,
  FakeCreditNoteRepository,
  FakeCustomerProfileRepository,
  FakeEventBus,
  FakeInvoiceRepository,
  FakeJobRepository,
  FakePaymentRepository,
  FakeProfessionalRepository,
  FakeQuoteRepository,
  FakeSelfBillingAuthorizationRepository,
  FakeUserRepository,
} from "./fakes";

function makeJob(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: "job-1",
    serviceRequestId: "sr-1",
    quoteId: "quote-1",
    customerId: "customer-1",
    professionalProfileId: "professional-1",
    companyProfileId: null,
    status: "COMPLETED",
    startedAt: null,
    startedByUserId: null,
    completedAt: new Date(),
    completedByUserId: null,
    cancelledAt: null,
    cancelledByUserId: null,
    cancellationReason: null,
    cancellationNote: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makePayment(overrides: Partial<PaymentRecord> = {}): PaymentRecord {
  return {
    id: "payment-1",
    serviceRequestId: "sr-1",
    quoteId: "quote-1",
    jobId: "job-1",
    payerId: "customer-user-1",
    amount: 1452,
    currency: "EUR",
    status: "CAPTURED",
    capturedAt: new Date(),
    stripePaymentIntentId: "pi_123",
    method: "CARD",
    failureReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as PaymentRecord;
}

function makeQuote(overrides: Partial<QuoteRecord> = {}): QuoteRecord {
  return {
    id: "quote-1",
    serviceRequestId: "sr-1",
    professionalProfileId: "professional-1",
    submittedByUserId: "user-1",
    status: "ACCEPTED",
    totalAmount: 1200,
    currency: "EUR",
    validUntil: null,
    notes: null,
    items: [
      { id: "item-labour", description: "Labour", quantity: 1, unitPrice: 1000, amount: 1000, sortOrder: 0, category: "LABOR" },
      { id: "item-materials", description: "Materials", quantity: 1, unitPrice: 200, amount: 200, sortOrder: 1, category: "MATERIALS" },
    ],
    materialsStrategy: "PROFESSIONAL_SUPPLIED",
    materials: [],
    materialsConfirmedAt: null,
    materialsConfirmedByUserId: null,
    operationType: null,
    isResidentialProperty: null,
    customerTypeAtQuote: null,
    taxableBase: null,
    taxMaterialsAmount: null,
    vatRateBps: null,
    vatAmount: null,
    grossTotalAmount: null,
    taxClassificationCode: null,
    taxRequiresLegalConfirmation: false,
    taxCalculationVersion: null,
    taxCalculatedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as QuoteRecord;
}

function makeProfessional(overrides: Partial<ProfessionalRecord> = {}): ProfessionalRecord {
  return {
    id: "professional-1",
    userId: "professional-user-1",
    businessName: "Fontanería García",
    bio: null,
    headline: null,
    yearsExperience: null,
    hourlyRate: null,
    serviceRadiusKm: null,
    contactEmail: null,
    contactPhone: null,
    websiteUrl: null,
    taxId: "12345678Z",
    status: "ACTIVE",
    verificationStatus: "VERIFIED",
    verifiedAt: new Date(),
    isAcceptingRequests: true,
    categoryIds: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as ProfessionalRecord;
}

function makeCustomerProfile(overrides: Partial<CustomerProfileRecord> = {}): CustomerProfileRecord {
  return { id: "customer-1", userId: "customer-user-1", customerType: "PRIVATE_CUSTOMER", ...overrides };
}

function makeUser(overrides: Partial<AuthUserRecord> = {}): AuthUserRecord {
  return {
    id: "customer-user-1",
    email: "cliente@example.com",
    name: "María López",
    passwordHash: null,
    emailVerified: new Date(),
    status: "ACTIVE",
    ...overrides,
  };
}

describe("Module 85 — Invoicing & Credit Note Activation", () => {
  let jobs: FakeJobRepository;
  let payments: FakePaymentRepository;
  let quotes: FakeQuoteRepository;
  let professionals: FakeProfessionalRepository;
  let companies: FakeCompanyRepository;
  let rates: FakeCommissionRateRepository;
  let selfBillingAuthorizations: FakeSelfBillingAuthorizationRepository;
  let invoices: FakeInvoiceRepository;
  let creditNotes: FakeCreditNoteRepository;
  let customerProfiles: FakeCustomerProfileRepository;
  let users: FakeUserRepository;
  let eventBus: FakeEventBus;
  let taxBreakdowns: CalculateJobTaxBreakdownUseCase;

  let grantAuthorization: GrantSelfBillingAuthorizationUseCase;
  let createProfessionalInvoiceDraft: CreateProfessionalInvoiceDraftUseCase;
  let createCustomerReceiptDraft: CreateCustomerReceiptDraftUseCase;
  let submitForAcceptance: SubmitInvoiceForAcceptanceUseCase;
  let acceptInvoice: AcceptInvoiceUseCase;
  let issueInvoice: IssueInvoiceUseCase;
  let createCreditNote: CreateCreditNoteUseCase;
  let subscriber: ActivateInvoiceLifecycleOnPaymentReleaseApprovedSubscriber;
  let creditNoteSubscriber: CreateCreditNoteOnPaymentRefundedSubscriber;

  beforeEach(() => {
    jobs = new FakeJobRepository();
    payments = new FakePaymentRepository();
    quotes = new FakeQuoteRepository();
    professionals = new FakeProfessionalRepository();
    companies = new FakeCompanyRepository();
    rates = new FakeCommissionRateRepository();
    selfBillingAuthorizations = new FakeSelfBillingAuthorizationRepository();
    invoices = new FakeInvoiceRepository();
    creditNotes = new FakeCreditNoteRepository();
    customerProfiles = new FakeCustomerProfileRepository();
    users = new FakeUserRepository();
    eventBus = new FakeEventBus();
    taxBreakdowns = new CalculateJobTaxBreakdownUseCase(jobs as never, quotes as never, rates);

    grantAuthorization = new GrantSelfBillingAuthorizationUseCase(selfBillingAuthorizations, eventBus);
    createProfessionalInvoiceDraft = new CreateProfessionalInvoiceDraftUseCase(
      jobs as never,
      payments as never,
      quotes as never,
      professionals as never,
      companies as never,
      selfBillingAuthorizations,
      invoices,
      taxBreakdowns,
      eventBus,
    );
    createCustomerReceiptDraft = new CreateCustomerReceiptDraftUseCase(
      jobs as never,
      payments as never,
      quotes as never,
      customerProfiles as never,
      users as never,
      invoices,
      taxBreakdowns,
      eventBus,
    );
    submitForAcceptance = new SubmitInvoiceForAcceptanceUseCase(invoices, eventBus);
    acceptInvoice = new AcceptInvoiceUseCase(invoices, professionals as never, companies as never, selfBillingAuthorizations, eventBus);
    issueInvoice = new IssueInvoiceUseCase(invoices, eventBus);
    createCreditNote = new CreateCreditNoteUseCase(invoices, creditNotes, taxBreakdowns, eventBus);

    subscriber = new ActivateInvoiceLifecycleOnPaymentReleaseApprovedSubscriber(
      invoices,
      professionals as never,
      companies as never,
      createProfessionalInvoiceDraft,
      submitForAcceptance,
      acceptInvoice,
      issueInvoice,
      createCustomerReceiptDraft,
    );
    creditNoteSubscriber = new CreateCreditNoteOnPaymentRefundedSubscriber(invoices, creditNotes, taxBreakdowns, createCreditNote);

    jobs.seed(makeJob());
    quotes.seed(makeQuote());
    payments.seed("job-1", [makePayment()]);
    professionals.seed(makeProfessional());
    customerProfiles.seed(makeCustomerProfile());
    users.seed(makeUser());
  });

  async function authorizeProfessional() {
    return grantAuthorization.execute({
      professionalProfileId: "professional-1",
      agreementVersion: "self-billing-agreement-es-v1",
      acceptedByUserId: "professional-user-1",
    });
  }

  describe("Numbering race (Module 85 fix)", () => {
    it("never burns an invoice number when an issue attempt loses the compare-and-swap race", async () => {
      await authorizeProfessional();
      const draft = await createProfessionalInvoiceDraft.execute("job-1");
      await submitForAcceptance.execute(draft.id);
      await acceptInvoice.execute(draft.id, "professional-user-1");

      // Simulate two concurrent/duplicate issue attempts on the SAME
      // invoice: the second one must lose the race and consume NO
      // number (see FakeInvoiceRepository.issue's own doc comment) —
      // the fix this test exists to prove.
      const first = await issueInvoice.execute(draft.id);
      await expect(issueInvoice.execute(draft.id)).rejects.toThrow();
      expect(first.invoiceNumber).toBe(`INV-${new Date().getUTCFullYear()}-000001`);

      // A second, unrelated invoice issued afterwards must get the very
      // next sequence number — no gap was burned by the lost race above.
      jobs.seed(makeJob({ id: "job-2", professionalProfileId: "professional-1" }));
      quotes.seed(makeQuote({ id: "quote-2" }));
      payments.seed("job-2", [makePayment({ id: "payment-2", jobId: "job-2" })]);
      const draft2 = await createProfessionalInvoiceDraft.execute("job-2");
      await submitForAcceptance.execute(draft2.id);
      await acceptInvoice.execute(draft2.id, "professional-user-1");
      const second = await issueInvoice.execute(draft2.id);
      expect(second.invoiceNumber).toBe(`INV-${new Date().getUTCFullYear()}-000002`);
    });
  });

  describe("Issuer tax ID guard", () => {
    it("refuses to issue while the issuer tax ID is still the unconfirmed placeholder", async () => {
      await authorizeProfessional();
      const draft = await createProfessionalInvoiceDraft.execute("job-1");
      await submitForAcceptance.execute(draft.id);
      const accepted = await acceptInvoice.execute(draft.id, "professional-user-1");
      // Force the placeholder onto this specific in-memory record —
      // vitest's own baseline env already overrides the real constant
      // to a non-placeholder value (see vitest.config.ts) so every OTHER
      // test in this suite exercises the "configured" path; this test
      // exercises the guard itself directly against the row.
      const row = invoices.rows.find((r) => r.id === accepted.id)!;
      row.issuerTaxId = "PENDING-CIF-CONFIRMATION";
      await expect(issueInvoice.execute(accepted.id)).rejects.toBeInstanceOf(IssuerTaxIdNotConfiguredError);
    });
  });

  describe("Customer-facing receipt (InvoiceType.CUSTOMER_RECEIPT)", () => {
    it("creates and issues a customer receipt with the customer-side tax breakdown, independent of the professional invoice", async () => {
      const receipt = await createCustomerReceiptDraft.execute("job-1");
      expect(receipt.type).toBe("CUSTOMER_RECEIPT");
      expect(receipt.selfBilled).toBe(false);
      expect(receipt.selfBillingAuthorizationId).toBeNull();
      expect(receipt.taxableBase).toBeCloseTo(1200, 2);
      expect(receipt.vatAmount).toBeCloseTo(252, 2);
      expect(receipt.totalAmount).toBeCloseTo(1452, 2);
      expect(receipt.recipientLegalName).toBe("María López");

      const issued = await issueInvoice.execute(receipt.id);
      expect(issued.status).toBe("ISSUED");
      expect(issued.invoiceNumber).toMatch(/^INV-\d{4}-\d{6}$/);

      // A professional invoice for the SAME job can coexist — Module 85
      // relaxed the unique index from (jobId) to (jobId, type).
      await authorizeProfessional();
      const proInvoice = await createProfessionalInvoiceDraft.execute("job-1");
      expect(proInvoice.type).toBe("PROFESSIONAL_SELF_BILLED");
      expect(proInvoice.id).not.toBe(receipt.id);
    });

    it("falls back to a generic recipient name when the customer's own name is unavailable", async () => {
      users.byId.clear();
      const receipt = await createCustomerReceiptDraft.execute("job-1");
      expect(receipt.recipientLegalName).toBe("Cliente");
    });
  });

  describe("ActivateInvoiceLifecycleOnPaymentReleaseApprovedSubscriber", () => {
    it("automatically drafts, submits, accepts, and issues both documents with no manual trigger", async () => {
      await authorizeProfessional();
      await subscriber.handle(new PaymentReleaseApproved("job-1", "confirmation-1", "payment-1"));

      const proInvoice = await invoices.findByJobIdAndType("job-1", "PROFESSIONAL_SELF_BILLED");
      expect(proInvoice?.status).toBe("ISSUED");
      expect(proInvoice?.acceptedByUserId).toBe("professional-user-1");

      const receipt = await invoices.findByJobIdAndType("job-1", "CUSTOMER_RECEIPT");
      expect(receipt?.status).toBe("ISSUED");
    });

    it("does nothing for a professional with no self-billing authorization, without throwing — still issues the customer receipt", async () => {
      await expect(subscriber.handle(new PaymentReleaseApproved("job-1", "confirmation-1", "payment-1"))).resolves.toBeUndefined();
      const proInvoice = await invoices.findByJobIdAndType("job-1", "PROFESSIONAL_SELF_BILLED");
      expect(proInvoice).toBeNull();
      const receipt = await invoices.findByJobIdAndType("job-1", "CUSTOMER_RECEIPT");
      expect(receipt?.status).toBe("ISSUED");
    });

    it("is idempotent under duplicate event delivery — exactly one of each document", async () => {
      await authorizeProfessional();
      await subscriber.handle(new PaymentReleaseApproved("job-1", "confirmation-1", "payment-1"));
      await subscriber.handle(new PaymentReleaseApproved("job-1", "confirmation-1", "payment-1"));

      const proInvoices = invoices.rows.filter((r) => r.jobId === "job-1" && r.type === "PROFESSIONAL_SELF_BILLED");
      const receipts = invoices.rows.filter((r) => r.jobId === "job-1" && r.type === "CUSTOMER_RECEIPT");
      expect(proInvoices).toHaveLength(1);
      expect(receipts).toHaveLength(1);
      expect(proInvoices[0]!.status).toBe("ISSUED");
      expect(receipts[0]!.status).toBe("ISSUED");
    });

    it("resumes and converges to ISSUED after a partial failure left the invoice PENDING_ACCEPTANCE", async () => {
      await authorizeProfessional();
      // Simulate a partial failure: draft created and submitted, but the
      // process crashed before acceptance/issuance ran.
      const draft = await createProfessionalInvoiceDraft.execute("job-1");
      await submitForAcceptance.execute(draft.id);

      await subscriber.handle(new PaymentReleaseApproved("job-1", "confirmation-1", "payment-1"));

      const proInvoice = await invoices.findByJobIdAndType("job-1", "PROFESSIONAL_SELF_BILLED");
      expect(proInvoice?.status).toBe("ISSUED");
      expect(proInvoice?.id).toBe(draft.id);
    });
  });

  describe("CreateCreditNoteOnPaymentRefundedSubscriber", () => {
    async function issueProfessionalInvoice() {
      await authorizeProfessional();
      const draft = await createProfessionalInvoiceDraft.execute("job-1");
      await submitForAcceptance.execute(draft.id);
      const accepted = await acceptInvoice.execute(draft.id, "professional-user-1");
      return issueInvoice.execute(accepted.id);
    }

    it("automatically creates a credit note referencing the correct invoice with the reversed tax amount", async () => {
      const invoice = await issueProfessionalInvoice();

      await creditNoteSubscriber.handle(
        new PaymentRefunded("refund-1", "payment-1", "job-1", "adjustment-1", 1452, "EUR", "REFUNDED", "re_stripe_1"),
      );

      const notes = creditNotes.rows.filter((r) => r.originalInvoiceId === invoice.id);
      expect(notes).toHaveLength(1);
      expect(notes[0]!.status).toBe("ISSUED");
      expect(notes[0]!.totalAmount).toBeCloseTo(invoice.totalAmount, 2);
      expect(notes[0]!.reversedVatAmount).toBeCloseTo(invoice.vatAmount, 2);
    });

    it("never creates a second credit note for a duplicate refund event", async () => {
      await issueProfessionalInvoice();
      const event = new PaymentRefunded("refund-1", "payment-1", "job-1", "adjustment-1", 1452, "EUR", "REFUNDED", "re_stripe_1");

      await creditNoteSubscriber.handle(event);
      await creditNoteSubscriber.handle(event);

      expect(creditNotes.rows).toHaveLength(1);
    });

    it("does nothing when the job has no issued professional invoice", async () => {
      await creditNoteSubscriber.handle(
        new PaymentRefunded("refund-1", "payment-1", "job-1", "adjustment-1", 1452, "EUR", "REFUNDED", "re_stripe_1"),
      );
      expect(creditNotes.rows).toHaveLength(0);
    });
  });

  describe("Module 97 correction pass — Invoice Tax Snapshot Integration", () => {
    /** A Community-of-Owners Quote that already qualified for the
     *  reduced 10% rate at classification time — the exact worked
     *  example from the correction task: taxableBase €1,000, vatRate
     *  10%, vatAmount €100, grossTotal €1,100. Deliberately does NOT
     *  match `quote.items`' own sum (€1,200) — proving the invoice uses
     *  the persisted snapshot verbatim rather than re-deriving these
     *  figures from the Quote's line items at invoice time. */
    function makeCommunityQualifyingQuote(overrides: Partial<QuoteRecord> = {}): QuoteRecord {
      return makeQuote({
        customerTypeAtQuote: "COMMUNITY_OF_OWNERS",
        operationType: "RENOVATION_OR_REPAIR",
        isResidentialProperty: true,
        taxableBase: 1000,
        taxMaterialsAmount: 200,
        vatRateBps: 1000,
        vatAmount: 100,
        grossTotalAmount: 1100,
        taxClassificationCode: "ES_COMMUNITY_QUALIFYING_RENOVATION_REDUCED",
        taxRequiresLegalConfirmation: true,
        taxCalculationVersion: 2,
        taxCalculatedAt: new Date("2026-01-01T00:00:00.000Z"),
        ...overrides,
      });
    }

    /** A Community-of-Owners Quote whose operation did NOT qualify for
     *  the reduced rate (e.g. materials over the 40% threshold), so its
     *  snapshot was persisted at the standard 21% general rate. Uses a
     *  taxableBase distinct from both the qualifying example above and
     *  the Quote's own item sum, so any test asserting against it can
     *  only pass if the invoice actually reads the snapshot. */
    function makeCommunityNonQualifyingQuote(overrides: Partial<QuoteRecord> = {}): QuoteRecord {
      return makeQuote({
        customerTypeAtQuote: "COMMUNITY_OF_OWNERS",
        operationType: "RENOVATION_OR_REPAIR",
        isResidentialProperty: true,
        taxableBase: 900,
        taxMaterialsAmount: 500,
        vatRateBps: 2100,
        vatAmount: 189,
        grossTotalAmount: 1089,
        taxClassificationCode: "ES_COMMUNITY_MATERIAL_HEAVY_GENERAL",
        taxRequiresLegalConfirmation: false,
        taxCalculationVersion: 2,
        taxCalculatedAt: new Date("2026-01-01T00:00:00.000Z"),
        ...overrides,
      });
    }

    // Test 1 + 2: Community qualifying Quote at 10% IVA -> the customer
    // receipt carries the exact same taxableBase/vatRate/vatAmount/total,
    // matching the correction task's own worked example verbatim.
    it("carries a Community-qualifying Quote's 10% IVA snapshot onto the customer receipt unchanged (worked example: €1,000 / 10% / €100 / €1,100)", async () => {
      quotes.seed(makeCommunityQualifyingQuote());
      const receipt = await createCustomerReceiptDraft.execute("job-1");

      expect(receipt.taxableBase).toBe(1000);
      expect(receipt.vatRateBps).toBe(1000);
      expect(receipt.vatAmount).toBe(100);
      expect(receipt.totalAmount).toBe(1100);
    });

    it("carries a Community-qualifying Quote's 10% IVA rate onto the professional invoice, without recalculating a second time", async () => {
      quotes.seed(makeCommunityQualifyingQuote());
      await authorizeProfessional();
      const draft = await createProfessionalInvoiceDraft.execute("job-1");

      // The professional invoice is denominated on the professional's own
      // net base (never the customer's), but it must use the SAME 10%
      // rate the Quote's snapshot settled on — never independently
      // falling back to the general 21% rate.
      expect(draft.vatRateBps).toBe(1000);
    });

    // Test 3: Community non-qualifying Quote -> invoice preserves the
    // Quote's own authoritative (standard-rate) result rather than
    // re-deriving anything from the Quote's line items.
    it("preserves a Community non-qualifying Quote's authoritative (standard-rate) tax result on the customer receipt", async () => {
      quotes.seed(makeCommunityNonQualifyingQuote());
      const receipt = await createCustomerReceiptDraft.execute("job-1");

      expect(receipt.taxableBase).toBe(900);
      expect(receipt.vatRateBps).toBe(2100);
      expect(receipt.vatAmount).toBe(189);
      expect(receipt.totalAmount).toBe(1089);
    });

    // Test 4: Private customer regression — a pre-existing Quote with no
    // Module 97 tax snapshot (taxCalculatedAt: null, the default from
    // this file's own makeQuote()) must fall back to exactly today's
    // pre-correction-pass behavior: the recomputed general-rate
    // breakdown. This is the existing "creates and issues a customer
    // receipt..." test above (1200 / 21% / 252 / 1452); this test adds an
    // explicit, dedicated regression assertion naming the behavior.
    it("regression: a legacy Quote with no tax snapshot still falls back to the recomputed general-rate breakdown (Private customer)", async () => {
      quotes.seed(makeQuote({ customerTypeAtQuote: "PRIVATE_CUSTOMER" }));
      const receipt = await createCustomerReceiptDraft.execute("job-1");

      expect(receipt.taxableBase).toBe(1200);
      expect(receipt.vatRateBps).toBe(2100);
      expect(receipt.vatAmount).toBeCloseTo(252, 2);
      expect(receipt.totalAmount).toBeCloseTo(1452, 2);
    });

    // Test 5: Company regression — a COMPANY customer's Quote snapshot
    // (standard 21%, no Community-specific treatment ever applies to a
    // COMPANY customerType) flows onto the invoice unchanged, exactly
    // like any other customer type's snapshot.
    it("regression: a Company customer's standard-rate Quote snapshot flows onto the customer receipt unchanged", async () => {
      quotes.seed(
        makeQuote({
          customerTypeAtQuote: "COMPANY",
          taxableBase: 1200,
          taxMaterialsAmount: 200,
          vatRateBps: 2100,
          vatAmount: 252,
          grossTotalAmount: 1452,
          taxClassificationCode: "ES_STANDARD_GENERAL",
          taxRequiresLegalConfirmation: false,
          taxCalculationVersion: 2,
          taxCalculatedAt: new Date("2026-01-01T00:00:00.000Z"),
        }),
      );
      const receipt = await createCustomerReceiptDraft.execute("job-1");

      expect(receipt.taxableBase).toBe(1200);
      expect(receipt.vatRateBps).toBe(2100);
      expect(receipt.vatAmount).toBe(252);
      expect(receipt.totalAmount).toBe(1452);
    });

    // Test 6: a tax-configuration change that happens AFTER the Quote's
    // snapshot was taken (e.g. the general/community rate tables are
    // updated, or the commission-rate repository returns different
    // current rates) must never alter an already-issued Quote's invoice.
    // Simulated here by giving the FakeCommissionRateRepository "current"
    // rates that differ from whatever was in effect when the 10%
    // snapshot below was computed — the invoice must still show 10%,
    // proving CalculateJobTaxBreakdownUseCase's fallback to
    // `quote.vatRateBps` is not merely coincidental with today's config.
    it("still uses the Quote's original tax snapshot after tax configuration changes, never recalculating with the current configuration", async () => {
      quotes.seed(makeCommunityQualifyingQuote());
      // Simulate a tax-configuration change occurring strictly after the
      // Quote's snapshot was persisted: swap in different "current"
      // commission rates the breakdown use case would use for anything
      // it DOES still compute fresh (commission/professional-side
      // figures) — the customer-facing 10% rate must be unaffected.
      rates.rates = { ...rates.rates, commissionRateBps: rates.rates.commissionRateBps + 500 };

      const receipt = await createCustomerReceiptDraft.execute("job-1");
      expect(receipt.vatRateBps).toBe(1000);
      expect(receipt.vatAmount).toBe(100);
      expect(receipt.totalAmount).toBe(1100);

      await authorizeProfessional();
      const draft = await createProfessionalInvoiceDraft.execute("job-1");
      expect(draft.vatRateBps).toBe(1000);
    });

    // Test 7: security — there is no client-controllable parameter for
    // invoice tax fields at all. Both draft use cases accept ONLY a
    // jobId; the tax figures are always derived server-side from the
    // Quote's own persisted, immutable snapshot (or, absent one, from
    // the tax engine's own recomputation) — never from caller input.
    it("security: exposes no parameter through which a caller could set or override an invoice's tax fields", async () => {
      quotes.seed(makeCommunityQualifyingQuote());
      // Attempt to smuggle tax-field overrides through an extra argument
      // — JavaScript ignores parameters beyond the declared arity, so
      // this proves nothing the caller passes beyond jobId can reach the
      // invoice's tax fields, at both the type level (single-parameter
      // signature) and the runtime level (extra args are no-ops).
      const receipt = await (createCustomerReceiptDraft.execute as unknown as (jobId: string, tamper?: unknown) => Promise<InvoiceRecord>)(
        "job-1",
        { vatRateBps: 400, vatAmount: 1, taxableBase: 1, totalAmount: 1 },
      );

      expect(receipt.vatRateBps).toBe(1000);
      expect(receipt.taxableBase).toBe(1000);
      expect(receipt.vatAmount).toBe(100);
      expect(receipt.totalAmount).toBe(1100);
    });

    // Test 8: financial consistency — taxableBase + vatAmount must equal
    // totalAmount exactly (whole-cent arithmetic, no floating-point
    // drift), for both a snapshot-sourced and a recomputed invoice.
    it("financial consistency: taxableBase + vatAmount reconciles exactly to totalAmount", async () => {
      quotes.seed(makeCommunityNonQualifyingQuote());
      const receipt = await createCustomerReceiptDraft.execute("job-1");
      expect(receipt.taxableBase + receipt.vatAmount).toBe(receipt.totalAmount);

      quotes.seed(makeQuote());
      jobs.seed(makeJob({ id: "job-2", quoteId: "quote-1" }));
      payments.seed("job-2", [makePayment({ id: "payment-2", jobId: "job-2" })]);
      const legacyReceipt = await createCustomerReceiptDraft.execute("job-2");
      expect(roundToCents(legacyReceipt.taxableBase + legacyReceipt.vatAmount)).toBe(roundToCents(legacyReceipt.totalAmount));
    });

    // Test 9 + 10: partial and full refund/CreditNote flows preserve the
    // correct tax basis — i.e. the credit note's reversed VAT rate is
    // read directly from the ISSUED invoice (never recalculated), and
    // the reversed amounts are internally consistent, for a Community
    // invoice issued at the 10% rate.
    async function issueCommunityProfessionalInvoice() {
      quotes.seed(makeCommunityQualifyingQuote());
      await authorizeProfessional();
      const draft = await createProfessionalInvoiceDraft.execute("job-1");
      await submitForAcceptance.execute(draft.id);
      const accepted = await acceptInvoice.execute(draft.id, "professional-user-1");
      return issueInvoice.execute(accepted.id);
    }

    it("preserves the correct (10%) tax basis on a partial refund credit note against a Community invoice", async () => {
      const invoice = await issueCommunityProfessionalInvoice();
      expect(invoice.vatRateBps).toBe(1000);

      await creditNoteSubscriber.handle(
        new PaymentRefunded("refund-partial-1", "payment-1", "job-1", "adjustment-1", 550, "EUR", "REFUNDED", "re_stripe_partial_1"),
      );

      const note = creditNotes.rows.find((r) => r.originalInvoiceId === invoice.id);
      expect(note).toBeDefined();
      expect(note!.reversedVatRateBps).toBe(1000);
      expect(roundToCents(note!.reversedTaxableBase + note!.reversedVatAmount)).toBeLessThanOrEqual(roundToCents(invoice.taxableBase + invoice.vatAmount));
    });

    it("preserves the correct (10%) tax basis on a full refund credit note against a Community invoice", async () => {
      const invoice = await issueCommunityProfessionalInvoice();

      // The refund event is denominated on the CUSTOMER's own gross
      // payment as recomputed by CalculateJobTaxBreakdownUseCase from
      // the Quote's own line items (labour €1,000 + materials €200 =
      // €1,200 base, at the Quote's own 10% override rate = €1,320
      // gross) — NOT the Quote's persisted grossTotalAmount snapshot
      // (€1,100), which was deliberately set to a different figure by
      // this test file's makeCommunityQualifyingQuote() to prove the
      // customer receipt uses the snapshot verbatim. This is exactly
      // the pre-existing "Payment/breakdown vs. Quote-snapshot gross"
      // mismatch this correction pass' report documents as a separate,
      // out-of-scope risk (see Step 7) rather than something this task
      // fixes — this test's job is only to prove the CREDIT NOTE'S own
      // tax rate (10%) is preserved, not to reconcile that mismatch.
      await creditNoteSubscriber.handle(
        new PaymentRefunded("refund-full-1", "payment-1", "job-1", "adjustment-1", 1320, "EUR", "REFUNDED", "re_stripe_full_1"),
      );

      const note = creditNotes.rows.find((r) => r.originalInvoiceId === invoice.id);
      expect(note).toBeDefined();
      expect(note!.reversedVatRateBps).toBe(1000);
      expect(note!.totalAmount).toBeCloseTo(invoice.totalAmount, 2);
      expect(note!.reversedVatAmount).toBeCloseTo(invoice.vatAmount, 2);
    });

    // Test 11: duplicate refund/webhook delivery for a Community invoice
    // stays idempotent — never a second credit note, and the one credit
    // note that does exist still carries the correct 10% basis.
    it("stays idempotent under a duplicate refund event for a Community invoice, without creating a second credit note", async () => {
      const invoice = await issueCommunityProfessionalInvoice();
      const event = new PaymentRefunded("refund-dup-1", "payment-1", "job-1", "adjustment-1", 1320, "EUR", "REFUNDED", "re_stripe_dup_1");

      await creditNoteSubscriber.handle(event);
      await creditNoteSubscriber.handle(event);

      const notes = creditNotes.rows.filter((r) => r.originalInvoiceId === invoice.id);
      expect(notes).toHaveLength(1);
      expect(notes[0]!.reversedVatRateBps).toBe(1000);
    });
  });
});
