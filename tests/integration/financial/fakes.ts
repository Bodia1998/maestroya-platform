import type { CommissionRateRepository } from "@/domain/repositories/commission-rate-repository";
import type {
  CommissionRecord,
  CommissionRepository,
  CreateCommissionData,
} from "@/domain/repositories/commission-repository";
import type {
  CreateFinancialAdjustmentData,
  FinancialAdjustmentRecord,
  FinancialAdjustmentRepository,
  FinancialAdjustmentTypeValue,
} from "@/domain/repositories/financial-adjustment-repository";
import type {
  CreateLedgerEntryData,
  FinancialLedgerRepository,
  FinancialTransactionRecord,
} from "@/domain/repositories/financial-ledger-repository";
import type {
  CreatePaymentRecordData,
  PaymentRecord,
  PaymentRepository,
  PaymentStatusValue,
  UpdatePaymentStatusInput,
  UpdatePaymentStatusResult,
} from "@/domain/repositories/payment-repository";
import { ACTIVE_PAYMENT_STATUSES } from "@/domain/repositories/payment-repository";
import { DEFAULT_COMMISSION_RATES, type CommissionRates } from "@/domain/services/commission-policy";
import type {
  ConfirmCompletionData,
  CreateJobCompletionConfirmationData,
  DisputeCompletionData,
  JobCompletionConfirmationRecord,
  JobCompletionConfirmationRepository,
  TimeOutCompletionData,
  UpdateReleaseDecisionData,
} from "@/domain/repositories/job-completion-confirmation-repository";
import type { PaymentReleaseStatus } from "@/domain/services/payment-release-decision";
import { ConflictError } from "@/domain/errors/domain-error";
import type { ProfessionalPayoutLedgerRepository } from "@/domain/repositories/professional-payout-ledger-repository";
import type {
  CreateTrustAutomatedActionData,
  TrustAutomatedActionRecord,
  TrustAutomatedActionRepository,
  TrustAutomatedActionTypeValue,
} from "@/domain/repositories/trust-automated-action-repository";

/**
 * In-memory test doubles for Module 22 — Commission & Financial
 * integration tests. Same pattern as every other module's
 * tests/integration/<feature>/fakes.ts: implement the real domain
 * interfaces so the use cases under test run their genuine orchestration
 * logic, with only storage swapped out.
 */

let idCounter = 0;
function nextId(prefix: string) {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

export class FakeCommissionRateRepository implements CommissionRateRepository {
  rates: CommissionRates = { ...DEFAULT_COMMISSION_RATES };

  async getCurrentRates(): Promise<CommissionRates> {
    return this.rates;
  }
}

export class FakePaymentRepository implements PaymentRepository {
  payments = new Map<string, PaymentRecord>();

  /**
   * Module 73 — mirrors `PrismaPaymentRepository`'s own "resolve `jobId`
   * via the Payment -> Quote -> Job relation at read time, never a stored
   * column" behavior (see that repository's own doc comment) for
   * `create()`, which — unlike `seed()` — never receives a `jobId`
   * directly (real `CreatePaymentRecordData` doesn't have one either).
   * Optional and defaulting to "always null" so every pre-Module-73 test
   * that constructs `new FakePaymentRepository()` with no arguments (this
   * class's only other test-visible behavior) keeps compiling and
   * behaving exactly as before; only `tests/integration/payments`
   * (Module 73's own end-to-end test) supplies a real resolver.
   */
  constructor(private readonly resolveJobIdByQuoteId: (quoteId: string) => string | null = () => null) {}
  refundsByPayment = new Map<string, number>();

  /** Module 73 — the three new `PaymentRecord` fields
   *  (`stripePaymentIntentId`/`method`/`failureReason`) default to safe
   *  values here so every pre-Module-73 test that seeds a payment without
   *  them (they only ever cared about status/amount/jobId) keeps compiling
   *  and behaving exactly as before. */
  seed(payment: Omit<PaymentRecord, "stripePaymentIntentId" | "method" | "failureReason"> & Partial<Pick<PaymentRecord, "stripePaymentIntentId" | "method" | "failureReason">>) {
    const record: PaymentRecord = {
      stripePaymentIntentId: `pi_fake_${payment.id}`,
      method: "CARD",
      failureReason: null,
      ...payment,
    };
    this.payments.set(record.id, record);
    return record;
  }

  seedProcessedRefund(paymentId: string, amount: number) {
    this.refundsByPayment.set(paymentId, (this.refundsByPayment.get(paymentId) ?? 0) + amount);
  }

  async findById(id: string): Promise<PaymentRecord | null> {
    return this.payments.get(id) ?? null;
  }

  async findByJobId(jobId: string): Promise<PaymentRecord[]> {
    return [...this.payments.values()].filter((p) => p.jobId === jobId);
  }

  async listForPayer(payerId: string): Promise<PaymentRecord[]> {
    return [...this.payments.values()].filter((p) => p.payerId === payerId);
  }

  async sumProcessedRefunds(paymentId: string): Promise<number> {
    return this.refundsByPayment.get(paymentId) ?? 0;
  }

  async findByStripePaymentIntentId(stripePaymentIntentId: string): Promise<PaymentRecord | null> {
    return [...this.payments.values()].find((p) => p.stripePaymentIntentId === stripePaymentIntentId) ?? null;
  }

  async findActiveByQuoteId(quoteId: string): Promise<PaymentRecord | null> {
    return (
      [...this.payments.values()].find(
        (p) => p.quoteId === quoteId && (ACTIVE_PAYMENT_STATUSES as readonly string[]).includes(p.status),
      ) ?? null
    );
  }

  async create(data: CreatePaymentRecordData): Promise<PaymentRecord> {
    // Module 87 — synchronous scan over `this.payments` (no
    // `await this.findByStripePaymentIntentId(...)` in between check and
    // write), so a concurrency test racing two `create()` calls on the
    // same `stripePaymentIntentId` actually exercises the same
    // "second caller must not create a duplicate row" guarantee the real
    // Prisma-backed repository's unique constraint provides. Same
    // fix/rationale as `FakeCommissionRepository.create` below.
    const existing = [...this.payments.values()].find((p) => p.stripePaymentIntentId === data.stripePaymentIntentId);
    if (existing) return existing;

    const record: PaymentRecord = {
      id: data.id,
      serviceRequestId: data.serviceRequestId,
      quoteId: data.quoteId,
      jobId: this.resolveJobIdByQuoteId(data.quoteId),
      payerId: data.payerId,
      amount: data.amount,
      currency: data.currency,
      status: "PENDING",
      capturedAt: null,
      stripePaymentIntentId: data.stripePaymentIntentId,
      method: data.method,
      failureReason: null,
    };
    this.payments.set(record.id, record);
    return record;
  }

  async updateStatus(input: UpdatePaymentStatusInput): Promise<UpdatePaymentStatusResult> {
    const record = this.payments.get(input.id);
    if (!record) {
      throw new Error(`FakePaymentRepository.updateStatus: no payment ${input.id}`);
    }
    if (!input.fromStatuses.includes(record.status)) {
      return { applied: false, record };
    }
    const updated: PaymentRecord = {
      ...record,
      status: input.toStatus,
      capturedAt: input.capturedAt !== undefined ? input.capturedAt : record.capturedAt,
      failureReason: input.failureReason !== undefined ? input.failureReason : record.failureReason,
    };
    this.payments.set(record.id, updated);
    return { applied: true, record: updated };
  }
}

export class FakeCommissionRepository implements CommissionRepository {
  commissions = new Map<string, CommissionRecord>();

  async findByPaymentId(paymentId: string): Promise<CommissionRecord | null> {
    return [...this.commissions.values()].find((c) => c.paymentId === paymentId) ?? null;
  }

  async create(data: CreateCommissionData): Promise<CommissionRecord> {
    // Module 84 hardening: the existence check and the write must happen
    // with no `await` between them, or two concurrent calls racing on the
    // same paymentId can both observe "no existing row" before either one
    // writes (a classic TOCTOU gap) — the opposite of what a real
    // database's UNIQUE constraint on Commission.paymentId guarantees.
    // Checking the in-memory Map directly (synchronously) rather than via
    // `await this.findByPaymentId(...)` is what makes this fake an
    // accurate stand-in for that atomicity.
    const existing = [...this.commissions.values()].find((c) => c.paymentId === data.paymentId);
    if (existing) {
      throw new Error("Unique constraint violation: Commission.paymentId");
    }
    const record: CommissionRecord = {
      id: nextId("fake-commission"),
      paymentId: data.paymentId,
      professionalProfileId: data.professionalProfileId,
      companyProfileId: data.companyProfileId,
      rateBps: data.rateBps,
      amount: data.amount,
      status: "PENDING",
      settledAt: null,
      createdAt: new Date(),
    };
    this.commissions.set(record.id, record);
    return record;
  }

  async listForProfessional(professionalProfileId: string): Promise<CommissionRecord[]> {
    return [...this.commissions.values()].filter((c) => c.professionalProfileId === professionalProfileId);
  }

  async listForCompany(companyProfileId: string): Promise<CommissionRecord[]> {
    return [...this.commissions.values()].filter((c) => c.companyProfileId === companyProfileId);
  }
}

export class FakeFinancialLedgerRepository implements FinancialLedgerRepository {
  entries: FinancialTransactionRecord[] = [];

  async create(data: CreateLedgerEntryData): Promise<FinancialTransactionRecord> {
    // Module 84 hardening — see FakeCommissionRepository.create's own
    // comment: no `await` between the existence check and the write, so
    // this fake actually enforces Transaction.idempotencyKey's uniqueness
    // atomically, the same way the real database does.
    const existing = this.entries.find((e) => e.idempotencyKey === data.idempotencyKey);
    if (existing) {
      throw new Error("Unique constraint violation: Transaction.idempotencyKey");
    }
    const record: FinancialTransactionRecord = {
      id: nextId("fake-transaction"),
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
    this.entries.push(record);
    return record;
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<FinancialTransactionRecord | null> {
    return this.entries.find((e) => e.idempotencyKey === idempotencyKey) ?? null;
  }

  async listForPayment(paymentId: string): Promise<FinancialTransactionRecord[]> {
    return this.entries.filter((e) => e.paymentId === paymentId);
  }
}

export class FakeFinancialAdjustmentRepository implements FinancialAdjustmentRepository {
  adjustments = new Map<string, FinancialAdjustmentRecord>();

  async findByIdempotencyKey(idempotencyKey: string): Promise<FinancialAdjustmentRecord | null> {
    return [...this.adjustments.values()].find((a) => a.idempotencyKey === idempotencyKey) ?? null;
  }

  async findById(id: string): Promise<FinancialAdjustmentRecord | null> {
    return this.adjustments.get(id) ?? null;
  }

  async create(data: CreateFinancialAdjustmentData): Promise<FinancialAdjustmentRecord> {
    const record: FinancialAdjustmentRecord = {
      id: nextId("fake-adjustment"),
      jobId: data.jobId,
      disputeId: data.disputeId,
      paymentId: data.paymentId,
      type: data.type,
      status: "PENDING",
      amount: data.amount,
      currency: "EUR",
      reason: data.reason,
      requestedByUserId: data.requestedByUserId,
      idempotencyKey: data.idempotencyKey,
      transactionId: null,
      resolutionDecisionId: data.resolutionDecisionId ?? null,
      appliedAt: null,
      createdAt: new Date(),
    };
    this.adjustments.set(record.id, record);
    return record;
  }

  async markApplied(id: string, transactionId: string): Promise<FinancialAdjustmentRecord> {
    const existing = this.adjustments.get(id);
    if (!existing || existing.status !== "PENDING") {
      throw new Error("This financial adjustment is no longer pending.");
    }
    const updated = { ...existing, status: "APPLIED" as const, transactionId, appliedAt: new Date() };
    this.adjustments.set(id, updated);
    return updated;
  }

  async markFailed(id: string): Promise<FinancialAdjustmentRecord> {
    const existing = this.adjustments.get(id);
    if (!existing || existing.status !== "PENDING") {
      throw new Error("This financial adjustment is no longer pending.");
    }
    const updated = { ...existing, status: "FAILED" as const };
    this.adjustments.set(id, updated);
    return updated;
  }

  async listForJob(jobId: string): Promise<FinancialAdjustmentRecord[]> {
    return [...this.adjustments.values()].filter((a) => a.jobId === jobId);
  }

  async sumAppliedAmountForPayment(paymentId: string, types: readonly FinancialAdjustmentTypeValue[]): Promise<number> {
    return [...this.adjustments.values()]
      .filter((a) => a.paymentId === paymentId && a.status === "APPLIED" && types.includes(a.type))
      .reduce((sum, a) => sum + a.amount, 0);
  }
}

/**
 * Module 66 — Job Completion & Payment Release Protection: the fake
 * `JobCompletionConfirmationRepository` `RecordCommissionForPaymentUseCase`
 * now depends on (see that use case's own doc comment on the release
 * gate). Same in-memory, real-interface pattern as every other fake in
 * this file. `seed`/`seedApproved`/`seedHeld` are test-only conveniences
 * for directly placing a confirmation row at a given `releaseStatus` —
 * financial-flows.test.ts never needs to drive the full Module 66
 * confirm/dispute/timeout state machine to test the commission gate,
 * only the persisted `releaseStatus` the gate actually reads.
 */
export class FakeJobCompletionConfirmationRepository implements JobCompletionConfirmationRepository {
  records = new Map<string, JobCompletionConfirmationRecord>();

  seed(record: JobCompletionConfirmationRecord) {
    this.records.set(record.id, record);
    return record;
  }

  async findById(id: string): Promise<JobCompletionConfirmationRecord | null> {
    return this.records.get(id) ?? null;
  }

  async findByJobId(jobId: string): Promise<JobCompletionConfirmationRecord | null> {
    return [...this.records.values()].find((r) => r.jobId === jobId) ?? null;
  }

  async create(data: CreateJobCompletionConfirmationData): Promise<JobCompletionConfirmationRecord> {
    if (await this.findByJobId(data.jobId)) {
      throw new ConflictError("A completion confirmation already exists for this job.");
    }
    const record: JobCompletionConfirmationRecord = {
      id: nextId("fake-completion-confirmation"),
      jobId: data.jobId,
      status: "WAITING_FOR_CUSTOMER",
      professionalCompletedAt: data.professionalCompletedAt,
      confirmationDeadlineAt: data.confirmationDeadlineAt,
      confirmedAt: null,
      confirmedByUserId: null,
      disputeId: null,
      manualReviewCaseId: null,
      reminderSentAt: null,
      // Matches PrismaJobCompletionConfirmationRepository's own `as
      // PaymentReleaseStatus` cast (see that file) — the persisted DB
      // enum has a 4th value, PENDING, that the pure decision function's
      // narrower domain type intentionally omits (PENDING is a storage
      // default, never a value `decidePaymentReleaseStatus` itself
      // returns). Not this fix's concern to widen; mirrored as-is.
      releaseStatus: "PENDING" as PaymentReleaseStatus,
      releaseReason: "Not yet evaluated.",
      releaseDecidedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.records.set(record.id, record);
    return record;
  }

  async confirm(data: ConfirmCompletionData): Promise<JobCompletionConfirmationRecord> {
    const existing = this.records.get(data.id);
    if (!existing || !data.expectedStatuses.includes(existing.status)) {
      throw new ConflictError("This completion confirmation was already resolved.");
    }
    const updated: JobCompletionConfirmationRecord = {
      ...existing,
      status: "CONFIRMED",
      confirmedAt: data.confirmedAt,
      confirmedByUserId: data.confirmedByUserId,
      updatedAt: new Date(),
    };
    this.records.set(updated.id, updated);
    return updated;
  }

  async markDisputed(data: DisputeCompletionData): Promise<JobCompletionConfirmationRecord> {
    const existing = this.records.get(data.id);
    if (!existing || !data.expectedStatuses.includes(existing.status)) {
      throw new ConflictError("This completion confirmation was already resolved.");
    }
    const updated: JobCompletionConfirmationRecord = {
      ...existing,
      status: "DISPUTED",
      disputeId: data.disputeId,
      updatedAt: new Date(),
    };
    this.records.set(updated.id, updated);
    return updated;
  }

  async markTimedOut(data: TimeOutCompletionData): Promise<JobCompletionConfirmationRecord> {
    const existing = this.records.get(data.id);
    if (!existing || !data.expectedStatuses.includes(existing.status)) {
      throw new ConflictError("This completion confirmation was already resolved.");
    }
    const updated: JobCompletionConfirmationRecord = {
      ...existing,
      status: "TIMED_OUT_UNDER_REVIEW",
      manualReviewCaseId: data.manualReviewCaseId,
      updatedAt: new Date(),
    };
    this.records.set(updated.id, updated);
    return updated;
  }

  async markReminderSent(id: string, sentAt: Date): Promise<JobCompletionConfirmationRecord> {
    const existing = this.records.get(id);
    if (!existing) {
      throw new ConflictError("This completion confirmation no longer exists.");
    }
    const updated: JobCompletionConfirmationRecord = { ...existing, reminderSentAt: sentAt, updatedAt: new Date() };
    this.records.set(updated.id, updated);
    return updated;
  }

  async updateReleaseDecision(data: UpdateReleaseDecisionData): Promise<JobCompletionConfirmationRecord> {
    const existing = this.records.get(data.id);
    if (!existing || !data.expectedReleaseStatuses.includes(existing.releaseStatus)) {
      throw new ConflictError("This completion confirmation's release decision was already changed.");
    }
    const updated: JobCompletionConfirmationRecord = {
      ...existing,
      releaseStatus: data.releaseStatus,
      releaseReason: data.releaseReason,
      releaseDecidedAt: data.releaseDecidedAt,
      updatedAt: new Date(),
    };
    this.records.set(updated.id, updated);
    return updated;
  }

  async findOverdue(now: Date): Promise<JobCompletionConfirmationRecord[]> {
    return [...this.records.values()].filter(
      (r) => r.status === "WAITING_FOR_CUSTOMER" && r.confirmationDeadlineAt.getTime() <= now.getTime(),
    );
  }

  async findDueForReminder(_now: Date): Promise<JobCompletionConfirmationRecord[]> {
    return [];
  }
}

/**
 * Module 70.1 — Pre-Stripe Security & Integration Hardening (Objective D):
 * minimal, real-interface fakes for the two dependencies
 * `CheckPayoutReadinessUseCase` needs beyond what this file already
 * provides — narrow, single-purpose, same in-memory pattern as every
 * other fake here. `FakeTrustAutomatedActionRepository` only implements
 * the two methods that use case actually calls
 * (`listActiveForUser`/`create` for seeding); every other
 * `TrustAutomatedActionRepository` method is out of this file's scope and
 * intentionally omitted-then-stubbed with a clear failure rather than a
 * silent no-op, so a test that accidentally needs one fails loudly instead
 * of passing for the wrong reason.
 */
export class FakeTrustAutomatedActionRepository implements TrustAutomatedActionRepository {
  readonly actions: TrustAutomatedActionRecord[] = [];
  private idCounter = 0;

  async create(data: CreateTrustAutomatedActionData): Promise<TrustAutomatedActionRecord> {
    const record: TrustAutomatedActionRecord = {
      id: `fake-trust-action-${++this.idCounter}`,
      userId: data.userId,
      type: data.type,
      status: "ACTIVE",
      reason: data.reason,
      triggeringRiskScore: data.triggeringRiskScore,
      detail: data.detail,
      createdByUserId: data.createdByUserId ?? null,
      expiresAt: data.expiresAt ?? null,
      reversedAt: null,
      reversedByUserId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.actions.push(record);
    return record;
  }

  async findById(id: string): Promise<TrustAutomatedActionRecord | null> {
    return this.actions.find((a) => a.id === id) ?? null;
  }

  async listForUser(userId: string): Promise<TrustAutomatedActionRecord[]> {
    return this.actions.filter((a) => a.userId === userId);
  }

  async listActiveForUser(userId: string, type?: TrustAutomatedActionTypeValue): Promise<TrustAutomatedActionRecord[]> {
    return this.actions.filter((a) => a.userId === userId && a.status === "ACTIVE" && (!type || a.type === type));
  }

  async countActiveForUser(userId: string): Promise<number> {
    return this.actions.filter((a) => a.userId === userId && a.status === "ACTIVE").length;
  }

  async reverse(): Promise<TrustAutomatedActionRecord> {
    throw new Error("FakeTrustAutomatedActionRepository.reverse: not needed by this fake's callers.");
  }

  async expireDue(): Promise<number> {
    return 0;
  }

  async countAll(): Promise<number> {
    return this.actions.length;
  }

  async countByType(type: TrustAutomatedActionTypeValue): Promise<number> {
    return this.actions.filter((a) => a.type === type).length;
  }

  async countActive(): Promise<number> {
    return this.actions.filter((a) => a.status === "ACTIVE").length;
  }
}

/**
 * Module 70.1: `ProfessionalPayoutLedgerRepository` fake — a plain
 * `Map<professionalProfileId, number>` a test can seed directly (see
 * `seedPaid`) to exercise `CheckPayoutReadinessUseCase`'s
 * `amountAlreadyPaidOut` input.
 */
export class FakeProfessionalPayoutLedgerRepository implements ProfessionalPayoutLedgerRepository {
  paidByProfessional = new Map<string, number>();

  seedPaid(professionalProfileId: string, amount: number) {
    this.paidByProfessional.set(professionalProfileId, (this.paidByProfessional.get(professionalProfileId) ?? 0) + amount);
  }

  async sumPaidForProfessional(professionalProfileId: string): Promise<number> {
    return this.paidByProfessional.get(professionalProfileId) ?? 0;
  }
}

export type { PaymentStatusValue };
