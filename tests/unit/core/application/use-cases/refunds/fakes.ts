import type {
  CreatePendingRefundData,
  MarkRefundFailedInput,
  MarkRefundProcessedInput,
  RefundRecord,
  RefundRepository,
  UpdateRefundResult,
} from "@/domain/repositories/refund-repository";
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
import type { JobRecord, JobRepository, ListJobsOptions, CancelJobData, CompleteJobData, StartJobData } from "@/domain/repositories/job-repository";
import { FakePaymentRepository } from "../payments/fakes";

/**
 * Module 77 — Refund & Dispute Financial Execution: in-memory fakes for
 * this module's own use-case tests — same "one fakes.ts per module's own
 * test directory" convention every other module's own fakes.ts file
 * already establishes. Reuses `FakePaymentRepository`/`FakeDistributedLock`/
 * `FakeEventBus`/`FakePayoutRepository`/`FakeStripeTransferGateway`/
 * `FakeCommissionRepository`/`FakePaymentGateway` directly from the
 * sibling `../payments/fakes` module rather than redefining them — those
 * already faithfully reproduce the exact compare-and-swap/idempotency
 * semantics this module's own tests depend on.
 */

let refundFakeIdCounter = 0;
function refundFakeNextId(prefix: string): string {
  refundFakeIdCounter += 1;
  return `${prefix}-${refundFakeIdCounter}`;
}

/** Wraps `FakePaymentRepository.sumProcessedRefunds` (a hardcoded `0` in
 *  the shared fake — payments/fakes.ts has no reason to know about
 *  Refunds) so this module's own tests can exercise real cumulative-
 *  refund tracking against a `FakeRefundRepository`. */
export class FakePaymentRepositoryWithRefunds extends FakePaymentRepository {
  constructor(private readonly refunds: FakeRefundRepository) {
    super();
  }

  override async sumProcessedRefunds(paymentId: string): Promise<number> {
    return [...this.refunds.byId.values()]
      .filter((r) => r.paymentId === paymentId && r.status === "PROCESSED")
      .reduce((sum, r) => sum + r.amount, 0);
  }
}

export class FakeRefundRepository implements RefundRepository {
  byId = new Map<string, RefundRecord>();

  async findById(id: string): Promise<RefundRecord | null> {
    return this.byId.get(id) ?? null;
  }

  async findByFinancialAdjustmentId(financialAdjustmentId: string): Promise<RefundRecord | null> {
    return [...this.byId.values()].find((r) => r.financialAdjustmentId === financialAdjustmentId) ?? null;
  }

  async findByStripeRefundId(stripeRefundId: string): Promise<RefundRecord | null> {
    return [...this.byId.values()].find((r) => r.stripeRefundId === stripeRefundId) ?? null;
  }

  async createPending(data: CreatePendingRefundData): Promise<RefundRecord> {
    // Module 87 — synchronous scan over `this.byId` (no
    // `await this.findByFinancialAdjustmentId(...)` in between check and
    // write), matching `FakeCommissionRepository.create`'s documented
    // rationale (`tests/integration/financial/fakes.ts`): a concurrency
    // test racing two `createPending()` calls for the same
    // `financialAdjustmentId` must actually be able to observe a
    // duplicate if production's lock/unique-constraint protection were
    // ever removed, not be masked by an `await`-introduced TOCTOU gap in
    // the fake itself.
    const existing = [...this.byId.values()].find((r) => r.financialAdjustmentId === data.financialAdjustmentId);
    if (existing) return existing;

    const now = new Date();
    const record: RefundRecord = {
      id: refundFakeNextId("refund"),
      paymentId: data.paymentId,
      requestedByUserId: data.requestedByUserId,
      amount: data.amount,
      status: "REQUESTED",
      stripeRefundId: null,
      processedAt: null,
      notes: data.notes,
      financialAdjustmentId: data.financialAdjustmentId,
      idempotencyKey: data.idempotencyKey,
      failureReason: null,
      attemptCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.byId.set(record.id, record);
    return record;
  }

  async markProcessed(input: MarkRefundProcessedInput): Promise<UpdateRefundResult> {
    const existing = this.byId.get(input.id);
    if (!existing) throw new Error(`No fake refund with id "${input.id}".`);
    if (!input.fromStatuses.includes(existing.status)) return { applied: false, record: existing };
    const updated: RefundRecord = {
      ...existing,
      status: "PROCESSED",
      stripeRefundId: input.stripeRefundId,
      processedAt: new Date(),
      failureReason: null,
      updatedAt: new Date(),
    };
    this.byId.set(input.id, updated);
    return { applied: true, record: updated };
  }

  async markFailed(input: MarkRefundFailedInput): Promise<UpdateRefundResult> {
    const existing = this.byId.get(input.id);
    if (!existing) throw new Error(`No fake refund with id "${input.id}".`);
    if (!input.fromStatuses.includes(existing.status)) return { applied: false, record: existing };
    const updated: RefundRecord = {
      ...existing,
      status: "FAILED",
      failureReason: input.failureReason,
      attemptCount: existing.attemptCount + 1,
      updatedAt: new Date(),
    };
    this.byId.set(input.id, updated);
    return { applied: true, record: updated };
  }

  async listForPayment(paymentId: string): Promise<RefundRecord[]> {
    return [...this.byId.values()].filter((r) => r.paymentId === paymentId);
  }
}

/** Only the surface `ReverseProfessionalPayoutUseCase`/`ExecuteRefundUseCase`
 *  actually reach (`execute`, keyed by the same idempotency key
 *  `CreateFinancialAdjustmentUseCase` derives) is meaningfully implemented. */
export class FakeFinancialAdjustmentRepository implements FinancialAdjustmentRepository {
  byId = new Map<string, FinancialAdjustmentRecord>();
  byIdempotencyKey = new Map<string, string>();

  async findByIdempotencyKey(idempotencyKey: string): Promise<FinancialAdjustmentRecord | null> {
    const id = this.byIdempotencyKey.get(idempotencyKey);
    return id ? (this.byId.get(id) ?? null) : null;
  }
  async findById(id: string): Promise<FinancialAdjustmentRecord | null> {
    return this.byId.get(id) ?? null;
  }
  async create(data: CreateFinancialAdjustmentData): Promise<FinancialAdjustmentRecord> {
    const existing = await this.findByIdempotencyKey(data.idempotencyKey);
    if (existing) return existing;
    const record: FinancialAdjustmentRecord = {
      id: refundFakeNextId("adjustment"),
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
    this.byId.set(record.id, record);
    this.byIdempotencyKey.set(data.idempotencyKey, record.id);
    return record;
  }
  async markApplied(id: string, transactionId: string): Promise<FinancialAdjustmentRecord> {
    const existing = this.byId.get(id);
    if (!existing) throw new Error("not found");
    const updated: FinancialAdjustmentRecord = { ...existing, status: "APPLIED", transactionId, appliedAt: new Date() };
    this.byId.set(id, updated);
    return updated;
  }
  async markFailed(id: string): Promise<FinancialAdjustmentRecord> {
    const existing = this.byId.get(id);
    if (!existing) throw new Error("not found");
    const updated: FinancialAdjustmentRecord = { ...existing, status: "FAILED" };
    this.byId.set(id, updated);
    return updated;
  }
  async listForJob(jobId: string): Promise<FinancialAdjustmentRecord[]> {
    return [...this.byId.values()].filter((a) => a.jobId === jobId);
  }
  async sumAppliedAmountForPayment(paymentId: string, types: readonly FinancialAdjustmentTypeValue[]): Promise<number> {
    return [...this.byId.values()]
      .filter((a) => a.paymentId === paymentId && a.status === "APPLIED" && types.includes(a.type))
      .reduce((sum, a) => sum + a.amount, 0);
  }
}

export class FakeFinancialLedgerRepository implements FinancialLedgerRepository {
  byIdempotencyKey = new Map<string, FinancialTransactionRecord>();
  /** All entries ever created, in insertion order — backs `listForPayment`
   *  below, same "track everything, filter in memory" pattern
   *  `tests/integration/financial/fakes.ts`'s own `FakeFinancialLedgerRepository`
   *  already establishes for this same interface. */
  entries: FinancialTransactionRecord[] = [];

  async findByIdempotencyKey(idempotencyKey: string): Promise<FinancialTransactionRecord | null> {
    return this.byIdempotencyKey.get(idempotencyKey) ?? null;
  }
  async create(data: CreateLedgerEntryData): Promise<FinancialTransactionRecord> {
    const existing = this.byIdempotencyKey.get(data.idempotencyKey);
    if (existing) return existing;
    const record: FinancialTransactionRecord = {
      id: refundFakeNextId("transaction"),
      type: data.type,
      status: data.status ?? "COMPLETED",
      amount: data.amount,
      currency: data.currency ?? "EUR",
      description: data.description ?? null,
      paymentId: data.paymentId ?? null,
      payoutId: data.payoutId ?? null,
      refundId: data.refundId ?? null,
      commissionId: data.commissionId ?? null,
      idempotencyKey: data.idempotencyKey,
      createdAt: new Date(),
    };
    this.byIdempotencyKey.set(data.idempotencyKey, record);
    this.entries.push(record);
    return record;
  }
  async listForPayment(paymentId: string): Promise<FinancialTransactionRecord[]> {
    return this.entries.filter((e) => e.paymentId === paymentId);
  }
}

export class FakeJobRepository implements JobRepository {
  byId = new Map<string, JobRecord>();

  seed(record: JobRecord): void {
    this.byId.set(record.id, record);
  }
  async findById(id: string): Promise<JobRecord | null> {
    return this.byId.get(id) ?? null;
  }
  listForCustomer(_a: string, _b: ListJobsOptions): Promise<never> {
    throw new Error("not implemented in this fake");
  }
  listForProfessional(_a: string, _b: ListJobsOptions): Promise<never> {
    throw new Error("not implemented in this fake");
  }
  startWork(_a: StartJobData): Promise<JobRecord> {
    throw new Error("not implemented in this fake");
  }
  complete(_a: CompleteJobData): Promise<JobRecord> {
    throw new Error("not implemented in this fake");
  }
  cancel(_a: CancelJobData): Promise<JobRecord> {
    throw new Error("not implemented in this fake");
  }
}

export function fakeJobRecord(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: "job-1",
    serviceRequestId: "request-1",
    quoteId: "quote-1",
    customerId: "customer-1",
    professionalProfileId: "pro-1",
    companyProfileId: null,
    status: "COMPLETED",
    startedAt: null,
    startedByUserId: null,
    completedAt: null,
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
