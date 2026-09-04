/**
 * Module 96 Financial Fix Pass — ReconcileAffiliateCommissionStripeFeeUseCase
 * at the fake-repository tier (orchestration/business-logic coverage —
 * genuine DB-level concurrency/uniqueness is covered separately by
 * tests/integration-db/affiliate/stripe-fee-reconciliation.test.ts against
 * real PostgreSQL).
 */
import { describe, expect, it } from "vitest";

import { ReconcileAffiliateCommissionStripeFeeUseCase } from "@/application/use-cases/affiliate/reconcile-affiliate-commission-stripe-fee.use-case";
import type { CommissionRecord, CommissionRepository } from "@/domain/repositories/commission-repository";
import type { CreateLedgerEntryData, FinancialLedgerRepository, FinancialTransactionRecord } from "@/domain/repositories/financial-ledger-repository";

import { FakeAffiliateCommissionRepository, FakeAffiliateCommissionReversalRepository } from "./fakes";

class FakeCommissionRepositoryForReconciliation implements CommissionRepository {
  byId = new Map<string, CommissionRecord>();

  register(id: string, paymentId: string) {
    this.byId.set(id, {
      id,
      paymentId,
      professionalProfileId: null,
      companyProfileId: null,
      rateBps: 1000,
      amount: 100,
      status: "PENDING",
      settledAt: null,
      createdAt: new Date(),
    });
  }

  async findById(id: string): Promise<CommissionRecord | null> {
    return this.byId.get(id) ?? null;
  }
  async findByPaymentId(paymentId: string): Promise<CommissionRecord | null> {
    return [...this.byId.values()].find((c) => c.paymentId === paymentId) ?? null;
  }
  async create(): Promise<CommissionRecord> {
    throw new Error("not used in this test");
  }
  async listForProfessional(): Promise<CommissionRecord[]> {
    return [];
  }
  async listForCompany(): Promise<CommissionRecord[]> {
    return [];
  }
}

class FakeFinancialLedgerRepositoryForReconciliation implements FinancialLedgerRepository {
  entries: FinancialTransactionRecord[] = [];
  private counter = 0;

  async create(data: CreateLedgerEntryData): Promise<FinancialTransactionRecord> {
    this.counter += 1;
    const record: FinancialTransactionRecord = {
      id: `fake-fee-tx-${this.counter}`,
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

function makeContext() {
  const affiliateCommissions = new FakeAffiliateCommissionRepository();
  const reversals = new FakeAffiliateCommissionReversalRepository();
  affiliateCommissions.linkReversals(reversals);
  const ledger = new FakeFinancialLedgerRepositoryForReconciliation();
  const commissions = new FakeCommissionRepositoryForReconciliation();
  const useCase = new ReconcileAffiliateCommissionStripeFeeUseCase(affiliateCommissions, reversals, ledger, commissions);
  return { affiliateCommissions, reversals, ledger, commissions, useCase };
}

describe("Module 96 Financial Fix Pass — ReconcileAffiliateCommissionStripeFeeUseCase", () => {
  it("fee arrives after commission creation — reduces the payable balance via a reversal, snapshot fields untouched", async () => {
    const ctx = makeContext();
    ctx.commissions.register("commission-1", "payment-1");
    const commission = await ctx.affiliateCommissions.create({
      partnerId: "partner-1",
      referralCode: "code1",
      conversionEventId: "conv-1",
      platformCommissionRefId: "commission-1",
      platformCommissionAmount: 100,
      attributableCostAmount: 0,
      profitBaseAmount: 100,
      affiliateRateBps: 1000,
      affiliateAmount: 10,
      expiresAt: new Date(Date.now() + 1000),
    });
    await ctx.affiliateCommissions.updateStatus(commission.id, { status: "APPROVED" });
    await ctx.ledger.create({ type: "STRIPE_FEE", amount: -15, paymentId: "payment-1", idempotencyKey: "stripe-fee:payment-1" });

    const result = await ctx.useCase.execute({ platformCommissionRefId: "commission-1" });

    expect(result?.reversedAmount).toBe(1.5);
    expect(result?.affiliateAmount).toBe(10);
    expect(result?.profitBaseAmount).toBe(100);
    expect(result?.attributableCostAmount).toBe(0); // immutable snapshot, per this use case's own doc comment
    expect(result?.status).toBe("APPROVED");
    expect(ctx.reversals.reversals.size).toBe(1);
  });

  it("no fee yet — no-op, safe to call repeatedly", async () => {
    const ctx = makeContext();
    ctx.commissions.register("commission-2", "payment-2");
    await ctx.affiliateCommissions.create({
      partnerId: "partner-1",
      referralCode: "code2",
      conversionEventId: "conv-2",
      platformCommissionRefId: "commission-2",
      platformCommissionAmount: 100,
      attributableCostAmount: 0,
      profitBaseAmount: 100,
      affiliateRateBps: 1000,
      affiliateAmount: 10,
      expiresAt: new Date(Date.now() + 1000),
    });

    const first = await ctx.useCase.execute({ platformCommissionRefId: "commission-2" });
    const second = await ctx.useCase.execute({ platformCommissionRefId: "commission-2" });

    expect(first?.reversedAmount).toBe(0);
    expect(second?.reversedAmount).toBe(0);
    expect(ctx.reversals.reversals.size).toBe(0);
  });

  it("fee already known at creation time (attributableCostAmount > 0) — short-circuits, never touched", async () => {
    const ctx = makeContext();
    ctx.commissions.register("commission-3", "payment-3");
    await ctx.affiliateCommissions.create({
      partnerId: "partner-1",
      referralCode: "code3",
      conversionEventId: "conv-3",
      platformCommissionRefId: "commission-3",
      platformCommissionAmount: 100,
      attributableCostAmount: 15, // fee already known
      profitBaseAmount: 85,
      affiliateRateBps: 1000,
      affiliateAmount: 8.5,
      expiresAt: new Date(Date.now() + 1000),
    });
    // Even if a fee ledger row somehow also exists, this must be a no-op.
    await ctx.ledger.create({ type: "STRIPE_FEE", amount: -15, paymentId: "payment-3", idempotencyKey: "stripe-fee:payment-3" });

    const result = await ctx.useCase.execute({ platformCommissionRefId: "commission-3" });
    expect(result?.reversedAmount).toBe(0);
    expect(ctx.reversals.reversals.size).toBe(0);
  });

  it("duplicate fee-arrival events (two separate ledger writes are impossible here, but two reconcile calls are) never double-reverse", async () => {
    const ctx = makeContext();
    ctx.commissions.register("commission-4", "payment-4");
    await ctx.affiliateCommissions.create({
      partnerId: "partner-1",
      referralCode: "code4",
      conversionEventId: "conv-4",
      platformCommissionRefId: "commission-4",
      platformCommissionAmount: 100,
      attributableCostAmount: 0,
      profitBaseAmount: 100,
      affiliateRateBps: 1000,
      affiliateAmount: 10,
      expiresAt: new Date(Date.now() + 1000),
    });
    await ctx.ledger.create({ type: "STRIPE_FEE", amount: -15, paymentId: "payment-4", idempotencyKey: "stripe-fee:payment-4" });

    await ctx.useCase.execute({ platformCommissionRefId: "commission-4" });
    const second = await ctx.useCase.execute({ platformCommissionRefId: "commission-4" });

    expect(second?.reversedAmount).toBe(1.5);
    expect(ctx.reversals.reversals.size).toBe(1);
  });

  it("an already-PAID commission stays PAID after a late fee correction — the reversal is recorded, never a silent unpaid rewrite", async () => {
    const ctx = makeContext();
    ctx.commissions.register("commission-5", "payment-5");
    const commission = await ctx.affiliateCommissions.create({
      partnerId: "partner-1",
      referralCode: "code5",
      conversionEventId: "conv-5",
      platformCommissionRefId: "commission-5",
      platformCommissionAmount: 100,
      attributableCostAmount: 0,
      profitBaseAmount: 100,
      affiliateRateBps: 1000,
      affiliateAmount: 10,
      expiresAt: new Date(Date.now() + 1000),
    });
    await ctx.affiliateCommissions.updateStatus(commission.id, { status: "PAID", paidAt: new Date() });
    await ctx.ledger.create({ type: "STRIPE_FEE", amount: -15, paymentId: "payment-5", idempotencyKey: "stripe-fee:payment-5" });

    const result = await ctx.useCase.execute({ platformCommissionRefId: "commission-5" });
    expect(result?.status).toBe("PAID");
    expect(result?.reversedAmount).toBe(1.5);
  });

  it("no AffiliateCommission exists for this payment — returns null, never throws", async () => {
    const ctx = makeContext();
    ctx.commissions.register("commission-none", "payment-none");
    const result = await ctx.useCase.execute({ platformCommissionRefId: "commission-none" });
    expect(result).toBeNull();
  });

  it("a CANCELLED commission is never reconciled", async () => {
    const ctx = makeContext();
    ctx.commissions.register("commission-6", "payment-6");
    const commission = await ctx.affiliateCommissions.create({
      partnerId: "partner-1",
      referralCode: "code6",
      conversionEventId: "conv-6",
      platformCommissionRefId: "commission-6",
      platformCommissionAmount: 100,
      attributableCostAmount: 0,
      profitBaseAmount: 100,
      affiliateRateBps: 1000,
      affiliateAmount: 10,
      expiresAt: new Date(Date.now() + 1000),
    });
    await ctx.affiliateCommissions.updateStatus(commission.id, { status: "CANCELLED", cancelledAt: new Date(), cancelReason: "test" });
    await ctx.ledger.create({ type: "STRIPE_FEE", amount: -15, paymentId: "payment-6", idempotencyKey: "stripe-fee:payment-6" });

    const result = await ctx.useCase.execute({ platformCommissionRefId: "commission-6" });
    expect(result?.reversedAmount).toBe(0);
    expect(ctx.reversals.reversals.size).toBe(0);
  });
});
