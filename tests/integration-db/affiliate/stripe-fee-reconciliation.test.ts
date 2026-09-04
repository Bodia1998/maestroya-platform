/**
 * Module 96 Financial Fix Pass — Stripe fee-timing reconciliation, proven
 * against real PostgreSQL: fee known before commission creation (not this
 * suite — that's the pure-function/unit tier, see
 * affiliate-commission-policy.test.ts), fee arrives AFTER commission
 * creation, duplicate fee-arrival events, concurrent reconciliation calls
 * for the same commission, and an already-PAID commission receiving a
 * late correction. Exercises the REAL `financialAdjustmentId` unique
 * constraint on `affiliate_commission_reversals` — the actual DB-level
 * idempotency guarantee `ReconcileAffiliateCommissionStripeFeeUseCase`
 * relies on, not an assumption about the fake repositories' behavior.
 *
 * STATUS AT AUTHORING TIME: written against the real Module 91 harness,
 * NOT executed — no reachable Postgres in this sandbox (confirmed via
 * `npm run test:integration:db`'s own startup error). PENDING execution.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/infrastructure/database/prisma/client";
import { PrismaAffiliateCommissionRepository } from "@/infrastructure/database/prisma/repositories/prisma-affiliate-commission-repository";
import { PrismaAffiliateCommissionReversalRepository } from "@/infrastructure/database/prisma/repositories/prisma-affiliate-commission-reversal-repository";
import { PrismaFinancialLedgerRepository } from "@/infrastructure/database/prisma/repositories/prisma-financial-ledger-repository";
import { PrismaCommissionRepository } from "@/infrastructure/database/prisma/repositories/prisma-commission-repository";
import { ReconcileAffiliateCommissionStripeFeeUseCase } from "@/application/use-cases/affiliate/reconcile-affiliate-commission-stripe-fee.use-case";

import { setupDbTestLifecycle } from "../../test-utils/db/db-test-lifecycle";
import { createCapturedPayment, createFinancialGraph } from "../../test-utils/db/seed-helpers";
import { createApprovedPartner } from "./seed-helpers";

describe("Module 96 Financial Fix Pass — Stripe fee reconciliation (real PostgreSQL)", () => {
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

  function makeUseCase() {
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

  /** Creates a PENDING AffiliateCommission via the real repository (the
   *  only status `create` ever produces — see `CreateAffiliateCommissionData`'s
   *  own shape, which has no status field), then transitions it to the
   *  desired status via the real `updateStatus`, exactly the same two-step
   *  path production code follows (create PENDING -> admin approves ->
   *  APPROVED -> payout marks PAID). */
  async function createCommissionAtStatus(referralCode: string, status: "PENDING" | "APPROVED" | "PAID") {
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
    if (status === "PENDING") return created;
    if (status === "APPROVED") {
      return affiliateCommissions.updateStatus(created.id, { status: "APPROVED", approvedAt: new Date() });
    }
    await affiliateCommissions.updateStatus(created.id, { status: "APPROVED", approvedAt: new Date() });
    return affiliateCommissions.updateStatus(created.id, { status: "PAID", paidAt: new Date(), payoutId: null });
  }

  it("fee arrives AFTER commission creation — corrects the profit base via a new reversal row, never mutates the original snapshot", async () => {
    const commission = await createCommissionAtStatus("module96_fee_after", "APPROVED");

    await writeStripeFee(15);

    const result = await makeUseCase().execute({ platformCommissionRefId });
    expect(result?.reversedAmount).toBe(1.5); // (100-15)*10% = 8.5, original 10 - 8.5 = 1.5
    expect(result?.affiliateAmount).toBe(10); // immutable snapshot, never mutated
    expect(result?.profitBaseAmount).toBe(100); // immutable snapshot, never mutated
    expect(result?.status).toBe("APPROVED"); // not fully reversed — partial correction only

    const reversals = await prisma.affiliateCommissionReversal.findMany({ where: { affiliateCommissionId: commission.id } });
    expect(reversals).toHaveLength(1);
    expect(reversals[0]!.financialAdjustmentId).toBe(`stripe-fee-correction:${commission.id}`);
  });

  it("duplicate reconciliation calls for the same commission never double-correct (DB unique constraint on financialAdjustmentId)", async () => {
    const commission = await createCommissionAtStatus("module96_fee_dup", "APPROVED");

    await writeStripeFee(15);

    await makeUseCase().execute({ platformCommissionRefId });
    const second = await makeUseCase().execute({ platformCommissionRefId });
    expect(second?.reversedAmount).toBe(1.5); // unchanged by the second call

    const reversals = await prisma.affiliateCommissionReversal.findMany({ where: { affiliateCommissionId: commission.id } });
    expect(reversals).toHaveLength(1);
  });

  it("REAL CONCURRENT reconciliation calls (Promise.all) for the same commission produce exactly one reversal row", async () => {
    const commission = await createCommissionAtStatus("module96_fee_concurrent", "APPROVED");

    await writeStripeFee(15);

    await Promise.all(Array.from({ length: 6 }, () => makeUseCase().execute({ platformCommissionRefId })));

    const reversals = await prisma.affiliateCommissionReversal.findMany({ where: { affiliateCommissionId: commission.id } });
    expect(reversals).toHaveLength(1);

    const fresh = await new PrismaAffiliateCommissionRepository().findById(commission.id);
    expect(fresh?.reversedAmount).toBe(1.5);
  });

  it("fee still not captured yet — no-op, no reversal, commission unchanged (repeated no-op calls are safe)", async () => {
    const commission = await createCommissionAtStatus("module96_fee_missing", "APPROVED");

    const result = await makeUseCase().execute({ platformCommissionRefId });
    expect(result?.reversedAmount).toBe(0);

    const reversals = await prisma.affiliateCommissionReversal.findMany({ where: { affiliateCommissionId: commission.id } });
    expect(reversals).toHaveLength(0);
  });

  it("an already-PAID commission stays PAID after a late fee correction — the reversal is recorded, not a silent unpaid rewrite", async () => {
    const commission = await createCommissionAtStatus("module96_fee_paid", "PAID");

    await writeStripeFee(15);

    const result = await makeUseCase().execute({ platformCommissionRefId });
    expect(result?.status).toBe("PAID"); // stays PAID — money already left the platform
    expect(result?.reversedAmount).toBe(1.5); // the clawback IS recorded

    const reversals = await prisma.affiliateCommissionReversal.findMany({ where: { affiliateCommissionId: commission.id } });
    expect(reversals).toHaveLength(1);
  });
});
