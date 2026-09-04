/**
 * Module 96 Financial Integrity Hardening Pass — Risk 1: proves the
 * reversal-concurrency fix (`AffiliateCommissionRepository.
 * applyReversalAtomically`) against real PostgreSQL — the exact scenario
 * named in the task: a refund reversal and a Stripe-fee correction
 * hitting the SAME commission at the same time must never lose either
 * update; the final `reversedAmount` must equal the sum of both
 * append-only reversal rows, regardless of which transaction's row lock
 * wins the race.
 *
 * STATUS AT AUTHORING TIME: written against the real Module 91 harness,
 * NOT executed — no reachable Postgres in this sandbox (same confirmed
 * absence as every other tests/integration-db suite in this module —
 * see stripe-fee-reconciliation.test.ts's own doc comment). PENDING
 * execution.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/infrastructure/database/prisma/client";
import { PrismaAffiliateCommissionRepository } from "@/infrastructure/database/prisma/repositories/prisma-affiliate-commission-repository";
import { PrismaAffiliateCommissionReversalRepository } from "@/infrastructure/database/prisma/repositories/prisma-affiliate-commission-reversal-repository";
import { PrismaFinancialLedgerRepository } from "@/infrastructure/database/prisma/repositories/prisma-financial-ledger-repository";
import { PrismaCommissionRepository } from "@/infrastructure/database/prisma/repositories/prisma-commission-repository";
import { ReconcileAffiliateCommissionStripeFeeUseCase } from "@/application/use-cases/affiliate/reconcile-affiliate-commission-stripe-fee.use-case";
import { ReverseAffiliateCommissionUseCase } from "@/application/use-cases/affiliate/reverse-affiliate-commission.use-case";

import { setupDbTestLifecycle } from "../../test-utils/db/db-test-lifecycle";
import { createCapturedPayment, createFinancialGraph } from "../../test-utils/db/seed-helpers";
import { createApprovedPartner } from "./seed-helpers";

describe("Module 96 Financial Integrity Hardening Pass — reversal concurrency (real PostgreSQL)", () => {
  setupDbTestLifecycle();

  let paymentId: string;
  let platformCommissionRefId: string;
  let partnerId: string;

  beforeEach(async () => {
    const graph = await createFinancialGraph(prisma);
    const payment = await createCapturedPayment(prisma, graph, { amount: 1000 });
    paymentId = payment.id;

    const commissionRepo = new PrismaCommissionRepository();
    const platformCommission = await commissionRepo.create({
      paymentId,
      professionalProfileId: graph.professionalProfileId,
      companyProfileId: null,
      rateBps: 1000,
      amount: 100,
    });
    platformCommissionRefId = platformCommission.id;

    const partner = await createApprovedPartner(prisma);
    partnerId = partner.id;
  });

  function makeReverseUseCase() {
    return new ReverseAffiliateCommissionUseCase(new PrismaAffiliateCommissionRepository(), new PrismaAffiliateCommissionReversalRepository());
  }

  function makeReconcileFeeUseCase() {
    return new ReconcileAffiliateCommissionStripeFeeUseCase(
      new PrismaAffiliateCommissionRepository(),
      new PrismaAffiliateCommissionReversalRepository(),
      new PrismaFinancialLedgerRepository(),
      new PrismaCommissionRepository(),
    );
  }

  async function writeStripeFee(amount: number) {
    const ledger = new PrismaFinancialLedgerRepository();
    return ledger.create({
      type: "STRIPE_FEE",
      status: "COMPLETED",
      amount: -amount,
      paymentId,
      description: "test Stripe fee",
      idempotencyKey: `stripe-fee:${paymentId}`,
    });
  }

  async function createCommission(referralCode: string) {
    const affiliateCommissions = new PrismaAffiliateCommissionRepository();
    const created = await affiliateCommissions.create({
      partnerId,
      referralCode,
      conversionEventId: crypto.randomUUID(),
      platformCommissionRefId,
      platformCommissionAmount: 100,
      attributableCostAmount: 0,
      profitBaseAmount: 100,
      affiliateRateBps: 1000,
      affiliateAmount: 10,
      expiresAt: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000),
    });
    return affiliateCommissions.updateStatus(created.id, { status: "APPROVED", approvedAt: new Date() });
  }

  it("REAL CONCURRENT refund reversal + Stripe-fee correction on the SAME commission: reversedAmount ends exactly at the sum of both, never a lost update", async () => {
    const commission = await createCommission("module96_concurrent_refund_fee");

    // The fee ledger row must exist before the fee-correction call can do
    // anything (it looks the row up itself) — writing it up front is not
    // a race condition of its own, only a precondition for the race this
    // test actually exercises (the two USE CASE calls below).
    await writeStripeFee(15);

    // A €50 partial refund on the €100 payment -> proportional reversal
    // = min(remaining, affiliateAmount * 50/100) = min(10, 5) = 5.
    // A €15 Stripe fee on a commission created with cost=0 -> correction
    // = 1.5 (see stripe-fee-reconciliation.test.ts's own worked example:
    // (100-15)*10% = 8.5, original 10 - 8.5 = 1.5).
    // Fired via Promise.all — genuinely concurrent, not sequential await.
    const [reverseResult, reconcileResult] = await Promise.all([
      makeReverseUseCase().execute({
        affiliateCommissionId: commission.id,
        financialAdjustmentId: `refund-adjustment:${commission.id}`,
        refundedAmount: 50,
        paymentAmount: 100,
        isFullRefund: false,
        reason: "Partial refund — concurrency test",
      }),
      makeReconcileFeeUseCase().execute({ platformCommissionRefId }),
    ]);

    expect(reverseResult).not.toBeNull();
    expect(reconcileResult).not.toBeNull();

    const reversals = await prisma.affiliateCommissionReversal.findMany({ where: { affiliateCommissionId: commission.id } });
    expect(reversals).toHaveLength(2);
    const totalFromLedger = reversals.reduce((sum: number, r: { amount: unknown }) => sum + Number(r.amount), 0);
    expect(totalFromLedger).toBeCloseTo(6.5, 2); // 5 (refund) + 1.5 (fee correction) — the required invariant

    const fresh = await new PrismaAffiliateCommissionRepository().findById(commission.id);
    // The hard invariant this test exists to prove: the STORED
    // reversedAmount must equal the SUM of every ledger row, regardless
    // of which of the two concurrent transactions' row lock won — never
    // whichever one happened to overwrite the other's read.
    expect(fresh?.reversedAmount).toBeCloseTo(totalFromLedger, 2);
    expect(fresh?.reversedAmount).toBeCloseTo(6.5, 2);
    // Original snapshot fields are immutable regardless of the race.
    expect(fresh?.affiliateAmount).toBe(10);
    expect(fresh?.profitBaseAmount).toBe(100);
    expect(fresh?.status).toBe("APPROVED"); // 6.5 < 10 — not fully reversed
  });

  it("duplicate refund webhook redelivery concurrent with a Stripe-fee correction: the refund is applied exactly once, the fee correction exactly once", async () => {
    const commission = await createCommission("module96_dup_refund_concurrent_fee");
    await writeStripeFee(15);

    const refundInput = {
      affiliateCommissionId: commission.id,
      financialAdjustmentId: `refund-adjustment:${commission.id}`,
      refundedAmount: 50,
      paymentAmount: 100,
      isFullRefund: false,
      reason: "Partial refund — duplicate-webhook concurrency test",
    };

    // Two redeliveries of the SAME refund financialAdjustmentId, racing
    // against the fee correction — three genuinely concurrent calls.
    await Promise.all([
      makeReverseUseCase().execute(refundInput),
      makeReverseUseCase().execute(refundInput),
      makeReconcileFeeUseCase().execute({ platformCommissionRefId }),
    ]);

    const reversals = await prisma.affiliateCommissionReversal.findMany({ where: { affiliateCommissionId: commission.id } });
    expect(reversals).toHaveLength(2); // one refund row + one fee-correction row — never a third

    const fresh = await new PrismaAffiliateCommissionRepository().findById(commission.id);
    expect(fresh?.reversedAmount).toBeCloseTo(6.5, 2); // unchanged by the duplicate — never double-applied
  });
});
