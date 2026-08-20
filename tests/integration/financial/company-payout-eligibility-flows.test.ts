import { describe, expect, it } from "vitest";

import { CheckPayoutEligibilityUseCase } from "@/application/use-cases/verification/check-payout-eligibility.use-case";
import { EvaluatePaymentReleaseUseCase } from "@/application/use-cases/job/evaluate-payment-release.use-case";
import { ResolvePayoutDestinationUseCase } from "@/application/use-cases/financial/resolve-payout-destination.use-case";
import { NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import type {
  CompanyPayoutAccountRecord,
  CompanyPayoutAccountRepository,
  CreateCompanyPayoutAccountData,
  UpdateCompanyStripeConnectAccountData,
} from "@/domain/repositories/company-payout-account-repository";
import type {
  CancelJobData,
  CompleteJobData,
  JobRecord,
  JobRepository,
  JobSummary,
  ListJobsOptions,
  StartJobData,
} from "@/domain/repositories/job-repository";
import type {
  ConfirmCompletionData,
  DisputeCompletionData,
  JobCompletionConfirmationRecord,
  JobCompletionConfirmationRepository,
  TimeOutCompletionData,
  UpdateReleaseDecisionData,
} from "@/domain/repositories/job-completion-confirmation-repository";
import type {
  CreateDisputeData,
  DisputeRecord,
  DisputeRepository,
  ListAdminDisputesOptions,
  ListDisputesOptions,
} from "@/domain/repositories/dispute-repository";
import type {
  PaymentRecord,
  PaymentRepository,
  UpdatePaymentStatusInput,
  UpdatePaymentStatusResult,
} from "@/domain/repositories/payment-repository";
import type { ProfessionalRecord, ProfessionalRepository, CreateProfessionalData, UpdateProfessionalData } from "@/domain/repositories/professional-repository";
import type {
  CreateTrustAutomatedActionData,
  TrustAutomatedActionRecord,
  TrustAutomatedActionRepository,
  TrustAutomatedActionTypeValue,
} from "@/domain/repositories/trust-automated-action-repository";
import type { DomainEvent, DomainEventClass } from "@/domain/events/domain-event";
import type { EventBus, EventHandler } from "@/application/ports/event-bus";
import type { ProfessionalOnboardingRepository, ProfessionalPayoutAccountRecord, CreatePayoutAccountData, UpdateStripeConnectAccountData, ProfessionalOnboardingRecord } from "@/domain/repositories/professional-onboarding-repository";

import { FakeCompanyRepository } from "../company/fakes";
import { FakeCompanyVerificationRepository } from "../workflow-expiration/fakes";
import { FakeProfessionalVerificationRepository } from "../verification/fakes";
import { FakeProfessionalRepository as VerificationFakeProfessionalRepository } from "../verification/fakes";

/**
 * Module 75 — Company Payout Eligibility: comprehensive integration
 * coverage for the actual scope this module adds — real use cases with
 * in-memory fakes swapped in for storage, same pattern as every other
 * integration test file in this codebase (`tests/integration/financial/
 * payout-readiness-flows.test.ts`, `tests/integration/trust-integrity/
 * job-completion-risk-detection-flows.test.ts`).
 *
 * Covers, per the module's own required test list:
 *   - CompanyPayoutAccount: creation/reconstitution/ownership/duplicate-
 *     prevention/missing-account/cross-company-access (via the in-file
 *     `FakeCompanyPayoutAccountRepository`, which implements the real
 *     `CompanyPayoutAccountRepository` interface).
 *   - Company payout eligibility: unverified, inactive, missing payout
 *     account, valid payout account, fully eligible.
 *   - Payment release: eligible company job reaches RELEASE_APPROVED,
 *     ineligible does not, missing destination blocks eligibility,
 *     existing Module 66 protections (dispute, uncaptured payment,
 *     cancelled job) still enforced for company-owned jobs.
 *   - Payout destination resolution: solo resolves ProfessionalPayoutAccount,
 *     company resolves CompanyPayoutAccount, no cross-owner resolution,
 *     solo behavior unchanged.
 *   - An explicit regression test guarding against company payout support
 *     being silently removed in the future.
 */

let idCounter = 0;
function nextId(prefix: string) {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

// ---------------------------------------------------------------------------
// In-memory CompanyPayoutAccountRepository — the real interface this
// module adds, exercised directly by its own test block below, and reused
// by the eligibility/payment-release/destination-resolution tests further
// down.
// ---------------------------------------------------------------------------
class FakeCompanyPayoutAccountRepository implements CompanyPayoutAccountRepository {
  accounts = new Map<string, CompanyPayoutAccountRecord>(); // keyed by companyProfileId

  async findByCompanyProfileId(companyProfileId: string) {
    return this.accounts.get(companyProfileId) ?? null;
  }

  async findByStripeAccountId(stripeAccountId: string) {
    return [...this.accounts.values()].find((a) => a.stripeExpressAccountId === stripeAccountId) ?? null;
  }

  async upsertPayoutAccount(data: CreateCompanyPayoutAccountData): Promise<CompanyPayoutAccountRecord> {
    const existing = this.accounts.get(data.companyProfileId);
    const now = new Date();
    const clearStripeFields = data.method !== "STRIPE_EXPRESS";
    const record: CompanyPayoutAccountRecord = {
      id: existing?.id ?? nextId("fake-company-payout-account"),
      companyProfileId: data.companyProfileId,
      method: data.method,
      status: data.status,
      accountHolderName: data.accountHolderName,
      ibanLast4: data.ibanLast4 ?? null,
      ibanHash: data.ibanHash ?? null,
      stripeExpressAccountId: clearStripeFields ? null : (existing?.stripeExpressAccountId ?? null),
      stripeExpressStatus: data.stripeExpressStatus ?? "NOT_STARTED",
      stripeChargesEnabled: clearStripeFields ? false : (existing?.stripeChargesEnabled ?? false),
      stripePayoutsEnabled: clearStripeFields ? false : (existing?.stripePayoutsEnabled ?? false),
      stripeDetailsSubmitted: clearStripeFields ? false : (existing?.stripeDetailsSubmitted ?? false),
      stripeRequirementsCurrentlyDue: clearStripeFields ? false : (existing?.stripeRequirementsCurrentlyDue ?? false),
      stripeConnectSyncedAt: clearStripeFields ? null : (existing?.stripeConnectSyncedAt ?? null),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.accounts.set(data.companyProfileId, record);
    return record;
  }

  async updateStripeConnectAccount(
    companyProfileId: string,
    data: UpdateCompanyStripeConnectAccountData,
  ): Promise<CompanyPayoutAccountRecord> {
    const existing = this.accounts.get(companyProfileId);
    if (!existing) throw new NotFoundError("CompanyPayoutAccount", companyProfileId);
    const updated: CompanyPayoutAccountRecord = { ...existing, ...data, updatedAt: new Date() };
    this.accounts.set(companyProfileId, updated);
    return updated;
  }
}

// ---------------------------------------------------------------------------
// In-memory ProfessionalOnboardingRepository — only the payout-account
// slice this module's ResolvePayoutDestinationUseCase actually calls.
// ---------------------------------------------------------------------------
class FakeProfessionalOnboardingRepository implements ProfessionalOnboardingRepository {
  onboardings = new Map<string, ProfessionalOnboardingRecord>();
  payoutAccounts = new Map<string, ProfessionalPayoutAccountRecord>();

  async findByProfessionalProfileId(professionalProfileId: string) {
    return this.onboardings.get(professionalProfileId) ?? null;
  }
  async create(professionalProfileId: string): Promise<ProfessionalOnboardingRecord> {
    const record: ProfessionalOnboardingRecord = {
      id: nextId("fake-onboarding"),
      professionalProfileId,
      status: "IN_PROGRESS",
      activatedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.onboardings.set(professionalProfileId, record);
    return record;
  }
  async activate(id: string, activatedAt: Date) {
    const existing = [...this.onboardings.values()].find((o) => o.id === id);
    if (!existing) throw new NotFoundError("ProfessionalOnboarding", id);
    const updated = { ...existing, status: "ACTIVATED" as const, activatedAt };
    this.onboardings.set(existing.professionalProfileId, updated);
    return updated;
  }
  async findPayoutAccountByProfessionalProfileId(professionalProfileId: string) {
    return this.payoutAccounts.get(professionalProfileId) ?? null;
  }
  async findPayoutAccountByStripeAccountId(stripeAccountId: string) {
    return [...this.payoutAccounts.values()].find((a) => a.stripeExpressAccountId === stripeAccountId) ?? null;
  }
  async upsertPayoutAccount(data: CreatePayoutAccountData): Promise<ProfessionalPayoutAccountRecord> {
    const now = new Date();
    const existing = this.payoutAccounts.get(data.professionalProfileId);
    const record: ProfessionalPayoutAccountRecord = {
      id: existing?.id ?? nextId("fake-professional-payout-account"),
      professionalProfileId: data.professionalProfileId,
      method: data.method,
      status: data.status,
      accountHolderName: data.accountHolderName,
      ibanLast4: data.ibanLast4 ?? null,
      ibanHash: data.ibanHash ?? null,
      stripeExpressAccountId: null,
      stripeExpressStatus: data.stripeExpressStatus ?? "NOT_STARTED",
      stripeChargesEnabled: false,
      stripePayoutsEnabled: false,
      stripeDetailsSubmitted: false,
      stripeRequirementsCurrentlyDue: false,
      stripeConnectSyncedAt: null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.payoutAccounts.set(data.professionalProfileId, record);
    return record;
  }
  async updateStripeConnectAccount(professionalProfileId: string, data: UpdateStripeConnectAccountData) {
    const existing = this.payoutAccounts.get(professionalProfileId);
    if (!existing) throw new NotFoundError("ProfessionalPayoutAccount", professionalProfileId);
    const updated = { ...existing, ...data, updatedAt: new Date() };
    this.payoutAccounts.set(professionalProfileId, updated);
    return updated;
  }
  async updateStripeConnectAccountIfNotStale(professionalProfileId: string, data: UpdateStripeConnectAccountData & { stripeConnectSyncedAt: Date }) {
    await this.updateStripeConnectAccount(professionalProfileId, data);
    return { applied: true };
  }
  async countByStatus() {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Minimal in-memory Job/JobCompletionConfirmation/Dispute/Payment/
// TrustAutomatedAction/EventBus fakes — same "implement the real
// interface, throw for methods this test file never calls" convention as
// tests/integration/trust-integrity/job-completion-risk-detection-flows.test.ts.
// ---------------------------------------------------------------------------
class FakeJobRepository implements JobRepository {
  jobs = new Map<string, JobRecord>();
  async findById(id: string) {
    return this.jobs.get(id) ?? null;
  }
  async listForCustomer(_customerId: string, _options: ListJobsOptions): Promise<JobSummary[]> {
    return [];
  }
  async listForProfessional(_professionalProfileId: string, _options: ListJobsOptions): Promise<JobSummary[]> {
    return [];
  }
  async startWork(_data: StartJobData): Promise<JobRecord> {
    throw new Error("not implemented in fake");
  }
  async complete(_data: CompleteJobData): Promise<JobRecord> {
    throw new Error("not implemented in fake");
  }
  async cancel(_data: CancelJobData): Promise<JobRecord> {
    throw new Error("not implemented in fake");
  }
}

function makeJob(overrides: Partial<JobRecord> & { id: string }): JobRecord {
  const now = new Date();
  return {
    serviceRequestId: "sr-1",
    quoteId: "quote-1",
    customerId: "customer-1",
    professionalProfileId: null,
    companyProfileId: null,
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
    ...overrides,
  };
}

class FakeCompletionConfirmationRepository implements JobCompletionConfirmationRepository {
  rows = new Map<string, JobCompletionConfirmationRecord>(); // keyed by jobId

  seed(overrides: Partial<JobCompletionConfirmationRecord> & { jobId: string }): JobCompletionConfirmationRecord {
    const now = new Date();
    const record: JobCompletionConfirmationRecord = {
      id: nextId("fake-confirmation"),
      status: "CONFIRMED",
      professionalCompletedAt: now,
      confirmationDeadlineAt: now,
      confirmedAt: now,
      confirmedByUserId: "customer-user-1",
      disputeId: null,
      manualReviewCaseId: null,
      reminderSentAt: null,
      releaseStatus: "RELEASE_HELD",
      releaseReason: "Pending evaluation.",
      releaseDecidedAt: null,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
    this.rows.set(record.jobId, record);
    return record;
  }

  async findById(id: string) {
    return [...this.rows.values()].find((r) => r.id === id) ?? null;
  }
  async findByJobId(jobId: string) {
    return this.rows.get(jobId) ?? null;
  }
  async create(): Promise<JobCompletionConfirmationRecord> {
    throw new Error("not implemented in fake");
  }
  async confirm(_data: ConfirmCompletionData): Promise<JobCompletionConfirmationRecord> {
    throw new Error("not implemented in fake");
  }
  async markDisputed(_data: DisputeCompletionData): Promise<JobCompletionConfirmationRecord> {
    throw new Error("not implemented in fake");
  }
  async markTimedOut(_data: TimeOutCompletionData): Promise<JobCompletionConfirmationRecord> {
    throw new Error("not implemented in fake");
  }
  async markReminderSent(): Promise<JobCompletionConfirmationRecord> {
    throw new Error("not implemented in fake");
  }
  async updateReleaseDecision(data: UpdateReleaseDecisionData): Promise<JobCompletionConfirmationRecord> {
    const existing = [...this.rows.values()].find((r) => r.id === data.id);
    if (!existing) throw new NotFoundError("JobCompletionConfirmation", data.id);
    const updated: JobCompletionConfirmationRecord = {
      ...existing,
      releaseStatus: data.releaseStatus,
      releaseReason: data.releaseReason,
      releaseDecidedAt: data.releaseDecidedAt,
      updatedAt: new Date(),
    };
    this.rows.set(existing.jobId, updated);
    return updated;
  }
  async findOverdue(): Promise<JobCompletionConfirmationRecord[]> {
    return [];
  }
  async findDueForReminder(): Promise<JobCompletionConfirmationRecord[]> {
    return [];
  }
}

class FakeDisputeRepository implements DisputeRepository {
  disputes: DisputeRecord[] = [];
  async findById(id: string) {
    return this.disputes.find((d) => d.id === id) ?? null;
  }
  async listByJobId(jobId: string) {
    return this.disputes.filter((d) => d.jobId === jobId);
  }
  async listRaisedByUser(_userId: string, _options: ListDisputesOptions): Promise<DisputeRecord[]> {
    return [];
  }
  async listForAdmin(_options: ListAdminDisputesOptions): Promise<DisputeRecord[]> {
    return [];
  }
  async create(_data: CreateDisputeData): Promise<DisputeRecord> {
    throw new Error("not implemented in fake");
  }
  async updateStatus(): Promise<DisputeRecord> {
    throw new Error("not implemented in fake");
  }
  async assign(): Promise<DisputeRecord> {
    throw new Error("not implemented in fake");
  }
  async setPriority(): Promise<DisputeRecord> {
    throw new Error("not implemented in fake");
  }
}

class FakePaymentRepository implements PaymentRepository {
  payments: PaymentRecord[] = [];
  async findById(id: string) {
    return this.payments.find((p) => p.id === id) ?? null;
  }
  async findByJobId(jobId: string) {
    return this.payments.filter((p) => p.jobId === jobId);
  }
  async listForPayer(): Promise<PaymentRecord[]> {
    return [];
  }
  async sumProcessedRefunds(): Promise<number> {
    return 0;
  }
  async findByStripePaymentIntentId() {
    return null;
  }
  async findActiveByQuoteId() {
    return null;
  }
  async create(): Promise<PaymentRecord> {
    throw new Error("not implemented in fake");
  }
  async updateStatus(_input: UpdatePaymentStatusInput): Promise<UpdatePaymentStatusResult> {
    throw new Error("not implemented in fake");
  }
}

function makePayment(overrides: Partial<PaymentRecord> & { id: string; jobId: string }): PaymentRecord {
  return {
    serviceRequestId: "sr-1",
    quoteId: "quote-1",
    payerId: "customer-1",
    amount: 100,
    currency: "EUR",
    status: "CAPTURED",
    capturedAt: new Date(),
    stripePaymentIntentId: `pi_${overrides.id}`,
    method: "CARD",
    failureReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as PaymentRecord;
}

class FakeProfessionalRepository implements ProfessionalRepository {
  professionals: ProfessionalRecord[] = [];
  async findById(id: string) {
    return this.professionals.find((p) => p.id === id) ?? null;
  }
  async findByUserId(userId: string) {
    return this.professionals.find((p) => p.userId === userId) ?? null;
  }
  async create(_userId: string, _data: CreateProfessionalData): Promise<ProfessionalRecord> {
    throw new Error("not implemented in fake");
  }
  async update(_id: string, _data: UpdateProfessionalData): Promise<ProfessionalRecord> {
    throw new Error("not implemented in fake");
  }
  async updateStatus(): Promise<void> {
    throw new Error("not implemented in fake");
  }
  async updateVerificationStatus(): Promise<void> {
    throw new Error("not implemented in fake");
  }
  async updateCategories(): Promise<ProfessionalRecord> {
    throw new Error("not implemented in fake");
  }
}

class FakeTrustAutomatedActionRepository implements TrustAutomatedActionRepository {
  actions: TrustAutomatedActionRecord[] = [];
  seedHold(userId: string) {
    this.actions.push({
      id: nextId("fake-hold"),
      userId,
      type: "PAYOUT_HOLD",
      status: "ACTIVE",
      reason: "PAYMENT_ABUSE_DETECTED",
      triggeringRiskScore: 80,
      detail: "Test hold",
      createdByUserId: null,
      expiresAt: null,
      reversedAt: null,
      reversedByUserId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }
  async create(_data: CreateTrustAutomatedActionData): Promise<TrustAutomatedActionRecord> {
    throw new Error("not implemented in fake");
  }
  async findById(id: string) {
    return this.actions.find((a) => a.id === id) ?? null;
  }
  async listForUser(userId: string) {
    return this.actions.filter((a) => a.userId === userId);
  }
  async listActiveForUser(userId: string, type?: TrustAutomatedActionTypeValue) {
    return this.actions.filter((a) => a.userId === userId && a.status === "ACTIVE" && (!type || a.type === type));
  }
  async countActiveForUser(userId: string) {
    return this.actions.filter((a) => a.userId === userId && a.status === "ACTIVE").length;
  }
  async reverse(): Promise<TrustAutomatedActionRecord> {
    throw new Error("not implemented in fake");
  }
  async expireDue(): Promise<number> {
    return 0;
  }
  async countAll(): Promise<number> {
    return this.actions.length;
  }
  async countByType(): Promise<number> {
    return 0;
  }
  async countActive(): Promise<number> {
    return this.actions.filter((a) => a.status === "ACTIVE").length;
  }
}

class RecordingEventBus implements EventBus {
  readonly published: DomainEvent[] = [];
  async publish<T extends DomainEvent>(event: T): Promise<void> {
    this.published.push(event);
  }
  async publishAll(events: DomainEvent[]): Promise<void> {
    for (const event of events) await this.publish(event);
  }
  subscribe<T extends DomainEvent>(_eventType: DomainEventClass<T>, _handler: EventHandler<T>): void {}
}

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------
function makeRepos() {
  const professionalVerifications = new FakeProfessionalVerificationRepository(
    new VerificationFakeProfessionalRepository(),
  );
  const companyVerifications = new FakeCompanyVerificationRepository();
  const companies = new FakeCompanyRepository();
  const companyPayoutAccounts = new FakeCompanyPayoutAccountRepository();
  const professionalOnboardings = new FakeProfessionalOnboardingRepository();

  const payoutEligibility = new CheckPayoutEligibilityUseCase(
    professionalVerifications,
    companyVerifications,
    companies,
    companyPayoutAccounts,
  );

  const jobs = new FakeJobRepository();
  const confirmations = new FakeCompletionConfirmationRepository();
  const disputes = new FakeDisputeRepository();
  const payments = new FakePaymentRepository();
  const professionals = new FakeProfessionalRepository();
  const trustAutomatedActions = new FakeTrustAutomatedActionRepository();
  const eventBus = new RecordingEventBus();

  const evaluateRelease = new EvaluatePaymentReleaseUseCase(
    jobs,
    confirmations,
    disputes,
    payments,
    professionals,
    trustAutomatedActions,
    payoutEligibility,
    eventBus,
    undefined,
    companies,
  );

  const resolveDestination = new ResolvePayoutDestinationUseCase(professionalOnboardings, companyPayoutAccounts);

  return {
    professionalVerifications,
    companyVerifications,
    companies,
    companyPayoutAccounts,
    professionalOnboardings,
    payoutEligibility,
    jobs,
    confirmations,
    disputes,
    payments,
    professionals,
    trustAutomatedActions,
    eventBus,
    evaluateRelease,
    resolveDestination,
  };
}

function seedActiveCompany(repos: ReturnType<typeof makeRepos>, ownerUserId = "owner-user-1") {
  const company = repos.companies.companies.set(nextId("company"), undefined as never); // placeholder, overwritten below
  void company;
  const record = repos.companies.companies;
  const id = nextId("company");
  const now = new Date();
  const companyRecord = {
    id,
    ownerUserId,
    legalName: "Acme Plumbing SL",
    tradeName: null,
    taxId: `B${id}`,
    description: null,
    logoUrl: null,
    websiteUrl: null,
    slug: id,
    contactEmail: null,
    contactPhone: null,
    addressLine: null,
    city: null,
    province: null,
    postalCode: null,
    country: "ES",
    latitude: null,
    longitude: null,
    status: "ACTIVE" as const,
    suspendedAt: null,
    isVerified: true,
    verifiedAt: now,
    stripeConnectAccountId: null,
    averageRating: null,
    reviewCount: 0,
    isAcceptingRequests: true,
    categoryIds: [],
    createdAt: now,
    updatedAt: now,
  };
  record.set(id, companyRecord);
  return companyRecord;
}

function seedApprovedVerification(repos: ReturnType<typeof makeRepos>, companyProfileId: string) {
  return repos.companyVerifications.seed({ companyProfileId, status: "APPROVED" });
}

function seedConnectedPayoutAccount(repos: ReturnType<typeof makeRepos>, companyProfileId: string, status: "PENDING" | "VERIFIED" | "REJECTED" = "VERIFIED") {
  return repos.companyPayoutAccounts.upsertPayoutAccount({
    companyProfileId,
    method: "IBAN",
    status,
    accountHolderName: "Acme Plumbing SL",
    ibanLast4: "1234",
    ibanHash: `hash-${companyProfileId}`,
  });
}

// ===========================================================================
// 1. CompanyPayoutAccountRepository — creation/reconstitution/ownership/
//    duplicate-prevention/missing-account/cross-company-access.
// ===========================================================================
describe("CompanyPayoutAccountRepository (Module 75)", () => {
  it("creates a payout account for a company that has none yet", async () => {
    const repo = new FakeCompanyPayoutAccountRepository();
    const created = await repo.upsertPayoutAccount({
      companyProfileId: "company-a",
      method: "IBAN",
      status: "PENDING",
      accountHolderName: "Company A SL",
      ibanLast4: "5678",
      ibanHash: "hash-a",
    });
    expect(created.companyProfileId).toBe("company-a");
    expect(created.status).toBe("PENDING");
  });

  it("reconstitutes the exact same record on read after creation", async () => {
    const repo = new FakeCompanyPayoutAccountRepository();
    const created = await repo.upsertPayoutAccount({
      companyProfileId: "company-b",
      method: "IBAN",
      status: "VERIFIED",
      accountHolderName: "Company B SL",
      ibanLast4: "9999",
      ibanHash: "hash-b",
    });
    const fetched = await repo.findByCompanyProfileId("company-b");
    expect(fetched).toEqual(created);
  });

  it("is owned by exactly one company — findByCompanyProfileId never returns another company's account", async () => {
    const repo = new FakeCompanyPayoutAccountRepository();
    await repo.upsertPayoutAccount({
      companyProfileId: "company-c",
      method: "IBAN",
      status: "VERIFIED",
      accountHolderName: "Company C SL",
      ibanLast4: "1111",
      ibanHash: "hash-c",
    });
    // A different company, never given a payout account of its own.
    const other = await repo.findByCompanyProfileId("company-d");
    expect(other).toBeNull();
  });

  it("upsert (never duplicate rows) — a second call for the same company replaces, not duplicates", async () => {
    const repo = new FakeCompanyPayoutAccountRepository();
    await repo.upsertPayoutAccount({
      companyProfileId: "company-e",
      method: "IBAN",
      status: "PENDING",
      accountHolderName: "Company E SL",
      ibanLast4: "2222",
      ibanHash: "hash-e",
    });
    const replaced = await repo.upsertPayoutAccount({
      companyProfileId: "company-e",
      method: "IBAN",
      status: "VERIFIED",
      accountHolderName: "Company E SL (updated)",
      ibanLast4: "3333",
      ibanHash: "hash-e-2",
    });
    expect(repo.accounts.size).toBe(1);
    expect(replaced.status).toBe("VERIFIED");
    expect(replaced.accountHolderName).toBe("Company E SL (updated)");
  });

  it("returns null (missing account), never throws, for a company with no payout account", async () => {
    const repo = new FakeCompanyPayoutAccountRepository();
    await expect(repo.findByCompanyProfileId("nonexistent-company")).resolves.toBeNull();
  });

  it("updateStripeConnectAccount throws NotFoundError for a company with no existing row (cannot cross-create)", async () => {
    const repo = new FakeCompanyPayoutAccountRepository();
    await expect(
      repo.updateStripeConnectAccount("company-with-no-account", { stripeExpressStatus: "READY" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

// ===========================================================================
// 2. Company payout eligibility (CheckPayoutEligibilityUseCase.executeForCompany)
// ===========================================================================
describe("CheckPayoutEligibilityUseCase.executeForCompany (Module 75)", () => {
  it("blocks an unverified company (no verification case at all)", async () => {
    const repos = makeRepos();
    const company = seedActiveCompany(repos);
    const result = await repos.payoutEligibility.executeForCompany(company.id);
    expect(result.eligible).toBe(false);
    expect(result.status).toBe("NOT_STARTED");
  });

  it("blocks a company whose verification case is not APPROVED", async () => {
    const repos = makeRepos();
    const company = seedActiveCompany(repos);
    repos.companyVerifications.seed({ companyProfileId: company.id, status: "PENDING" });
    const result = await repos.payoutEligibility.executeForCompany(company.id);
    expect(result.eligible).toBe(false);
    expect(result.status).toBe("PENDING");
  });

  it("blocks an inactive (non-ACTIVE) company even if verification is APPROVED", async () => {
    const repos = makeRepos();
    const company = seedActiveCompany(repos);
    repos.companies.companies.set(company.id, { ...company, status: "SUSPENDED" });
    seedApprovedVerification(repos, company.id);
    seedConnectedPayoutAccount(repos, company.id);
    const result = await repos.payoutEligibility.executeForCompany(company.id);
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/not active/i);
  });

  it("blocks a verified, active company with no payout account", async () => {
    const repos = makeRepos();
    const company = seedActiveCompany(repos);
    seedApprovedVerification(repos, company.id);
    const result = await repos.payoutEligibility.executeForCompany(company.id);
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/payout destination/i);
  });

  it("blocks a verified, active company whose payout account was REJECTED", async () => {
    const repos = makeRepos();
    const company = seedActiveCompany(repos);
    seedApprovedVerification(repos, company.id);
    await seedConnectedPayoutAccount(repos, company.id, "REJECTED");
    const result = await repos.payoutEligibility.executeForCompany(company.id);
    expect(result.eligible).toBe(false);
  });

  it("is eligible when verified, active, and has a connected (PENDING or VERIFIED) payout account", async () => {
    const repos = makeRepos();
    const company = seedActiveCompany(repos);
    seedApprovedVerification(repos, company.id);
    await seedConnectedPayoutAccount(repos, company.id, "PENDING");
    const result = await repos.payoutEligibility.executeForCompany(company.id);
    expect(result.eligible).toBe(true);
  });

  it("throws when called on an instance not configured with company dependencies (never silently 'eligible: false')", async () => {
    const professionalVerifications = new FakeProfessionalVerificationRepository(
      new VerificationFakeProfessionalRepository(),
    );
    const soloOnlyUseCase = new CheckPayoutEligibilityUseCase(professionalVerifications);
    await expect(soloOnlyUseCase.executeForCompany("some-company")).rejects.toThrow();
  });
});

// ===========================================================================
// 3. Solo-professional eligibility — regression: execute() is byte-for-byte
//    unchanged behavior.
// ===========================================================================
describe("CheckPayoutEligibilityUseCase.execute (solo professional — Module 75 regression)", () => {
  it("still blocks a professional with no verification case", async () => {
    const repos = makeRepos();
    const result = await repos.payoutEligibility.execute("professional-with-no-case");
    expect(result).toEqual({
      eligible: false,
      status: "NOT_STARTED",
      reason: "This professional has not started identity verification.",
    });
  });

  it("still approves a professional whose verification is APPROVED", async () => {
    const repos = makeRepos();
    const verification = await repos.professionalVerifications.create("professional-1");
    await repos.professionalVerifications.updateStatus(verification.id, {
      status: "APPROVED",
      reviewedAt: new Date(),
      expiresAt: null,
    });
    const result = await repos.payoutEligibility.execute("professional-1");
    expect(result.eligible).toBe(true);
  });
});

// ===========================================================================
// 4. Payment release integration (EvaluatePaymentReleaseUseCase — Module 66)
// ===========================================================================
describe("EvaluatePaymentReleaseUseCase — company-owned jobs (Module 75)", () => {
  function seedEligibleCompanyJob(repos: ReturnType<typeof makeRepos>, jobId: string) {
    const company = seedActiveCompany(repos);
    seedApprovedVerification(repos, company.id);
    seedConnectedPayoutAccount(repos, company.id);
    repos.jobs.jobs.set(
      jobId,
      makeJob({ id: jobId, companyProfileId: company.id, professionalProfileId: null, status: "COMPLETED" }),
    );
    repos.confirmations.seed({ jobId, status: "CONFIRMED" });
    repos.payments.payments.push(makePayment({ id: `payment-${jobId}`, jobId, status: "CAPTURED" }));
    return company;
  }

  it("an eligible company-owned job reaches RELEASE_APPROVED", async () => {
    const repos = makeRepos();
    seedEligibleCompanyJob(repos, "job-company-eligible");
    const result = await repos.evaluateRelease.execute("job-company-eligible");
    expect(result.releaseStatus).toBe("RELEASE_APPROVED");
    expect(repos.eventBus.published.some((e) => e.constructor.name === "PaymentReleaseApproved")).toBe(true);
  });

  it("an ineligible company-owned job (unverified) does NOT reach RELEASE_APPROVED", async () => {
    const repos = makeRepos();
    const company = seedActiveCompany(repos);
    // No CompanyVerification, no CompanyPayoutAccount seeded.
    repos.jobs.jobs.set(
      "job-company-unverified",
      makeJob({ id: "job-company-unverified", companyProfileId: company.id, status: "COMPLETED" }),
    );
    repos.confirmations.seed({ jobId: "job-company-unverified", status: "CONFIRMED" });
    repos.payments.payments.push(makePayment({ id: "payment-unverified", jobId: "job-company-unverified", status: "CAPTURED" }));

    const result = await repos.evaluateRelease.execute("job-company-unverified");
    expect(result.releaseStatus).toBe("RELEASE_HELD");
  });

  it("a company job that is verified/active but has NO payout account is blocked from RELEASE_APPROVED", async () => {
    const repos = makeRepos();
    const company = seedActiveCompany(repos);
    seedApprovedVerification(repos, company.id);
    // Deliberately no CompanyPayoutAccount seeded — this is the exact
    // "missing company payout destination blocks eligibility" case.
    repos.jobs.jobs.set(
      "job-company-no-account",
      makeJob({ id: "job-company-no-account", companyProfileId: company.id, status: "COMPLETED" }),
    );
    repos.confirmations.seed({ jobId: "job-company-no-account", status: "CONFIRMED" });
    repos.payments.payments.push(makePayment({ id: "payment-no-account", jobId: "job-company-no-account", status: "CAPTURED" }));

    const result = await repos.evaluateRelease.execute("job-company-no-account");
    expect(result.releaseStatus).toBe("RELEASE_HELD");
  });

  it("Module 66 protection still applies to an otherwise-eligible company job: an open dispute blocks release", async () => {
    const repos = makeRepos();
    seedEligibleCompanyJob(repos, "job-company-disputed");
    repos.disputes.disputes.push({
      id: "dispute-1",
      caseNumber: "D-1",
      title: "Quality issue",
      jobId: "job-company-disputed",
      serviceRequestId: "sr-1",
      raisedByUserId: "customer-user-1",
      respondentProfessionalProfileId: null,
      respondentCompanyProfileId: null,
      reason: "SERVICE_QUALITY_ISSUE" as never,
      status: "OPEN" as never,
      priority: "MEDIUM" as never,
      description: "Not satisfied",
      assignedAdminUserId: null,
      resolution: null,
      resolutionNote: null,
      resolvedAt: null,
      resolvedByUserId: null,
      closedAt: null,
      closedByUserId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as DisputeRecord);

    const result = await repos.evaluateRelease.execute("job-company-disputed");
    expect(result.releaseStatus).toBe("RELEASE_HELD");
    expect(result.releaseReason).toMatch(/dispute/i);
  });

  it("Module 66 protection still applies to an otherwise-eligible company job: an uncaptured payment blocks release", async () => {
    const repos = makeRepos();
    const company = seedActiveCompany(repos);
    seedApprovedVerification(repos, company.id);
    seedConnectedPayoutAccount(repos, company.id);
    repos.jobs.jobs.set(
      "job-company-uncaptured",
      makeJob({ id: "job-company-uncaptured", companyProfileId: company.id, status: "COMPLETED" }),
    );
    repos.confirmations.seed({ jobId: "job-company-uncaptured", status: "CONFIRMED" });
    repos.payments.payments.push(makePayment({ id: "payment-uncaptured", jobId: "job-company-uncaptured", status: "AUTHORIZED" }));

    const result = await repos.evaluateRelease.execute("job-company-uncaptured");
    expect(result.releaseStatus).toBe("RELEASE_HELD");
  });

  it("Module 66 protection still applies to an otherwise-eligible company job: a cancelled job is RELEASE_DENIED, never approved", async () => {
    const repos = makeRepos();
    const company = seedActiveCompany(repos);
    seedApprovedVerification(repos, company.id);
    seedConnectedPayoutAccount(repos, company.id);
    repos.jobs.jobs.set(
      "job-company-cancelled",
      makeJob({ id: "job-company-cancelled", companyProfileId: company.id, status: "CANCELLED" }),
    );
    repos.confirmations.seed({ jobId: "job-company-cancelled", status: "CONFIRMED" });
    repos.payments.payments.push(makePayment({ id: "payment-cancelled", jobId: "job-company-cancelled", status: "CAPTURED" }));

    const result = await repos.evaluateRelease.execute("job-company-cancelled");
    expect(result.releaseStatus).toBe("RELEASE_DENIED");
  });

  it("Module 66 protection still applies to an otherwise-eligible company job: an active Trust & Integrity payout hold on the owner blocks release", async () => {
    const repos = makeRepos();
    const company = seedEligibleCompanyJob(repos, "job-company-held");
    repos.trustAutomatedActions.seedHold(company.ownerUserId);

    const result = await repos.evaluateRelease.execute("job-company-held");
    expect(result.releaseStatus).toBe("RELEASE_HELD");
  });

  // -------------------------------------------------------------------------
  // Explicit regression guard: company payout support must not be silently
  // removed in the future — a company-owned job that satisfies every
  // condition MUST be able to reach RELEASE_APPROVED. If a future change
  // reintroduces the pre-Module-75 "always RELEASE_HELD for company jobs"
  // behavior, this test fails.
  // -------------------------------------------------------------------------
  it("REGRESSION GUARD: company payout eligibility must remain wired into payment release — an eligible company job is NOT hardcoded to RELEASE_HELD", async () => {
    const repos = makeRepos();
    seedEligibleCompanyJob(repos, "job-company-regression-guard");
    const result = await repos.evaluateRelease.execute("job-company-regression-guard");
    expect(result.releaseStatus).not.toBe("RELEASE_HELD");
    expect(result.releaseStatus).toBe("RELEASE_APPROVED");
  });
});

// ===========================================================================
// 5. Solo-professional payment release — regression: unchanged behavior.
// ===========================================================================
describe("EvaluatePaymentReleaseUseCase — solo professional (Module 75 regression)", () => {
  it("an eligible solo-professional job still reaches RELEASE_APPROVED exactly as before Module 75", async () => {
    const repos = makeRepos();
    const professional = { userId: "pro-user-1" } as ProfessionalRecord;
    const fullProfessional: ProfessionalRecord = {
      id: "professional-solo-1",
      userId: "pro-user-1",
      businessName: "Solo Plumber",
      bio: null,
      headline: null,
      yearsExperience: 5,
      hourlyRate: 30,
      serviceRadiusKm: 10,
      contactEmail: null,
      contactPhone: null,
      websiteUrl: null,
      taxId: null,
      status: "ACTIVE",
      verificationStatus: "UNVERIFIED",
      verifiedAt: null,
      isAcceptingRequests: true,
      categoryIds: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    void professional;
    repos.professionals.professionals.push(fullProfessional);

    const verification = await repos.professionalVerifications.create("professional-solo-1");
    await repos.professionalVerifications.updateStatus(verification.id, {
      status: "APPROVED",
      reviewedAt: new Date(),
      expiresAt: null,
    });

    repos.jobs.jobs.set(
      "job-solo-eligible",
      makeJob({ id: "job-solo-eligible", professionalProfileId: "professional-solo-1", status: "COMPLETED" }),
    );
    repos.confirmations.seed({ jobId: "job-solo-eligible", status: "CONFIRMED" });
    repos.payments.payments.push(makePayment({ id: "payment-solo-eligible", jobId: "job-solo-eligible", status: "CAPTURED" }));

    const result = await repos.evaluateRelease.execute("job-solo-eligible");
    expect(result.releaseStatus).toBe("RELEASE_APPROVED");
  });
});

// ===========================================================================
// 6. Payout destination resolution (ResolvePayoutDestinationUseCase)
// ===========================================================================
describe("ResolvePayoutDestinationUseCase (Module 75)", () => {
  it("resolves a solo professional's ProfessionalPayoutAccount", async () => {
    const repos = makeRepos();
    await repos.professionalOnboardings.upsertPayoutAccount({
      professionalProfileId: "professional-solo-2",
      method: "IBAN",
      status: "VERIFIED",
      accountHolderName: "Solo Pro",
      ibanLast4: "4444",
      ibanHash: "hash-solo-2",
    });

    const resolved = await repos.resolveDestination.execute({
      type: "PROFESSIONAL",
      professionalProfileId: "professional-solo-2",
    });
    expect(resolved.ownerType).toBe("PROFESSIONAL");
    expect(resolved.account.accountHolderName).toBe("Solo Pro");
  });

  it("resolves a company's CompanyPayoutAccount", async () => {
    const repos = makeRepos();
    const company = seedActiveCompany(repos);
    await seedConnectedPayoutAccount(repos, company.id);

    const resolved = await repos.resolveDestination.execute({ type: "COMPANY", companyProfileId: company.id });
    expect(resolved.ownerType).toBe("COMPANY");
    if (resolved.ownerType !== "COMPANY") throw new Error("expected COMPANY");
    expect(resolved.account.companyProfileId).toBe(company.id);
  });

  it("never cross-resolves — a company id passed as a professional id resolves nothing", async () => {
    const repos = makeRepos();
    const company = seedActiveCompany(repos);
    await seedConnectedPayoutAccount(repos, company.id);

    await expect(
      repos.resolveDestination.execute({ type: "PROFESSIONAL", professionalProfileId: company.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("never cross-resolves — a professional id passed as a company id resolves nothing", async () => {
    const repos = makeRepos();
    await repos.professionalOnboardings.upsertPayoutAccount({
      professionalProfileId: "professional-solo-3",
      method: "IBAN",
      status: "VERIFIED",
      accountHolderName: "Solo Pro 3",
      ibanLast4: "5555",
      ibanHash: "hash-solo-3",
    });

    await expect(
      repos.resolveDestination.execute({ type: "COMPANY", companyProfileId: "professional-solo-3" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("rejects (never returns) a missing destination", async () => {
    const repos = makeRepos();
    await expect(
      repos.resolveDestination.execute({ type: "COMPANY", companyProfileId: "company-with-no-destination" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("rejects (never returns) an inactive/REJECTED destination when requireConnected is true", async () => {
    const repos = makeRepos();
    const company = seedActiveCompany(repos);
    await seedConnectedPayoutAccount(repos, company.id, "REJECTED");

    await expect(repos.resolveDestination.execute({ type: "COMPANY", companyProfileId: company.id })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("solo resolution behavior is unchanged: still returns the professional's own ProfessionalPayoutAccount, not any other professional's", async () => {
    const repos = makeRepos();
    await repos.professionalOnboardings.upsertPayoutAccount({
      professionalProfileId: "professional-solo-4",
      method: "IBAN",
      status: "VERIFIED",
      accountHolderName: "Solo Pro 4",
      ibanLast4: "6666",
      ibanHash: "hash-solo-4",
    });
    await repos.professionalOnboardings.upsertPayoutAccount({
      professionalProfileId: "professional-solo-5",
      method: "IBAN",
      status: "VERIFIED",
      accountHolderName: "Solo Pro 5",
      ibanLast4: "7777",
      ibanHash: "hash-solo-5",
    });

    const resolved = await repos.resolveDestination.execute({
      type: "PROFESSIONAL",
      professionalProfileId: "professional-solo-4",
    });
    expect(resolved.account.accountHolderName).toBe("Solo Pro 4");
  });
});
