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
} from "@/domain/repositories/financial-adjustment-repository";
import type {
  CreateLedgerEntryData,
  FinancialLedgerRepository,
  FinancialTransactionRecord,
} from "@/domain/repositories/financial-ledger-repository";
import type { PaymentRecord, PaymentRepository, PaymentStatusValue } from "@/domain/repositories/payment-repository";
import { DEFAULT_COMMISSION_RATES, type CommissionRates } from "@/domain/services/commission-policy";

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
  refundsByPayment = new Map<string, number>();

  seed(payment: PaymentRecord) {
    this.payments.set(payment.id, payment);
    return payment;
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
}

export class FakeCommissionRepository implements CommissionRepository {
  commissions = new Map<string, CommissionRecord>();

  async findByPaymentId(paymentId: string): Promise<CommissionRecord | null> {
    return [...this.commissions.values()].find((c) => c.paymentId === paymentId) ?? null;
  }

  async create(data: CreateCommissionData): Promise<CommissionRecord> {
    const existing = await this.findByPaymentId(data.paymentId);
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
    if (await this.findByIdempotencyKey(data.idempotencyKey)) {
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
}

export type { PaymentStatusValue };
