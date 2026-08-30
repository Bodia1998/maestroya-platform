import { beforeEach, describe, expect, it } from "vitest";

import { IssuerTaxIdNotConfiguredError } from "@/domain/errors/domain-error";
import type { JobRecord } from "@/domain/repositories/job-repository";
import type { PaymentRecord } from "@/domain/repositories/payment-repository";
import type { QuoteRecord } from "@/domain/repositories/quote-repository";
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
  return { id: "customer-1", userId: "customer-user-1", ...overrides };
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
});
