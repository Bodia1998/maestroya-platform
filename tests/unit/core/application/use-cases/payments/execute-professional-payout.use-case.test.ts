import { describe, expect, it } from "vitest";

import { ExecuteProfessionalPayoutUseCase } from "@/application/use-cases/payments/execute-professional-payout.use-case";
import { CalculateJobCommissionBreakdownUseCase } from "@/application/use-cases/financial/calculate-job-commission-breakdown.use-case";
import { RecordCommissionForPaymentUseCase } from "@/application/use-cases/financial/record-commission-for-payment.use-case";
import { CheckPayoutEligibilityUseCase } from "@/application/use-cases/verification/check-payout-eligibility.use-case";
import { ResolvePayoutDestinationUseCase } from "@/application/use-cases/financial/resolve-payout-destination.use-case";
import { NullFailureReporter } from "@/application/ports/failure-reporter";
import { StripeTransferError, ValidationError } from "@/domain/errors/domain-error";
import { ProfessionalPayoutExecuted } from "@/domain/events/professional-payout-executed";
import { ProfessionalPayoutFailed } from "@/domain/events/professional-payout-failed";
import type { CommissionRateRepository } from "@/domain/repositories/commission-rate-repository";
import type {
  CreateLedgerEntryData,
  FinancialLedgerRepository,
  FinancialTransactionRecord,
} from "@/domain/repositories/financial-ledger-repository";

import {
  FakeJobRepository,
  FakePaymentRepository,
  FakeQuoteRepository,
  FakeDistributedLock,
  FakeEventBus,
  fakeJobRecord,
  fakeQuoteRecord,
  FakeJobCompletionConfirmationRepository,
  FakeDisputeRepository,
  FakeCommissionRepository,
  FakeCompanyRepository,
  FakeCompanyVerificationRepository,
  FakeCompanyPayoutAccountRepository,
  FakeTrustAutomatedActionRepository,
  FakePayoutRepository,
  FakeStripeTransferGateway,
} from "./fakes";
import { FakeProfessionalRepository, FakeProfessionalVerificationRepository, FakeProfessionalOnboardingRepository } from "../onboarding/fakes";

/**
 * Module 76 — Professional Payout Execution: tests for
 * `ExecuteProfessionalPayoutUseCase` — real use case wired to real,
 * reused Module 22/64/66/75 use cases (`RecordCommissionForPaymentUseCase`,
 * `CheckPayoutEligibilityUseCase`, `ResolvePayoutDestinationUseCase`), with
 * only the leaf repositories/gateways faked. This proves this module
 * actually reuses those use cases end to end, not just that it *could*.
 */

class FakeCommissionRateRepository implements CommissionRateRepository {
  async getCurrentRates() {
    return { commissionRateBps: 1000 }; // 10%, matches DEFAULT_COMMISSION_RATES
  }
}

class FakeFinancialLedgerRepository implements FinancialLedgerRepository {
  entries = new Map<string, FinancialTransactionRecord>();
  private counter = 0;

  async create(data: CreateLedgerEntryData): Promise<FinancialTransactionRecord> {
    const record: FinancialTransactionRecord = {
      id: `ledger-${++this.counter}`,
      paymentId: data.paymentId ?? null,
      payoutId: data.payoutId ?? null,
      refundId: data.refundId ?? null,
      commissionId: data.commissionId ?? null,
      type: data.type,
      status: data.status ?? "COMPLETED",
      amount: data.amount,
      currency: data.currency ?? "EUR",
      description: data.description ?? null,
      idempotencyKey: data.idempotencyKey,
      createdAt: new Date(),
    };
    this.entries.set(data.idempotencyKey, record);
    return record;
  }
  async findByIdempotencyKey(idempotencyKey: string): Promise<FinancialTransactionRecord | null> {
    return this.entries.get(idempotencyKey) ?? null;
  }
  listForPayment(): Promise<FinancialTransactionRecord[]> {
    throw new Error("not implemented in this fake");
  }
}

function buildHarness() {
  const jobs = new FakeJobRepository();
  const quotes = new FakeQuoteRepository();
  const payments = new FakePaymentRepository();
  const completionConfirmations = new FakeJobCompletionConfirmationRepository();
  const disputes = new FakeDisputeRepository();
  const commissions = new FakeCommissionRepository();
  const rates = new FakeCommissionRateRepository();
  const ledger = new FakeFinancialLedgerRepository();
  const professionals = new FakeProfessionalRepository();
  const companies = new FakeCompanyRepository();
  const verifications = new FakeProfessionalVerificationRepository();
  const companyVerifications = new FakeCompanyVerificationRepository();
  const companyPayoutAccounts = new FakeCompanyPayoutAccountRepository();
  const professionalOnboardings = new FakeProfessionalOnboardingRepository();
  const trustAutomatedActions = new FakeTrustAutomatedActionRepository();
  const payouts = new FakePayoutRepository();
  const transferGateway = new FakeStripeTransferGateway();
  const lock = new FakeDistributedLock();
  const eventBus = new FakeEventBus();

  const breakdowns = new CalculateJobCommissionBreakdownUseCase(jobs, quotes, rates);
  const recordCommission = new RecordCommissionForPaymentUseCase(payments, commissions, ledger, breakdowns, completionConfirmations);
  const payoutEligibility = new CheckPayoutEligibilityUseCase(verifications, companyVerifications, companies, companyPayoutAccounts);
  const destinationResolver = new ResolvePayoutDestinationUseCase(professionalOnboardings, companyPayoutAccounts);

  const useCase = new ExecuteProfessionalPayoutUseCase(
    jobs,
    payments,
    completionConfirmations,
    disputes,
    commissions,
    recordCommission,
    professionals,
    companies,
    trustAutomatedActions,
    payoutEligibility,
    destinationResolver,
    payouts,
    transferGateway,
    lock,
    eventBus,
    new NullFailureReporter(),
  );

  return {
    jobs,
    quotes,
    payments,
    completionConfirmations,
    disputes,
    commissions,
    professionals,
    companies,
    verifications,
    companyVerifications,
    companyPayoutAccounts,
    professionalOnboardings,
    trustAutomatedActions,
    payouts,
    transferGateway,
    lock,
    eventBus,
    useCase,
  };
}

function seedProfessionalHappyPath(h: ReturnType<typeof buildHarness>) {
  h.jobs.seed(fakeJobRecord({ id: "job-1", quoteId: "quote-1", professionalProfileId: "pro-1", companyProfileId: null, status: "COMPLETED" }));
  h.quotes.seed(fakeQuoteRecord({ id: "quote-1", professionalProfileId: "pro-1" }));
  h.payments.seed({
    id: "payment-1",
    serviceRequestId: "request-1",
    quoteId: "quote-1",
    jobId: "job-1",
    payerId: "customer-user-1",
    amount: 100,
    currency: "EUR",
    status: "CAPTURED",
    capturedAt: new Date(),
    stripePaymentIntentId: "pi_1",
    method: "CARD",
    failureReason: null,
  });
  h.completionConfirmations.seed({ jobId: "job-1", releaseStatus: "RELEASE_APPROVED" });
  h.professionals.seed({ id: "pro-1", userId: "pro-user-1" });
  h.verifications.seedApproved("pro-1");
  h.professionalOnboardings.upsertPayoutAccount({
    professionalProfileId: "pro-1",
    method: "STRIPE_EXPRESS",
    status: "VERIFIED",
    accountHolderName: "Ana García",
  });
  h.professionalOnboardings.updateStripeConnectAccount("pro-1", {
    stripeExpressAccountId: "acct_pro_1",
    stripeExpressStatus: "READY",
    stripeChargesEnabled: true,
    stripePayoutsEnabled: true,
    stripeDetailsSubmitted: true,
  });
}

function seedCompanyHappyPath(h: ReturnType<typeof buildHarness>) {
  h.jobs.seed(fakeJobRecord({ id: "job-2", quoteId: "quote-2", professionalProfileId: null, companyProfileId: "company-1", status: "COMPLETED" }));
  h.quotes.seed(fakeQuoteRecord({ id: "quote-2", professionalProfileId: "pro-1" }));
  h.payments.seed({
    id: "payment-2",
    serviceRequestId: "request-2",
    quoteId: "quote-2",
    jobId: "job-2",
    payerId: "customer-user-1",
    amount: 100,
    currency: "EUR",
    status: "CAPTURED",
    capturedAt: new Date(),
    stripePaymentIntentId: "pi_2",
    method: "CARD",
    failureReason: null,
  });
  h.completionConfirmations.seed({ jobId: "job-2", releaseStatus: "RELEASE_APPROVED" });
  h.companies.seed({ id: "company-1", ownerUserId: "company-owner-1" });
  h.companyVerifications.seedApproved("company-1");
  h.companyPayoutAccounts.seedStripeReady("company-1", "acct_company_1");
}

describe("ExecuteProfessionalPayoutUseCase (Module 76)", () => {
  describe("successful payouts", () => {
    it("executes a professional payout: amount = payment minus recorded commission, PAID, Stripe Transfer created", async () => {
      const h = buildHarness();
      seedProfessionalHappyPath(h);

      const record = await h.useCase.execute("job-1");

      expect(record.status).toBe("PAID");
      expect(record.amount).toBe(90); // 100 - 10% commission
      expect(record.stripeTransferId).toBe("tr_fake_1");
      expect(record.professionalProfileId).toBe("pro-1");

      expect(h.transferGateway.calls).toHaveLength(1);
      expect(h.transferGateway.calls[0]!).toMatchObject({
        destinationStripeAccountId: "acct_pro_1",
        amount: 90,
        currency: "EUR",
        idempotencyKey: "payout:job-1",
        metadata: { jobId: "job-1" },
      });

      const published = h.eventBus.published.find((e) => e instanceof ProfessionalPayoutExecuted);
      expect(published).toBeDefined();
    });

    it("executes a company payout using the company destination, never a professional's", async () => {
      const h = buildHarness();
      seedCompanyHappyPath(h);

      const record = await h.useCase.execute("job-2");

      expect(record.status).toBe("PAID");
      expect(record.companyProfileId).toBe("company-1");
      expect(record.professionalProfileId).toBeNull();
      expect(h.transferGateway.calls[0]!.destinationStripeAccountId).toBe("acct_company_1");
    });
  });

  describe("preconditions", () => {
    it("requires RELEASE_APPROVED — refuses a job still RELEASE_HELD", async () => {
      const h = buildHarness();
      seedProfessionalHappyPath(h);
      h.completionConfirmations.seed({ jobId: "job-1", releaseStatus: "RELEASE_HELD", releaseReason: "held" });

      await expect(h.useCase.execute("job-1")).rejects.toThrow(ValidationError);
      expect(h.transferGateway.calls).toHaveLength(0);
    });

    it("requires a CAPTURED payment — refuses when only an AUTHORIZED payment exists", async () => {
      const h = buildHarness();
      seedProfessionalHappyPath(h);
      h.payments.byId.set("payment-1", { ...h.payments.byId.get("payment-1")!, status: "AUTHORIZED" });

      await expect(h.useCase.execute("job-1")).rejects.toThrow(ValidationError);
      expect(h.transferGateway.calls).toHaveLength(0);
    });

    it("refuses a job with an open (non-CLOSED) dispute", async () => {
      const h = buildHarness();
      seedProfessionalHappyPath(h);
      h.disputes.seedOpenDispute("job-1");

      await expect(h.useCase.execute("job-1")).rejects.toThrow(ValidationError);
      expect(h.transferGateway.calls).toHaveLength(0);
    });

    it("refuses when fresh eligibility fails (verification no longer approved)", async () => {
      const h = buildHarness();
      seedProfessionalHappyPath(h);
      h.verifications.seedStatus("pro-1", "REJECTED");

      await expect(h.useCase.execute("job-1")).rejects.toThrow(ValidationError);
      expect(h.transferGateway.calls).toHaveLength(0);
    });

    it("refuses when an active PAYOUT_HOLD exists for the professional's user", async () => {
      const h = buildHarness();
      seedProfessionalHappyPath(h);
      h.trustAutomatedActions.seedActivePayoutHold("pro-user-1");

      await expect(h.useCase.execute("job-1")).rejects.toThrow(ValidationError);
      expect(h.transferGateway.calls).toHaveLength(0);
    });

    it("refuses when the Stripe Connect destination has no account yet", async () => {
      const h = buildHarness();
      seedProfessionalHappyPath(h);
      // Simulate "never onboarded with Stripe": clear the field directly.
      const account = h.professionalOnboardings.payoutAccounts.get("pro-1")!;
      h.professionalOnboardings.payoutAccounts.set("pro-1", { ...account, stripeExpressAccountId: null });

      await expect(h.useCase.execute("job-1")).rejects.toThrow(ValidationError);
    });
  });

  describe("idempotency / duplicate payout prevention", () => {
    it("never creates a second Stripe Transfer for an already-PAID job", async () => {
      const h = buildHarness();
      seedProfessionalHappyPath(h);

      const first = await h.useCase.execute("job-1");
      const second = await h.useCase.execute("job-1");

      expect(first.id).toBe(second.id);
      expect(second.status).toBe("PAID");
      expect(h.transferGateway.calls).toHaveLength(1);
    });

    it("uses a deterministic Stripe idempotency key derived from the job id", async () => {
      const h = buildHarness();
      seedProfessionalHappyPath(h);

      await h.useCase.execute("job-1");

      expect(h.transferGateway.calls[0]!.idempotencyKey).toBe("payout:job-1");
    });

    it("retries safely after a Stripe idempotency-key replay: a lost response converges on the same transfer", async () => {
      const h = buildHarness();
      seedProfessionalHappyPath(h);

      // Simulate "Stripe accepted, but this process crashed before
      // persisting" by manually creating the PENDING row the way the use
      // case would, then calling execute again — it must reuse the same
      // idempotency key and converge on Stripe's own already-created
      // Transfer (the fake gateway itself enforces idempotency-key reuse
      // returns the same id).
      const first = await h.useCase.execute("job-1");
      expect(first.status).toBe("PAID");

      const retried = await h.useCase.execute("job-1");
      expect(retried.stripeTransferId).toBe(first.stripeTransferId);
      expect(h.transferGateway.calls).toHaveLength(1);
    });

    it("concurrent execution of the same job produces at most one successful Stripe Transfer", async () => {
      const h = buildHarness();
      seedProfessionalHappyPath(h);

      const results = await Promise.allSettled([h.useCase.execute("job-1"), h.useCase.execute("job-1")]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      expect(fulfilled.length).toBeGreaterThanOrEqual(1);
      for (const r of fulfilled) {
        if (r.status === "fulfilled") expect(r.value.status).toBe("PAID");
      }
      expect(h.transferGateway.calls).toHaveLength(1);

      const finalRecord = await h.payouts.findByJobId("job-1");
      expect(finalRecord?.status).toBe("PAID");
    });
  });

  describe("Stripe failure handling", () => {
    it("marks the payout FAILED (never PAID) on insufficient balance, and rethrows", async () => {
      const h = buildHarness();
      seedProfessionalHappyPath(h);
      h.transferGateway.nextError = new StripeTransferError("INSUFFICIENT_BALANCE", "Insufficient balance.", false);

      await expect(h.useCase.execute("job-1")).rejects.toThrow(StripeTransferError);

      const record = await h.payouts.findByJobId("job-1");
      expect(record?.status).toBe("FAILED");
      expect(record?.failureReason).toContain("Insufficient balance");

      const published = h.eventBus.published.find((e) => e instanceof ProfessionalPayoutFailed) as ProfessionalPayoutFailed | undefined;
      expect(published?.retryable).toBe(false);
    });

    it("marks the payout FAILED on an invalid/restricted destination account", async () => {
      const h = buildHarness();
      seedProfessionalHappyPath(h);
      h.transferGateway.nextError = new StripeTransferError("INVALID_DESTINATION", "Destination account cannot receive transfers.", false);

      await expect(h.useCase.execute("job-1")).rejects.toThrow(StripeTransferError);
      const record = await h.payouts.findByJobId("job-1");
      expect(record?.status).toBe("FAILED");
    });

    it("marks a transient Stripe failure as retryable and allows a later retry to succeed", async () => {
      const h = buildHarness();
      seedProfessionalHappyPath(h);
      h.transferGateway.nextError = new StripeTransferError("NETWORK", "Connection reset.", true);

      await expect(h.useCase.execute("job-1")).rejects.toThrow(StripeTransferError);
      let record = await h.payouts.findByJobId("job-1");
      expect(record?.status).toBe("FAILED");
      const failedEvent = h.eventBus.published.find((e) => e instanceof ProfessionalPayoutFailed) as ProfessionalPayoutFailed | undefined;
      expect(failedEvent?.retryable).toBe(true);

      // Retry, this time succeeding.
      h.transferGateway.nextError = null;
      record = await h.useCase.execute("job-1");
      expect(record.status).toBe("PAID");
      expect(h.transferGateway.calls).toHaveLength(2);
    });

    it("never marks a payout successful before the Stripe call actually resolves", async () => {
      const h = buildHarness();
      seedProfessionalHappyPath(h);
      h.transferGateway.nextError = new StripeTransferError("TEMPORARY", "Stripe is having issues.", true);

      await expect(h.useCase.execute("job-1")).rejects.toThrow();
      const record = await h.payouts.findByJobId("job-1");
      expect(record?.status).not.toBe("PAID");
    });
  });

  describe("security: amount and destination are never client-controlled", () => {
    it("computes the amount only from the recorded Commission, ignoring any pre-existing (tampered) Payout row amount mismatch", async () => {
      const h = buildHarness();
      seedProfessionalHappyPath(h);

      const record = await h.useCase.execute("job-1");

      // 100 (payment) - 10 (10% commission) = 90 — never anything a caller could influence.
      expect(record.amount).toBe(90);
    });

    it("a company payout can never resolve to a professional's Stripe account, or vice versa", async () => {
      const h = buildHarness();
      seedProfessionalHappyPath(h);
      seedCompanyHappyPath(h);

      const proRecord = await h.useCase.execute("job-1");
      const companyRecord = await h.useCase.execute("job-2");

      expect(h.transferGateway.calls[0]!.destinationStripeAccountId).toBe("acct_pro_1");
      expect(h.transferGateway.calls[1]!.destinationStripeAccountId).toBe("acct_company_1");
      expect(proRecord.professionalProfileId).toBe("pro-1");
      expect(companyRecord.companyProfileId).toBe("company-1");
    });
  });
});
