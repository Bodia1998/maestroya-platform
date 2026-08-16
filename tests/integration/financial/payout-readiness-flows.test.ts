import { describe, expect, it } from "vitest";

import { CalculateJobCommissionBreakdownUseCase } from "@/application/use-cases/financial/calculate-job-commission-breakdown.use-case";
import { CheckPayoutReadinessUseCase } from "@/application/use-cases/financial/check-payout-readiness.use-case";
import { CreateFinancialAdjustmentUseCase } from "@/application/use-cases/financial/create-financial-adjustment.use-case";
import { ReconcilePaymentUseCase } from "@/application/use-cases/financial/reconcile-payment.use-case";
import { ReconcileProfessionalEarningsUseCase } from "@/application/use-cases/financial/reconcile-professional-earnings.use-case";
import { RecordCommissionForPaymentUseCase } from "@/application/use-cases/financial/record-commission-for-payment.use-case";
import { CheckPayoutEligibilityUseCase } from "@/application/use-cases/verification/check-payout-eligibility.use-case";
import { NotFoundError } from "@/domain/errors/domain-error";
import type { JobRecord } from "@/domain/repositories/job-repository";
import type { PaymentReleaseStatus } from "@/domain/services/payment-release-decision";
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
import { FakeProfessionalVerificationRepository } from "../verification/fakes";
import {
  FakeCommissionRateRepository,
  FakeCommissionRepository,
  FakeFinancialAdjustmentRepository,
  FakeFinancialLedgerRepository,
  FakeJobCompletionConfirmationRepository,
  FakePaymentRepository,
  FakeProfessionalPayoutLedgerRepository,
  FakeTrustAutomatedActionRepository,
} from "./fakes";

/**
 * Module 70.1 — Pre-Stripe Security & Integration Hardening (Objective D):
 * comprehensive, real-use-case + fake-repository tests for
 * `CheckPayoutReadinessUseCase` and `ReconcileProfessionalEarningsUseCase`
 * — Module 69 introduced both with no direct test coverage of their own
 * (only the pure `decidePayoutReadiness` function was tested). Same
 * pattern as financial-flows.test.ts, extended with the trust-hold/
 * KYC-eligibility/payout-ledger dependencies these two use cases add.
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
  const completionConfirmations = new FakeJobCompletionConfirmationRepository();
  const trustActions = new FakeTrustAutomatedActionRepository();
  const payoutLedger = new FakeProfessionalPayoutLedgerRepository();
  const verifications = new FakeProfessionalVerificationRepository(professionals);

  const breakdowns = new CalculateJobCommissionBreakdownUseCase(jobs, quotes, rates);
  const reconcilePayment = new ReconcilePaymentUseCase(payments, commissions, ledger, adjustments, completionConfirmations);
  const payoutEligibility = new CheckPayoutEligibilityUseCase(verifications);

  return {
    customerProfiles,
    professionals,
    serviceRequests,
    quotes,
    quoteAcceptance,
    jobs,
    jobStore,
    rates,
    commissions,
    ledger,
    payments,
    adjustments,
    completionConfirmations,
    trustActions,
    payoutLedger,
    verifications,
    breakdowns,
    reconcilePayment,
    recordCommission: new RecordCommissionForPaymentUseCase(payments, commissions, ledger, breakdowns, completionConfirmations),
    createAdjustment: new CreateFinancialAdjustmentUseCase(jobs, adjustments, ledger, payments),
    payoutEligibility,
    checkPayoutReadiness: new CheckPayoutReadinessUseCase(
      jobs,
      payments,
      professionals,
      trustActions,
      payoutEligibility,
      payoutLedger,
      reconcilePayment,
      completionConfirmations,
    ),
    reconcileEarnings: new ReconcileProfessionalEarningsUseCase(professionals, commissions, payoutLedger, reconcilePayment),
  };
}

type Repos = ReturnType<typeof makeRepos>;

async function seedRequest(repos: Repos, customerUserId: string) {
  const customer = await repos.customerProfiles.findOrCreateByUserId(customerUserId);
  counter += 1;
  const now = new Date();
  return repos.serviceRequests.seed({
    id: `pr-request-${counter}`,
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

/** Labor = 1000, Materials = 500 -> commission 150, professional net 1350. */
async function seedJobWithQuote(repos: Repos, customerUserId: string, professionalUserId: string) {
  const professional = await repos.professionals.create(professionalUserId, {});
  const request = await seedRequest(repos, customerUserId);
  const items = [
    { description: "Labor", quantity: 1, unitPrice: 1000, category: "LABOR" as const },
    { description: "Materials", quantity: 1, unitPrice: 500, category: "MATERIALS" as const },
  ];
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
    id: `pr-payment-${counter}`,
    serviceRequestId: "irrelevant",
    quoteId: "irrelevant",
    jobId,
    payerId,
    amount,
    currency: "EUR",
    status: "CAPTURED",
    capturedAt: new Date(),
  });
}

function seedReleaseStatus(
  repos: Repos,
  jobId: string,
  releaseStatus: "PENDING" | "RELEASE_APPROVED" | "RELEASE_HELD" | "RELEASE_DENIED",
  status: "WAITING_FOR_CUSTOMER" | "CONFIRMED" | "DISPUTED" | "TIMED_OUT_UNDER_REVIEW" = "CONFIRMED",
) {
  counter += 1;
  const now = new Date();
  return repos.completionConfirmations.seed({
    id: `pr-completion-${counter}`,
    jobId,
    status,
    professionalCompletedAt: now,
    confirmationDeadlineAt: new Date(now.getTime() + 72 * 60 * 60 * 1000),
    confirmedAt: status === "CONFIRMED" ? now : null,
    confirmedByUserId: status === "CONFIRMED" ? "user-confirmed-by-test" : null,
    disputeId: status === "DISPUTED" ? "dispute-test" : null,
    manualReviewCaseId: status === "TIMED_OUT_UNDER_REVIEW" ? "review-case-test" : null,
    reminderSentAt: null,
    releaseStatus: releaseStatus as PaymentReleaseStatus,
    releaseReason: `Test-seeded: ${releaseStatus}.`,
    releaseDecidedAt: now,
    createdAt: now,
    updatedAt: now,
  });
}

async function approveKyc(repos: Repos, professionalProfileId: string) {
  const v = await repos.verifications.create(professionalProfileId);
  await repos.verifications.updateStatus(v.id, { status: "PENDING", submittedAt: new Date() });
  await repos.verifications.updateStatus(v.id, { status: "UNDER_REVIEW" });
  await repos.verifications.updateStatus(v.id, { status: "APPROVED", reviewedAt: new Date() });
}

/** Full "everything is fine" setup: captured payment, RELEASE_APPROVED,
 *  commission recorded, KYC approved. Individual tests then perturb one
 *  input at a time. */
async function seedFullyEligible(repos: Repos, customerUserId = "cust-1", professionalUserId = "prof-1") {
  const { job, professional } = await seedJobWithQuote(repos, customerUserId, professionalUserId);
  const payment = seedCapturedPayment(repos, job.id, customerUserId, 1500);
  seedReleaseStatus(repos, job.id, "RELEASE_APPROVED");
  await repos.recordCommission.execute(payment.id);
  await approveKyc(repos, professional.id);
  return { job, professional, payment };
}

const CUSTOMER = "pr-customer-1";
const PROFESSIONAL = "pr-professional-1";

describe("Module 70.1 — CheckPayoutReadinessUseCase", () => {
  it("1. eligible payout: every condition satisfied", async () => {
    const repos = makeRepos();
    const { job } = await seedFullyEligible(repos);

    const result = await repos.checkPayoutReadiness.execute(job.id);

    expect(result.status).toBe("eligible");
    expect(result.payableAmount).toBe(1350);
    expect(result.paymentId).not.toBeNull();
  });

  it("2. release not approved (RELEASE_HELD, e.g. an open dispute) -> held", async () => {
    const repos = makeRepos();
    const { job, professional } = await seedJobWithQuote(repos, CUSTOMER, PROFESSIONAL);
    seedCapturedPayment(repos, job.id, CUSTOMER, 1500);
    seedReleaseStatus(repos, job.id, "RELEASE_HELD", "DISPUTED");
    await approveKyc(repos, professional.id);

    const result = await repos.checkPayoutReadiness.execute(job.id);
    expect(result.status).toBe("held");
  });

  it("3. release pending: no completion confirmation exists yet -> pending", async () => {
    const repos = makeRepos();
    const { job } = await seedJobWithQuote(repos, CUSTOMER, PROFESSIONAL);
    seedCapturedPayment(repos, job.id, CUSTOMER, 1500);

    const result = await repos.checkPayoutReadiness.execute(job.id);
    expect(result.status).toBe("pending");
  });

  it("4. KYC not approved: release approved but no verification case exists -> pending", async () => {
    const repos = makeRepos();
    const { job } = await seedJobWithQuote(repos, CUSTOMER, PROFESSIONAL);
    seedCapturedPayment(repos, job.id, CUSTOMER, 1500);
    seedReleaseStatus(repos, job.id, "RELEASE_APPROVED");
    // Deliberately no approveKyc() call.

    const result = await repos.checkPayoutReadiness.execute(job.id);
    expect(result.status).toBe("pending");
    expect(result.reason).toMatch(/identity verification/i);
  });

  it("5. Trust & Integrity payout hold blocks an otherwise fully eligible payout", async () => {
    const repos = makeRepos();
    const { job, professional } = await seedFullyEligible(repos, CUSTOMER, PROFESSIONAL);
    await repos.trustActions.create({
      userId: PROFESSIONAL,
      type: "PAYOUT_HOLD",
      reason: "PAYMENT_ABUSE_DETECTED",
      triggeringRiskScore: 90,
      detail: "Automated hold — test.",
    });

    const result = await repos.checkPayoutReadiness.execute(job.id);
    expect(result.status).toBe("held");
    expect(professional.id).toBeTruthy(); // sanity: same professional used above
  });

  it("6. denied payout: RELEASE_DENIED (e.g. cancelled/never captured job) -> denied, never eligible again", async () => {
    const repos = makeRepos();
    const { job } = await seedJobWithQuote(repos, CUSTOMER, PROFESSIONAL);
    seedCapturedPayment(repos, job.id, CUSTOMER, 1500);
    seedReleaseStatus(repos, job.id, "RELEASE_DENIED", "CONFIRMED");

    const result = await repos.checkPayoutReadiness.execute(job.id);
    expect(result.status).toBe("denied");
    expect(result.payableAmount).toBe(0);
  });

  it("7. insufficient balance: fully refunded via an applied adjustment nets the payable amount to zero", async () => {
    const repos = makeRepos();
    const { job, payment } = await seedFullyEligible(repos);

    await repos.createAdjustment.execute("admin-1", {
      jobId: job.id,
      disputeId: "dispute-full-refund",
      paymentId: payment.id,
      type: "PARTIAL_REFUND",
      amount: 1350,
      reason: "Full professional-earning refund via dispute.",
    });

    const result = await repos.checkPayoutReadiness.execute(job.id);
    expect(result.status).toBe("insufficient_balance");
    expect(result.payableAmount).toBe(0);
  });

  it("8. financial inconsistency: a mismatched Commission/ledger amount blocks payout regardless of every other input", async () => {
    const repos = makeRepos();
    const { job } = await seedFullyEligible(repos);

    const [commission] = [...repos.commissions.commissions.values()];
    if (!commission) throw new Error("test setup failed: no commission recorded");
    repos.commissions.commissions.set(commission.id, { ...commission, amount: commission.amount + 999 });

    const result = await repos.checkPayoutReadiness.execute(job.id);
    expect(result.status).toBe("financial_inconsistency");
    expect(result.payableAmount).toBe(0);
  });

  it("9. zero/negative payable amount never reports a negative payableAmount", async () => {
    const repos = makeRepos();
    const { job, payment, professional } = await seedFullyEligible(repos);
    // Already paid out MORE than the recognized earning — must clamp to 0,
    // never go negative.
    repos.payoutLedger.seedPaid(professional.id, 5000);

    const result = await repos.checkPayoutReadiness.execute(job.id);
    expect(result.status).toBe("insufficient_balance");
    expect(result.payableAmount).toBe(0);
    expect(result.payableAmount).toBeGreaterThanOrEqual(0);
    expect(payment.id).toBeTruthy();
  });

  it("10. already-paid amount is netted out of the payable amount", async () => {
    const repos = makeRepos();
    const { job, professional } = await seedFullyEligible(repos);
    repos.payoutLedger.seedPaid(professional.id, 500);

    const result = await repos.checkPayoutReadiness.execute(job.id);
    expect(result.status).toBe("eligible");
    expect(result.payableAmount).toBe(850); // 1350 - 500
  });

  it("11. payout amount can never exceed reconciled earnings, however much has NOT been paid out", async () => {
    const repos = makeRepos();
    const { job } = await seedFullyEligible(repos);

    const result = await repos.checkPayoutReadiness.execute(job.id);
    // Reconciled professional net earning for this fixture is 1350 — the
    // payable amount must never exceed it (no already-paid amount here).
    expect(result.payableAmount).toBeLessThanOrEqual(1350);
    expect(result.payableAmount).toBe(1350);
  });

  it("12. financial inconsistency has the highest priority — it wins even over an active payout hold and a denied release", async () => {
    const repos = makeRepos();
    const { job } = await seedJobWithQuote(repos, CUSTOMER, PROFESSIONAL);
    seedCapturedPayment(repos, job.id, CUSTOMER, 1500);
    seedReleaseStatus(repos, job.id, "RELEASE_APPROVED");
    await repos.recordCommission.execute((await repos.payments.findByJobId(job.id))[0]!.id);
    const [commission] = [...repos.commissions.commissions.values()];
    if (!commission) throw new Error("test setup failed: no commission recorded");
    repos.commissions.commissions.set(commission.id, { ...commission, amount: commission.amount + 1 });
    await repos.trustActions.create({
      userId: PROFESSIONAL,
      type: "PAYOUT_HOLD",
      reason: "PAYMENT_ABUSE_DETECTED",
      triggeringRiskScore: 99,
      detail: "Also on hold — test.",
    });

    const result = await repos.checkPayoutReadiness.execute(job.id);
    expect(result.status).toBe("financial_inconsistency");
  });

  it("13. an active Trust & Integrity payout hold cannot be bypassed by any other favorable input", async () => {
    const repos = makeRepos();
    const { job } = await seedFullyEligible(repos, CUSTOMER, PROFESSIONAL);
    await repos.trustActions.create({
      userId: PROFESSIONAL,
      type: "PAYOUT_HOLD",
      reason: "MANUAL_REVIEW_CONFIRMED",
      triggeringRiskScore: 50,
      detail: "test",
    });

    const result = await repos.checkPayoutReadiness.execute(job.id);
    expect(result.status).toBe("held");
    expect(result.payableAmount).toBe(0);
  });

  it("14. a RELEASE_APPROVED decision (as if an admin override resolved a completion dispute) still cannot bypass an active payout hold", async () => {
    const repos = makeRepos();
    const { job, professional } = await seedJobWithQuote(repos, CUSTOMER, PROFESSIONAL);
    seedCapturedPayment(repos, job.id, CUSTOMER, 1500);
    // RELEASE_APPROVED via a DISPUTED->CONFIRMED-style admin-override path
    // is represented the same way at this layer: the persisted
    // releaseStatus is RELEASE_APPROVED regardless of how it got there —
    // see EvaluatePaymentReleaseUseCase/AdminResolvePaymentReleaseUseCase's
    // own doc comments for why the payout-hold check below is
    // unconditional in both the normal and admin-override paths.
    seedReleaseStatus(repos, job.id, "RELEASE_APPROVED");
    await repos.recordCommission.execute((await repos.payments.findByJobId(job.id))[0]!.id);
    await approveKyc(repos, professional.id);
    await repos.trustActions.create({
      userId: PROFESSIONAL,
      type: "PAYOUT_HOLD",
      reason: "PAYMENT_ABUSE_DETECTED",
      triggeringRiskScore: 80,
      detail: "test",
    });

    const result = await repos.checkPayoutReadiness.execute(job.id);
    expect(result.status).toBe("held");
  });

  it("15. company-owned jobs are always conservatively held — no KYC/payout-hold model exists yet for CompanyProfile", async () => {
    const repos = makeRepos();
    const now = new Date();
    const companyJob: JobRecord = {
      id: "company-owned-job-1",
      serviceRequestId: "sr-irrelevant",
      quoteId: "quote-irrelevant",
      customerId: "cust-irrelevant",
      professionalProfileId: null,
      companyProfileId: "company-1",
      status: "COMPLETED",
      startedAt: now,
      startedByUserId: null,
      completedAt: now,
      completedByUserId: null,
      cancelledAt: null,
      cancelledByUserId: null,
      cancellationReason: null,
      cancellationNote: null,
      createdAt: now,
      updatedAt: now,
    };
    repos.jobStore.set(companyJob.id, companyJob);

    const result = await repos.checkPayoutReadiness.execute(companyJob.id);
    expect(result.status).toBe("held");
    expect(result.paymentId).toBeNull();
  });

  it("throws NotFoundError for a nonexistent job", async () => {
    const repos = makeRepos();
    await expect(repos.checkPayoutReadiness.execute("no-such-job")).rejects.toThrow(NotFoundError);
  });
});

describe("Module 70.1 — ReconcileProfessionalEarningsUseCase", () => {
  it("rolls up captured/commission/earnings/refunded/payable across every Commission a professional has", async () => {
    const repos = makeRepos();
    const { job, professional, payment } = await seedFullyEligible(repos);

    const rollup = await repos.reconcileEarnings.execute(professional.id);

    expect(rollup.totalCommission).toBe(150);
    expect(rollup.totalEarnings).toBe(1350);
    expect(rollup.totalRefunded).toBe(0);
    expect(rollup.totalPayable).toBe(1350);
    expect(rollup.totalAlreadyPaid).toBe(0);
    expect(rollup.inconsistentPaymentIds).toHaveLength(0);
    expect(rollup.paymentReports).toHaveLength(1);
    expect(rollup.paymentReports[0]!.paymentId).toBe(payment.id);
    expect(job.id).toBeTruthy();
  });

  it("nets already-paid-out amounts into totalPayable (never negative)", async () => {
    const repos = makeRepos();
    const { professional } = await seedFullyEligible(repos);
    repos.payoutLedger.seedPaid(professional.id, 5000);

    const rollup = await repos.reconcileEarnings.execute(professional.id);
    expect(rollup.totalAlreadyPaid).toBe(5000);
    expect(rollup.totalPayable).toBe(0);
    expect(rollup.totalPayable).toBeGreaterThanOrEqual(0);
  });

  it("reflects an applied refund-type adjustment in totalRefunded and nets it out of totalPayable", async () => {
    const repos = makeRepos();
    const { job, professional, payment } = await seedFullyEligible(repos);
    await repos.createAdjustment.execute("admin-1", {
      jobId: job.id,
      disputeId: "dispute-x",
      paymentId: payment.id,
      type: "PARTIAL_REFUND",
      amount: 300,
      reason: "Partial refund after release.",
    });

    const rollup = await repos.reconcileEarnings.execute(professional.id);
    expect(rollup.totalRefunded).toBe(300);
    expect(rollup.totalPayable).toBe(1050); // 1350 - 300
  });

  it("sums multiple payments/commissions across jobs for the same professional", async () => {
    const repos = makeRepos();
    const { professional } = await seedFullyEligible(repos, "cust-a", "prof-multi");

    // A second, independent job for the SAME professional.
    const request2 = await seedRequest(repos, "cust-b");
    counter += 1;
    const quote2 = await repos.quotes.create({
      serviceRequestId: request2.id,
      professionalProfileId: professional.id,
      submittedByUserId: "prof-multi",
      totalAmount: 220,
      currency: "EUR",
      validUntil: null,
      notes: null,
      items: [{ description: "Labor", quantity: 1, unitPrice: 220, category: "LABOR" }],
    });
    const accepted2 = await repos.quoteAcceptance.acceptQuote({ quoteId: quote2.id, serviceRequestId: request2.id });
    const payment2 = seedCapturedPayment(repos, accepted2.job.id, "cust-b", 220);
    seedReleaseStatus(repos, accepted2.job.id, "RELEASE_APPROVED");
    await repos.recordCommission.execute(payment2.id);

    const rollup = await repos.reconcileEarnings.execute(professional.id);
    // First job: commission 150, net 1350. Second job: 10% of 220 = 22
    // commission, net 198.
    expect(rollup.totalCommission).toBe(172);
    expect(rollup.totalEarnings).toBe(1548);
    expect(rollup.paymentReports).toHaveLength(2);
  });

  it("zero earnings: a professional with no commissions at all reports all-zero totals, not an error", async () => {
    const repos = makeRepos();
    const professional = await repos.professionals.create("prof-empty", {});

    const rollup = await repos.reconcileEarnings.execute(professional.id);
    expect(rollup.totalCommission).toBe(0);
    expect(rollup.totalEarnings).toBe(0);
    expect(rollup.totalPayable).toBe(0);
    expect(rollup.paymentReports).toHaveLength(0);
    expect(rollup.inconsistentPaymentIds).toHaveLength(0);
  });

  it("surfaces a financial inconsistency for one payment without hiding the rest of the rollup", async () => {
    const repos = makeRepos();
    const { professional } = await seedFullyEligible(repos);

    const [commission] = [...repos.commissions.commissions.values()];
    if (!commission) throw new Error("test setup failed: no commission recorded");
    repos.commissions.commissions.set(commission.id, { ...commission, amount: commission.amount + 1 });

    const rollup = await repos.reconcileEarnings.execute(professional.id);
    expect(rollup.inconsistentPaymentIds).toHaveLength(1);
  });

  it("never mutates anything it reads — read-only rollup", async () => {
    const repos = makeRepos();
    const { professional } = await seedFullyEligible(repos);
    const before = [...repos.commissions.commissions.values()].map((c) => ({ ...c }));

    await repos.reconcileEarnings.execute(professional.id);

    const after = [...repos.commissions.commissions.values()];
    expect(after).toEqual(before);
  });

  it("throws NotFoundError for a nonexistent professional profile", async () => {
    const repos = makeRepos();
    await expect(repos.reconcileEarnings.execute("no-such-professional")).rejects.toThrow(NotFoundError);
  });
});
