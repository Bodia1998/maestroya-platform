import { describe, expect, it } from "vitest";

import { CalculateJobCommissionBreakdownUseCase } from "@/application/use-cases/financial/calculate-job-commission-breakdown.use-case";
import { CreateFinancialAdjustmentUseCase } from "@/application/use-cases/financial/create-financial-adjustment.use-case";
import { GetCustomerFinancialSummaryUseCase } from "@/application/use-cases/financial/get-customer-financial-summary.use-case";
import { GetProfessionalEarningsUseCase } from "@/application/use-cases/financial/get-professional-earnings.use-case";
import { RecordCommissionForPaymentUseCase } from "@/application/use-cases/financial/record-commission-for-payment.use-case";
import { NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import type { ServiceRequestRecord } from "@/domain/repositories/service-request-repository";
import {
  FakeCustomerProfileRepository,
  FakeJobRepository,
  FakeQuoteAcceptanceRepository,
  FakeQuoteRepository,
  FakeServiceRequestRepository,
  createAppointmentStore,
  createJobStore,
} from "../booking/fakes";
import { FakeProfessionalRepository } from "../quotes/fakes";
import {
  FakeCommissionRateRepository,
  FakeCommissionRepository,
  FakeFinancialAdjustmentRepository,
  FakeFinancialLedgerRepository,
  FakePaymentRepository,
} from "./fakes";

/**
 * Integration tests for Module 22 — Commission & Financial. Real use cases
 * + domain services, fake repositories swapped in for storage — same
 * pattern as tests/integration/job/job-flows.test.ts (which this file
 * reuses the booking/job fakes from, to build a real accepted-Quote ->
 * Job the financial use cases operate on top of).
 */

let counter = 0;

function makeRepos() {
  const customerProfiles = new FakeCustomerProfileRepository();
  const professionals = new FakeProfessionalRepository();
  const serviceRequests = new FakeServiceRequestRepository();
  const quotes = new FakeQuoteRepository();
  const appointmentStore = createAppointmentStore();
  const jobStore = createJobStore();
  const quoteAcceptance = new FakeQuoteAcceptanceRepository(quotes, serviceRequests, appointmentStore, jobStore);
  const jobs = new FakeJobRepository(jobStore, appointmentStore);
  const rates = new FakeCommissionRateRepository();
  const commissions = new FakeCommissionRepository();
  const ledger = new FakeFinancialLedgerRepository();
  const payments = new FakePaymentRepository();
  const adjustments = new FakeFinancialAdjustmentRepository();

  const breakdowns = new CalculateJobCommissionBreakdownUseCase(jobs, quotes, rates);

  return {
    customerProfiles,
    professionals,
    serviceRequests,
    quotes,
    quoteAcceptance,
    jobs,
    rates,
    commissions,
    ledger,
    payments,
    adjustments,
    breakdowns,
    recordCommission: new RecordCommissionForPaymentUseCase(payments, commissions, ledger, breakdowns),
    getProfessionalEarnings: new GetProfessionalEarningsUseCase(professionals, commissions, payments, breakdowns),
    getCustomerSummary: new GetCustomerFinancialSummaryUseCase(customerProfiles, jobs, payments, breakdowns),
    createAdjustment: new CreateFinancialAdjustmentUseCase(jobs, adjustments, ledger),
  };
}

type Repos = ReturnType<typeof makeRepos>;

async function seedRequest(repos: Repos, customerUserId: string): Promise<ServiceRequestRecord> {
  const customer = await repos.customerProfiles.findOrCreateByUserId(customerUserId);
  counter += 1;
  const now = new Date();
  return repos.serviceRequests.seed({
    id: `request-${counter}`,
    customerId: customer.id,
    categoryId: "cat-plumbing",
    categoryName: "Plumbing",
    title: "Fix leaking kitchen tap",
    description: "Dripping for a week.",
    status: "PUBLISHED",
    urgency: "MEDIUM",
    budgetMin: null,
    budgetMax: null,
    location: {
      line1: "Calle Mayor 1",
      line2: null,
      city: "Oliva",
      province: "Valencia",
      postalCode: "46780",
      country: "ES",
      latitude: null,
      longitude: null,
    },
    photos: [],
    createdAt: now,
    updatedAt: now,
  });
}

/** Labor = 1000, Materials = 500 — the module spec's own worked example. */
async function seedJobWithQuote(
  repos: Repos,
  customerUserId: string,
  professionalUserId: string,
  items: { description: string; quantity: number; unitPrice: number; category: "LABOR" | "MATERIALS" }[] = [
    { description: "Labor", quantity: 1, unitPrice: 1000, category: "LABOR" },
    { description: "Materials", quantity: 1, unitPrice: 500, category: "MATERIALS" },
  ],
) {
  const professional = await repos.professionals.create(professionalUserId, {});
  const request = await seedRequest(repos, customerUserId);
  const totalAmount = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const quote = await repos.quotes.create({
    serviceRequestId: request.id,
    professionalProfileId: professional.id,
    submittedByUserId: professionalUserId,
    totalAmount,
    currency: "EUR",
    validUntil: null,
    notes: null,
    items,
  });
  const result = await repos.quoteAcceptance.acceptQuote({ quoteId: quote.id, serviceRequestId: request.id });
  return { request, professional, job: result.job, quote };
}

function seedCapturedPayment(repos: Repos, jobId: string, payerId: string, amount: number) {
  counter += 1;
  return repos.payments.seed({
    id: `payment-${counter}`,
    serviceRequestId: "service-request-irrelevant",
    quoteId: "quote-irrelevant",
    jobId,
    payerId,
    amount,
    currency: "EUR",
    status: "CAPTURED",
    capturedAt: new Date(),
  });
}

const CUSTOMER = "user-customer-1";
const PROFESSIONAL = "user-professional-1";
const OTHER_CUSTOMER = "user-customer-2";
const ADMIN = "user-admin-1";

describe("Module 22 — Commission & Financial", () => {
  it("calculates the commission breakdown from a Job's accepted Quote — labor only, per the module's worked example", async () => {
    const repos = makeRepos();
    const { job } = await seedJobWithQuote(repos, CUSTOMER, PROFESSIONAL);

    const breakdown = await repos.breakdowns.execute(job.id);

    expect(breakdown.laborSubtotal).toBe(1000);
    expect(breakdown.materialsSubtotal).toBe(500);
    expect(breakdown.commissionBase).toBe(1000);
    expect(breakdown.customerPlatformFee).toBe(75);
    expect(breakdown.professionalCommission).toBe(75);
  });

  it("records a commission only once a Payment is CAPTURED, never on quote acceptance alone", async () => {
    const repos = makeRepos();
    const { job } = await seedJobWithQuote(repos, CUSTOMER, PROFESSIONAL);
    const payment = seedCapturedPayment(repos, job.id, CUSTOMER, 1575);
    repos.payments.payments.set(payment.id, { ...payment, status: "PENDING" });

    await expect(repos.recordCommission.execute(payment.id)).rejects.toThrow(ValidationError);
  });

  it("records the commission and full ledger trail once captured", async () => {
    const repos = makeRepos();
    const { job } = await seedJobWithQuote(repos, CUSTOMER, PROFESSIONAL);
    const payment = seedCapturedPayment(repos, job.id, CUSTOMER, 1575);

    const commission = await repos.recordCommission.execute(payment.id);

    expect(commission.amount).toBe(75);
    expect(commission.rateBps).toBe(750);

    const entries = await repos.ledger.listForPayment(payment.id);
    const types = entries.map((e) => e.type).sort();
    expect(types).toEqual(
      ["COMMISSION", "CUSTOMER_PLATFORM_FEE", "LABOR_CHARGE", "MATERIALS_CHARGE", "PLATFORM_REVENUE", "PROFESSIONAL_NET_EARNING"].sort(),
    );
    const platformRevenue = entries.find((e) => e.type === "PLATFORM_REVENUE");
    expect(platformRevenue?.amount).toBe(150);
  });

  it("is idempotent — recording a commission twice for the same payment never double-charges", async () => {
    const repos = makeRepos();
    const { job } = await seedJobWithQuote(repos, CUSTOMER, PROFESSIONAL);
    const payment = seedCapturedPayment(repos, job.id, CUSTOMER, 1575);

    const first = await repos.recordCommission.execute(payment.id);
    const second = await repos.recordCommission.execute(payment.id);

    expect(second.id).toBe(first.id);
    expect(repos.commissions.commissions.size).toBe(1);
    expect(repos.ledger.entries.filter((e) => e.paymentId === payment.id)).toHaveLength(6);
  });

  it("lets a professional see only their own earnings", async () => {
    const repos = makeRepos();
    const { job } = await seedJobWithQuote(repos, CUSTOMER, PROFESSIONAL);
    const payment = seedCapturedPayment(repos, job.id, CUSTOMER, 1575);
    await repos.recordCommission.execute(payment.id);

    const earnings = await repos.getProfessionalEarnings.execute(PROFESSIONAL);
    expect(earnings).toHaveLength(1);
    expect(earnings[0]!.professionalCommission).toBe(75);
    expect(earnings[0]!.professionalTotalNetEarnings).toBe(1425);

    // Never leaks another professional's earnings: a second, genuine
    // professional profile with no commissions of their own sees an empty
    // list, never PROFESSIONAL's €75 entry above. (A userId with no
    // professional profile at all is a separate case — see
    // GetProfessionalEarningsUseCase's own "you must have a professional
    // profile" guard — covered by its own test below, not this one.)
    await repos.professionals.create("user-professional-other", {});
    const otherProfessionalEarnings = await repos.getProfessionalEarnings.execute("user-professional-other");
    expect(otherProfessionalEarnings).toHaveLength(0);
  });

  it("requires a professional profile to view earnings — no profile at all is rejected, not silently empty", async () => {
    const repos = makeRepos();
    await expect(repos.getProfessionalEarnings.execute("user-with-no-professional-profile")).rejects.toThrow(
      ValidationError,
    );
  });

  it("never exposes another customer's financial summary — unauthorized access surfaces as NotFoundError", async () => {
    const repos = makeRepos();
    const { job } = await seedJobWithQuote(repos, CUSTOMER, PROFESSIONAL);
    const payment = seedCapturedPayment(repos, job.id, CUSTOMER, 1575);
    await repos.recordCommission.execute(payment.id);

    await expect(repos.getCustomerSummary.execute(OTHER_CUSTOMER, job.id)).rejects.toThrow(NotFoundError);
  });

  it("shows the customer their own platform fee but never the professional's commission or net earnings", async () => {
    const repos = makeRepos();
    const { job } = await seedJobWithQuote(repos, CUSTOMER, PROFESSIONAL);
    const payment = seedCapturedPayment(repos, job.id, CUSTOMER, 1575);
    await repos.recordCommission.execute(payment.id);

    const summary = await repos.getCustomerSummary.execute(CUSTOMER, job.id);
    expect(summary).toHaveLength(1);
    expect(summary[0]!.customerPlatformFee).toBe(75);
    expect(summary[0]!.laborSubtotal).toBe(1000);
    expect(summary[0]!.materialsSubtotal).toBe(500);
    // The DTO type itself has no professionalCommission/platformGrossRevenue
    // field — this assertion documents that even at runtime, nothing extra
    // leaked onto the object.
    expect(Object.keys(summary[0]!)).not.toContain("professionalCommission");
  });

  it("reflects a processed refund in the customer's financial summary", async () => {
    const repos = makeRepos();
    const { job } = await seedJobWithQuote(repos, CUSTOMER, PROFESSIONAL);
    const payment = seedCapturedPayment(repos, job.id, CUSTOMER, 1575);
    await repos.recordCommission.execute(payment.id);
    repos.payments.seedProcessedRefund(payment.id, 200);

    const summary = await repos.getCustomerSummary.execute(CUSTOMER, job.id);
    expect(summary[0]!.refundedAmount).toBe(200);
  });

  it("creates a dispute-driven financial adjustment and applies it to the ledger", async () => {
    const repos = makeRepos();
    const { job } = await seedJobWithQuote(repos, CUSTOMER, PROFESSIONAL);

    const adjustment = await repos.createAdjustment.execute(ADMIN, {
      jobId: job.id,
      disputeId: "dispute-1",
      paymentId: null,
      type: "PARTIAL_REFUND",
      amount: 100,
      reason: "Partial refund per dispute resolution.",
    });

    expect(adjustment.status).toBe("APPLIED");
    expect(adjustment.transactionId).not.toBeNull();

    const ledgerEntry = repos.ledger.entries.find((e) => e.id === adjustment.transactionId);
    expect(ledgerEntry?.type).toBe("DISPUTE_ADJUSTMENT");
    expect(ledgerEntry?.amount).toBe(-100);
  });

  it("is idempotent — requesting the same dispute adjustment twice never double-processes it", async () => {
    const repos = makeRepos();
    const { job } = await seedJobWithQuote(repos, CUSTOMER, PROFESSIONAL);

    const first = await repos.createAdjustment.execute(ADMIN, {
      jobId: job.id,
      disputeId: "dispute-2",
      paymentId: null,
      type: "COMMISSION_REVERSAL",
      amount: 75,
      reason: "Commission reversed — resolved in customer's favor.",
    });
    const second = await repos.createAdjustment.execute(ADMIN, {
      jobId: job.id,
      disputeId: "dispute-2",
      paymentId: null,
      type: "COMMISSION_REVERSAL",
      amount: 75,
      reason: "Commission reversed — resolved in customer's favor.",
    });

    expect(second.id).toBe(first.id);
    expect(repos.adjustments.adjustments.size).toBe(1);
    expect(repos.ledger.entries.filter((e) => e.type === "COMMISSION_REVERSAL")).toHaveLength(1);
  });

  it("rejects a financial adjustment for a nonexistent Job", async () => {
    const repos = makeRepos();
    await expect(
      repos.createAdjustment.execute(ADMIN, {
        jobId: "nonexistent-job",
        disputeId: null,
        paymentId: null,
        type: "FULL_REFUND",
        amount: 50,
        reason: null,
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it("never lets materials contribute to commission, even when they dwarf labor", async () => {
    const repos = makeRepos();
    const { job } = await seedJobWithQuote(repos, CUSTOMER, PROFESSIONAL, [
      { description: "Labor", quantity: 1, unitPrice: 2000, category: "LABOR" },
      { description: "Materials", quantity: 1, unitPrice: 10000, category: "MATERIALS" },
    ]);

    const breakdown = await repos.breakdowns.execute(job.id);
    expect(breakdown.commissionBase).toBe(2000);
    expect(breakdown.customerPlatformFee).toBe(150);
    expect(breakdown.professionalCommission).toBe(150);
  });

  it("respects a configured (non-default) commission rate", async () => {
    const repos = makeRepos();
    repos.rates.rates = { customerPlatformFeeRateBps: 1000, professionalCommissionRateBps: 500 };
    const { job } = await seedJobWithQuote(repos, CUSTOMER, PROFESSIONAL);

    const breakdown = await repos.breakdowns.execute(job.id);
    expect(breakdown.customerPlatformFee).toBe(100);
    expect(breakdown.professionalCommission).toBe(50);
  });

  it("the ledger is append-only — every write produces a new Transaction row, never mutates a prior one", async () => {
    const repos = makeRepos();
    const { job } = await seedJobWithQuote(repos, CUSTOMER, PROFESSIONAL);
    const payment = seedCapturedPayment(repos, job.id, CUSTOMER, 1575);

    await repos.recordCommission.execute(payment.id);
    const snapshotAfterFirst = [...repos.ledger.entries];

    // A second, unrelated ledger write (a dispute adjustment) must not
    // alter any previously-created row.
    await repos.createAdjustment.execute(ADMIN, {
      jobId: job.id,
      disputeId: "dispute-3",
      paymentId: payment.id,
      type: "PLATFORM_FEE_REFUND",
      amount: 10,
      reason: null,
    });

    for (const original of snapshotAfterFirst) {
      const stillThere = repos.ledger.entries.find((e) => e.id === original.id);
      expect(stillThere).toEqual(original);
    }
  });

  it("every ledger entry traces back to the Payment/Job it originated from", async () => {
    const repos = makeRepos();
    const { job } = await seedJobWithQuote(repos, CUSTOMER, PROFESSIONAL);
    const payment = seedCapturedPayment(repos, job.id, CUSTOMER, 1575);
    await repos.recordCommission.execute(payment.id);

    const entries = await repos.ledger.listForPayment(payment.id);
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry.paymentId).toBe(payment.id);
    }
  });
});
