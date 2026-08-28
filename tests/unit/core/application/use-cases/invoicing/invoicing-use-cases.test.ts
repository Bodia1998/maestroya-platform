import { beforeEach, describe, expect, it } from "vitest";

import { NotFoundError, SelfBillingNotAuthorizedError, UnauthorizedError, ValidationError, InvalidInvoiceTransitionError, CreditNoteExceedsRemainingAmountError } from "@/domain/errors/domain-error";
import type { JobRecord } from "@/domain/repositories/job-repository";
import type { PaymentRecord } from "@/domain/repositories/payment-repository";
import type { QuoteRecord } from "@/domain/repositories/quote-repository";
import type { ProfessionalRecord } from "@/domain/repositories/professional-repository";
import type { CompanyRecord } from "@/domain/repositories/company-repository";
import { CalculateJobTaxBreakdownUseCase } from "@/application/use-cases/financial/calculate-job-tax-breakdown.use-case";
import { GrantSelfBillingAuthorizationUseCase } from "@/application/use-cases/invoicing/grant-self-billing-authorization.use-case";
import { CreateProfessionalInvoiceDraftUseCase } from "@/application/use-cases/invoicing/create-professional-invoice-draft.use-case";
import { SubmitInvoiceForAcceptanceUseCase } from "@/application/use-cases/invoicing/submit-invoice-for-acceptance.use-case";
import { AcceptInvoiceUseCase } from "@/application/use-cases/invoicing/accept-invoice.use-case";
import { IssueInvoiceUseCase } from "@/application/use-cases/invoicing/issue-invoice.use-case";
import { MarkInvoicePaidUseCase } from "@/application/use-cases/invoicing/mark-invoice-paid.use-case";
import { CreateCreditNoteUseCase } from "@/application/use-cases/invoicing/create-credit-note.use-case";
import { CheckInvoiceRequiredForPayoutUseCase } from "@/application/use-cases/invoicing/check-invoice-required-for-payout.use-case";
import {
  FakeCommissionRateRepository,
  FakeCompanyRepository,
  FakeCreditNoteRepository,
  FakeEventBus,
  FakeInvoiceNumberAllocator,
  FakeInvoiceRepository,
  FakeJobRepository,
  FakePaymentRepository,
  FakeProfessionalRepository,
  FakeQuoteRepository,
  FakeSelfBillingAuthorizationRepository,
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

function makeCompany(overrides: Partial<CompanyRecord> = {}): CompanyRecord {
  return {
    id: "company-1",
    ownerUserId: "company-owner-user-1",
    legalName: "Reformas Madrid SL",
    tradeName: null,
    taxId: "B12345678",
    description: null,
    logoUrl: null,
    websiteUrl: null,
    slug: null,
    contactEmail: null,
    contactPhone: null,
    addressLine: null,
    city: null,
    province: null,
    postalCode: null,
    country: "ES",
    latitude: null,
    longitude: null,
    status: "ACTIVE",
    suspendedAt: null,
    isVerified: true,
    verifiedAt: new Date(),
    stripeConnectAccountId: null,
    averageRating: null,
    reviewCount: 0,
    isAcceptingRequests: true,
    categoryIds: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as CompanyRecord;
}

describe("Module 79 — Invoicing & Credit Notes use cases", () => {
  let jobs: FakeJobRepository;
  let payments: FakePaymentRepository;
  let quotes: FakeQuoteRepository;
  let professionals: FakeProfessionalRepository;
  let companies: FakeCompanyRepository;
  let rates: FakeCommissionRateRepository;
  let selfBillingAuthorizations: FakeSelfBillingAuthorizationRepository;
  let invoices: FakeInvoiceRepository;
  let creditNotes: FakeCreditNoteRepository;
  let numberAllocator: FakeInvoiceNumberAllocator;
  let eventBus: FakeEventBus;
  let taxBreakdowns: CalculateJobTaxBreakdownUseCase;

  let grantAuthorization: GrantSelfBillingAuthorizationUseCase;
  let createDraft: CreateProfessionalInvoiceDraftUseCase;
  let submitForAcceptance: SubmitInvoiceForAcceptanceUseCase;
  let acceptInvoice: AcceptInvoiceUseCase;
  let issueInvoice: IssueInvoiceUseCase;
  let markPaid: MarkInvoicePaidUseCase;
  let createCreditNote: CreateCreditNoteUseCase;
  let checkInvoiceForPayout: CheckInvoiceRequiredForPayoutUseCase;

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
    numberAllocator = new FakeInvoiceNumberAllocator();
    eventBus = new FakeEventBus();
    taxBreakdowns = new CalculateJobTaxBreakdownUseCase(jobs as never, quotes as never, rates);

    grantAuthorization = new GrantSelfBillingAuthorizationUseCase(selfBillingAuthorizations, eventBus);
    createDraft = new CreateProfessionalInvoiceDraftUseCase(
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
    submitForAcceptance = new SubmitInvoiceForAcceptanceUseCase(invoices, eventBus);
    acceptInvoice = new AcceptInvoiceUseCase(invoices, professionals as never, companies as never, selfBillingAuthorizations, eventBus);
    issueInvoice = new IssueInvoiceUseCase(invoices, numberAllocator, eventBus);
    markPaid = new MarkInvoicePaidUseCase(invoices, eventBus);
    createCreditNote = new CreateCreditNoteUseCase(invoices, creditNotes, taxBreakdowns, numberAllocator, eventBus);
    checkInvoiceForPayout = new CheckInvoiceRequiredForPayoutUseCase(invoices);

    jobs.seed(makeJob());
    quotes.seed(makeQuote());
    payments.seed("job-1", [makePayment()]);
    professionals.seed(makeProfessional());
    companies.seed(makeCompany());
  });

  async function authorizeProfessional() {
    return grantAuthorization.execute({
      professionalProfileId: "professional-1",
      agreementVersion: "self-billing-agreement-es-v1",
      acceptedByUserId: "professional-user-1",
    });
  }

  // 1. Professional without self-billing authorization cannot enter the flow.
  it("rejects invoice drafting for a professional without an active self-billing authorization", async () => {
    await expect(createDraft.execute("job-1")).rejects.toBeInstanceOf(SelfBillingNotAuthorizedError);
  });

  // 2. Authorized professional can create a DRAFT invoice.
  it("lets an authorized professional create a DRAFT invoice", async () => {
    await authorizeProfessional();
    const invoice = await createDraft.execute("job-1");
    expect(invoice.status).toBe("DRAFT");
    expect(invoice.professionalProfileId).toBe("professional-1");
    expect(invoice.totalAmount).toBeCloseTo(1306.8, 2);
  });

  // 3. Invoice contains immutable financial snapshots (matches Module 78's canonical example).
  it("snapshots the exact canonical Module 78 figures onto the invoice", async () => {
    await authorizeProfessional();
    const invoice = await createDraft.execute("job-1");
    expect(invoice.taxableBase).toBeCloseTo(1080, 2); // professional net base
    expect(invoice.vatRateBps).toBe(2100);
    expect(invoice.vatAmount).toBeCloseTo(226.8, 2);
    expect(invoice.commissionAmount).toBeCloseTo(120, 2);
    expect(invoice.totalAmount).toBeCloseTo(1306.8, 2);
  });

  it("never recreates a second DRAFT for the same job — returns the existing one instead", async () => {
    await authorizeProfessional();
    const first = await createDraft.execute("job-1");
    const second = await createDraft.execute("job-1");
    expect(second.id).toBe(first.id);
  });

  it("refuses to draft an invoice before the job is COMPLETED", async () => {
    jobs.seed(makeJob({ status: "IN_PROGRESS" }));
    await authorizeProfessional();
    await expect(createDraft.execute("job-1")).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses to draft an invoice before the customer payment is captured", async () => {
    payments.seed("job-1", []);
    await authorizeProfessional();
    await expect(createDraft.execute("job-1")).rejects.toBeInstanceOf(ValidationError);
  });

  // 20/21. Materials scenario correctness on the invoice snapshot itself.
  it("excludes CUSTOMER_PURCHASED materials from the professional invoice line items and totals", async () => {
    quotes.seed(
      makeQuote({
        materialsStrategy: "CUSTOMER_PURCHASED",
        items: [
          { id: "item-labour", description: "Labour", quantity: 1, unitPrice: 1000, amount: 1000, sortOrder: 0, category: "LABOR" },
          { id: "item-materials", description: "Materials", quantity: 1, unitPrice: 200, amount: 200, sortOrder: 1, category: "MATERIALS" },
        ],
      }),
    );
    await authorizeProfessional();
    const invoice = await createDraft.execute("job-1");
    expect(invoice.lineItems.some((li) => li.category === "MATERIALS")).toBe(false);
    // labour-only commission base (1000) -> commission 100 -> net base 900 -> total 900*1.21 = 1089
    expect(invoice.totalAmount).toBeCloseTo(1089, 2);
  });

  it("includes PROFESSIONAL_SUPPLIED materials on the invoice line items", async () => {
    await authorizeProfessional();
    const invoice = await createDraft.execute("job-1");
    expect(invoice.lineItems.some((li) => li.category === "MATERIALS")).toBe(true);
  });

  // 4/8. DRAFT -> PENDING_ACCEPTANCE.
  it("moves a DRAFT invoice to PENDING_ACCEPTANCE", async () => {
    await authorizeProfessional();
    const draft = await createDraft.execute("job-1");
    const submitted = await submitForAcceptance.execute(draft.id);
    expect(submitted.status).toBe("PENDING_ACCEPTANCE");
  });

  it("rejects submitting an already-submitted invoice a second time via the state machine", async () => {
    await authorizeProfessional();
    const draft = await createDraft.execute("job-1");
    await submitForAcceptance.execute(draft.id);
    await expect(submitForAcceptance.execute(draft.id)).rejects.toBeInstanceOf(InvalidInvoiceTransitionError);
  });

  // 5/7/8. Acceptance + evidence.
  it("lets the owning professional accept their own PENDING_ACCEPTANCE invoice, recording evidence", async () => {
    await authorizeProfessional();
    const draft = await createDraft.execute("job-1");
    await submitForAcceptance.execute(draft.id);
    const accepted = await acceptInvoice.execute(draft.id, "professional-user-1");
    expect(accepted.status).toBe("ACCEPTED");
    expect(accepted.acceptedByUserId).toBe("professional-user-1");
    expect(accepted.acceptedAt).toBeInstanceOf(Date);
    expect(accepted.acceptanceAgreementVersion).toBe("self-billing-agreement-es-v1");
  });

  // 6. Unauthorized user cannot accept.
  it("rejects acceptance by a user who does not own the invoice", async () => {
    await authorizeProfessional();
    const draft = await createDraft.execute("job-1");
    await submitForAcceptance.execute(draft.id);
    await expect(acceptInvoice.execute(draft.id, "some-other-user")).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("is idempotent when the same authorized user accepts twice", async () => {
    await authorizeProfessional();
    const draft = await createDraft.execute("job-1");
    await submitForAcceptance.execute(draft.id);
    const first = await acceptInvoice.execute(draft.id, "professional-user-1");
    const second = await acceptInvoice.execute(draft.id, "professional-user-1");
    expect(second.acceptedAt?.getTime()).toBe(first.acceptedAt?.getTime());
  });

  it("never allows acceptance of an already-ISSUED invoice", async () => {
    await authorizeProfessional();
    const draft = await createDraft.execute("job-1");
    await submitForAcceptance.execute(draft.id);
    await acceptInvoice.execute(draft.id, "professional-user-1");
    await issueInvoice.execute(draft.id);
    await expect(acceptInvoice.execute(draft.id, "professional-user-1")).rejects.toBeInstanceOf(InvalidInvoiceTransitionError);
  });

  // 9. ACCEPTED -> ISSUED.
  it("issues an ACCEPTED invoice, assigning a number and a document hash", async () => {
    await authorizeProfessional();
    const draft = await createDraft.execute("job-1");
    await submitForAcceptance.execute(draft.id);
    await acceptInvoice.execute(draft.id, "professional-user-1");
    const issued = await issueInvoice.execute(draft.id);
    expect(issued.status).toBe("ISSUED");
    expect(issued.invoiceNumber).toMatch(/^INV-\d{4}-\d{6}$/);
    expect(issued.documentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  // 10/11. Issued invoice cannot be edited; invalid transitions rejected.
  it("never allows an ISSUED invoice to be issued again or reverted", async () => {
    await authorizeProfessional();
    const draft = await createDraft.execute("job-1");
    await submitForAcceptance.execute(draft.id);
    await acceptInvoice.execute(draft.id, "professional-user-1");
    await issueInvoice.execute(draft.id);
    await expect(issueInvoice.execute(draft.id)).rejects.toBeInstanceOf(InvalidInvoiceTransitionError);
  });

  it("rejects every invalid lifecycle jump (e.g. DRAFT straight to ISSUED)", async () => {
    await authorizeProfessional();
    const draft = await createDraft.execute("job-1");
    await expect(issueInvoice.execute(draft.id)).rejects.toBeInstanceOf(InvalidInvoiceTransitionError);
  });

  // 12/13. Invoice numbering uniqueness, including under concurrency.
  it("never issues the same invoice number twice, even under concurrent issuance of different invoices", async () => {
    await authorizeProfessional();
    const invoiceIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const job = makeJob({ id: `job-${i}`, quoteId: `quote-${i}` });
      jobs.seed(job);
      quotes.seed(makeQuote({ id: `quote-${i}` }));
      payments.seed(`job-${i}`, [makePayment({ id: `payment-${i}`, jobId: `job-${i}`, quoteId: `quote-${i}` })]);
      const draft = await createDraft.execute(`job-${i}`);
      await submitForAcceptance.execute(draft.id);
      await acceptInvoice.execute(draft.id, "professional-user-1");
      invoiceIds.push(draft.id);
    }

    const issued = await Promise.all(invoiceIds.map((id) => issueInvoice.execute(id)));
    const numbers = issued.map((inv) => inv.invoiceNumber);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  // 18. Module 78 tax values used rather than recalculated — cross-check
  // against the same breakdown use case directly.
  it("uses Module 78's own tax breakdown values verbatim rather than recomputing them", async () => {
    await authorizeProfessional();
    const breakdown = await taxBreakdowns.execute("job-1");
    const invoice = await createDraft.execute("job-1");
    expect(invoice.totalAmount).toBe(breakdown.professionalInvoiceGrossTotal);
    expect(invoice.commissionAmount).toBe(breakdown.commissionAmount);
    expect(invoice.vatAmount).toBe(breakdown.professionalVatAmount);
  });

  // 19. Existing commission values unchanged — commission engine
  // (delegated) still reports the documented 10% flat rate.
  it("never changes the existing 10% flat commission model", async () => {
    await authorizeProfessional();
    const invoice = await createDraft.execute("job-1");
    expect(invoice.commissionRateBps).toBe(1000);
  });

  // PAID lifecycle.
  it("marks an ISSUED invoice PAID via MarkInvoicePaidUseCase.executeForJob", async () => {
    await authorizeProfessional();
    const draft = await createDraft.execute("job-1");
    await submitForAcceptance.execute(draft.id);
    await acceptInvoice.execute(draft.id, "professional-user-1");
    await issueInvoice.execute(draft.id);
    await markPaid.executeForJob("job-1");
    const final = await invoices.findByJobId("job-1");
    expect(final?.status).toBe("PAID");
  });

  it("is a no-op when marking an already-PAID invoice paid again", async () => {
    await authorizeProfessional();
    const draft = await createDraft.execute("job-1");
    await submitForAcceptance.execute(draft.id);
    await acceptInvoice.execute(draft.id, "professional-user-1");
    await issueInvoice.execute(draft.id);
    await markPaid.executeForJob("job-1");
    await expect(markPaid.executeForJob("job-1")).resolves.toBeUndefined();
  });

  it("does nothing (never throws) when marking paid for a job with no invoice at all", async () => {
    await expect(markPaid.executeForJob("job-without-invoice")).resolves.toBeUndefined();
  });

  // 22. Payout cannot bypass required invoice state.
  describe("CheckInvoiceRequiredForPayoutUseCase", () => {
    it("is eligible when the invoice is ISSUED", async () => {
      await authorizeProfessional();
      const draft = await createDraft.execute("job-1");
      await submitForAcceptance.execute(draft.id);
      await acceptInvoice.execute(draft.id, "professional-user-1");
      await issueInvoice.execute(draft.id);
      const result = await checkInvoiceForPayout.execute("job-1");
      expect(result.eligible).toBe(true);
    });

    it("blocks payout while the invoice is only ACCEPTED (not yet ISSUED)", async () => {
      await authorizeProfessional();
      const draft = await createDraft.execute("job-1");
      await submitForAcceptance.execute(draft.id);
      await acceptInvoice.execute(draft.id, "professional-user-1");
      const result = await checkInvoiceForPayout.execute("job-1");
      expect(result.eligible).toBe(false);
    });

    it("blocks payout while the invoice is still DRAFT", async () => {
      await authorizeProfessional();
      await createDraft.execute("job-1");
      const result = await checkInvoiceForPayout.execute("job-1");
      expect(result.eligible).toBe(false);
    });

    it("does not block payout for a job with no invoice at all, by default", async () => {
      const result = await checkInvoiceForPayout.execute("job-without-invoice");
      expect(result.eligible).toBe(true);
    });

    it("blocks payout for a job with no invoice at all when requireInvoiceForPayout is true", async () => {
      const result = await checkInvoiceForPayout.execute("job-without-invoice", true);
      expect(result.eligible).toBe(false);
    });
  });

  describe("CreateCreditNoteUseCase", () => {
    async function issueInvoiceForCreditNoteTests() {
      await authorizeProfessional();
      const draft = await createDraft.execute("job-1");
      await submitForAcceptance.execute(draft.id);
      await acceptInvoice.execute(draft.id, "professional-user-1");
      return issueInvoice.execute(draft.id);
    }

    // 14. Credit note correctly references the original invoice.
    it("creates a credit note referencing the original invoice", async () => {
      const invoice = await issueInvoiceForCreditNoteTests();
      const creditNote = await createCreditNote.execute({
        originalInvoiceId: invoice.id,
        reason: "Pricing correction",
        idempotencyKey: "cn-key-1",
        requestedByProfessionalProfileId: "professional-1",
      });
      expect(creditNote.originalInvoiceId).toBe(invoice.id);
      expect(creditNote.status).toBe("ISSUED");
      expect(creditNote.creditNoteNumber).toMatch(/^CN-\d{4}-\d{6}$/);
    });

    // 15. Credit note cannot exceed the allowed remaining amount.
    it("rejects a credit note amount exceeding the invoice total", async () => {
      const invoice = await issueInvoiceForCreditNoteTests();
      await expect(
        createCreditNote.execute({
          originalInvoiceId: invoice.id,
          requestedAmount: invoice.totalAmount + 1,
          reason: "Too much",
          idempotencyKey: "cn-key-2",
          requestedByProfessionalProfileId: "professional-1",
        }),
      ).rejects.toBeInstanceOf(CreditNoteExceedsRemainingAmountError);
    });

    // 16. Duplicate credit-note creation is idempotent.
    it("returns the same credit note for a retried request with the same idempotency key", async () => {
      const invoice = await issueInvoiceForCreditNoteTests();
      const first = await createCreditNote.execute({
        originalInvoiceId: invoice.id,
        reason: "Pricing correction",
        idempotencyKey: "cn-key-3",
        requestedByProfessionalProfileId: "professional-1",
      });
      const second = await createCreditNote.execute({
        originalInvoiceId: invoice.id,
        reason: "Pricing correction",
        idempotencyKey: "cn-key-3",
        requestedByProfessionalProfileId: "professional-1",
      });
      expect(second.id).toBe(first.id);
    });

    // 17. Original invoice unchanged after credit note creation.
    it("never modifies the original issued invoice when a credit note is created", async () => {
      const invoice = await issueInvoiceForCreditNoteTests();
      await createCreditNote.execute({
        originalInvoiceId: invoice.id,
        reason: "Pricing correction",
        idempotencyKey: "cn-key-4",
        requestedByProfessionalProfileId: "professional-1",
      });
      const reloaded = await invoices.findById(invoice.id);
      expect(reloaded?.status).toBe("ISSUED");
      expect(reloaded?.totalAmount).toBe(invoice.totalAmount);
      expect(reloaded?.invoiceNumber).toBe(invoice.invoiceNumber);
    });

    it("rejects a credit note for a nonexistent invoice", async () => {
      await expect(
        createCreditNote.execute({ originalInvoiceId: "does-not-exist", reason: "x", idempotencyKey: "cn-key-5" }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("rejects a credit note requested by a different professional than the invoice's owner", async () => {
      const invoice = await issueInvoiceForCreditNoteTests();
      await expect(
        createCreditNote.execute({
          originalInvoiceId: invoice.id,
          reason: "Not mine",
          idempotencyKey: "cn-key-6",
          requestedByProfessionalProfileId: "some-other-professional",
        }),
      ).rejects.toBeInstanceOf(UnauthorizedError);
    });

    it("supports a full credit note followed by a zero remaining balance", async () => {
      const invoice = await issueInvoiceForCreditNoteTests();
      await createCreditNote.execute({
        originalInvoiceId: invoice.id,
        reason: "Full reversal",
        idempotencyKey: "cn-key-7",
        requestedByProfessionalProfileId: "professional-1",
      });
      await expect(
        createCreditNote.execute({
          originalInvoiceId: invoice.id,
          requestedAmount: 0.01,
          reason: "Should not fit",
          idempotencyKey: "cn-key-8",
          requestedByProfessionalProfileId: "professional-1",
        }),
      ).rejects.toBeInstanceOf(CreditNoteExceedsRemainingAmountError);
    });
  });

  // 23. Important invoice transitions generate the expected domain events.
  it("publishes the expected domain events across the full lifecycle", async () => {
    await authorizeProfessional();
    const draft = await createDraft.execute("job-1");
    await submitForAcceptance.execute(draft.id);
    await acceptInvoice.execute(draft.id, "professional-user-1");
    await issueInvoice.execute(draft.id);
    await markPaid.executeForJob("job-1");

    const names = eventBus.published.map((e) => e.eventName);
    expect(names).toContain("invoicing.self-billing-authorization-granted");
    expect(names).toContain("invoicing.invoice-created");
    expect(names).toContain("invoicing.invoice-submitted-for-acceptance");
    expect(names).toContain("invoicing.invoice-accepted");
    expect(names).toContain("invoicing.invoice-issued");
    expect(names).toContain("invoicing.invoice-paid");
  });

  it("supports a company-owned job identically to a solo professional job", async () => {
    jobs.seed(makeJob({ professionalProfileId: null, companyProfileId: "company-1" }));
    await grantAuthorization.execute({
      companyProfileId: "company-1",
      agreementVersion: "self-billing-agreement-es-v1",
      acceptedByUserId: "company-owner-user-1",
    });
    const draft = await createDraft.execute("job-1");
    expect(draft.companyProfileId).toBe("company-1");
    expect(draft.recipientLegalName).toBe("Reformas Madrid SL");
  });
});
