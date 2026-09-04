import { describe, expect, it, vi } from "vitest";

import { RunReferralAffiliateMaintenanceSweepUseCase } from "@/application/use-cases/affiliate/run-referral-affiliate-maintenance-sweep.use-case";
import { InMemoryLockService } from "@/infrastructure/locking/in-memory-lock-service";
import type { ExpireAffiliateCommissionsUseCase } from "@/application/use-cases/affiliate/expire-affiliate-commissions.use-case";
import type { DetectPartnerFraudSignalsUseCase } from "@/application/use-cases/affiliate/detect-partner-fraud-signals.use-case";
import type { PartnerRecord, PartnerRepository } from "@/domain/repositories/partner-repository";
import type { FailureReporter } from "@/application/ports/failure-reporter";
import type { ReconcileAffiliateCommissionStripeFeeUseCase } from "@/application/use-cases/affiliate/reconcile-affiliate-commission-stripe-fee.use-case";
import type { AffiliateCommissionRecord, AffiliateCommissionRepository } from "@/domain/repositories/affiliate-commission-repository";
import type { ReconcileStuckPartnerPayoutUseCase } from "@/application/use-cases/affiliate/reconcile-stuck-partner-payout.use-case";
import type { PartnerPayoutRecord, PartnerPayoutRepository } from "@/domain/repositories/partner-payout-repository";
import type { FinalizeOverdueAffiliateCommissionFeesUseCase } from "@/application/use-cases/affiliate/finalize-overdue-affiliate-commission-fees.use-case";

/**
 * Module 96 — Referral & Affiliate Production Wiring: unit tests for the
 * scheduled maintenance sweep (commission expiry + fraud re-check).
 */
function fakePartner(id: string): PartnerRecord {
  return {
    id,
    userId: `user-${id}`,
    type: "TELEGRAM_CHANNEL",
    status: "APPROVED",
    displayName: `Partner ${id}`,
    contactEmail: `${id}@example.com`,
    payoutMethod: "MANUAL",
    payoutDetails: null,
    minimumPayoutThreshold: 50,
    notes: null,
    approvedAt: new Date(),
    approvedByUserId: "admin-1",
    rejectedAt: null,
    rejectedReason: null,
    suspendedAt: null,
    suspendedReason: null,
    bannedAt: null,
    bannedReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as PartnerRecord;
}

function fakePartners(records: PartnerRecord[]): PartnerRepository {
  return { list: vi.fn().mockResolvedValue(records) } as unknown as PartnerRepository;
}

function fakeExpire(count: number): ExpireAffiliateCommissionsUseCase {
  return { execute: vi.fn().mockResolvedValue(count) } as unknown as ExpireAffiliateCommissionsUseCase;
}

describe("RunReferralAffiliateMaintenanceSweepUseCase (Module 96)", () => {
  it("expires commissions and fraud-scans every APPROVED partner, reporting counts", async () => {
    const expire = fakeExpire(3);
    const detect = { execute: vi.fn().mockResolvedValueOnce([{ id: "flag-1" }]).mockResolvedValueOnce([]) } as unknown as DetectPartnerFraudSignalsUseCase;
    const partners = fakePartners([fakePartner("p1"), fakePartner("p2")]);
    const lock = new InMemoryLockService();

    const useCase = new RunReferralAffiliateMaintenanceSweepUseCase(expire, detect, partners, lock);
    const result = await useCase.execute(new Date());

    expect(result.outcome).toBe("completed");
    expect(result.expiredCommissions).toBe(3);
    expect(result.partnersScanned).toBe(2);
    expect(result.partnersFailed).toBe(0);
    expect(result.fraudFlagsRaised).toBe(1);
    expect(detect.execute).toHaveBeenCalledTimes(2);
  });

  it("isolates a single partner's fraud-check failure — the sweep still completes and scans the rest", async () => {
    const expire = fakeExpire(0);
    const detect = {
      execute: vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce([]),
    } as unknown as DetectPartnerFraudSignalsUseCase;
    const partners = fakePartners([fakePartner("p1"), fakePartner("p2")]);
    const lock = new InMemoryLockService();
    const report = vi.fn();
    const failureReporter: FailureReporter = { report };

    const useCase = new RunReferralAffiliateMaintenanceSweepUseCase(expire, detect, partners, lock, failureReporter);
    const result = await useCase.execute(new Date());

    expect(result.outcome).toBe("completed");
    expect(result.partnersScanned).toBe(2);
    expect(result.partnersFailed).toBe(1);
    expect(report).toHaveBeenCalledTimes(1);
  });

  it("a second concurrent invocation is skipped_locked, never doubles the expiry/fraud work", async () => {
    const expire = fakeExpire(1);
    let resolveDetect!: () => void;
    const detect = {
      execute: vi.fn().mockReturnValue(
        new Promise((resolve) => {
          resolveDetect = () => resolve([]);
        }),
      ),
    } as unknown as DetectPartnerFraudSignalsUseCase;
    const partners = fakePartners([fakePartner("p1")]);
    const lock = new InMemoryLockService();

    const useCase = new RunReferralAffiliateMaintenanceSweepUseCase(expire, detect, partners, lock);

    const first = useCase.execute(new Date());
    // Give the first call a tick to acquire the lock before the second starts.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = await useCase.execute(new Date());

    expect(second.outcome).toBe("skipped_locked");
    expect(second.expiredCommissions).toBe(0);

    resolveDetect();
    const firstResult = await first;
    expect(firstResult.outcome).toBe("completed");
  });

  it("never scans a partner beyond the bounded batch (cap holds even with more APPROVED partners than the batch size)", async () => {
    const expire = fakeExpire(0);
    const detect = { execute: vi.fn().mockResolvedValue([]) } as unknown as DetectPartnerFraudSignalsUseCase;
    const manyPartners = Array.from({ length: 600 }, (_, i) => fakePartner(`p${i}`));
    const partners = fakePartners(manyPartners);
    const lock = new InMemoryLockService();

    const useCase = new RunReferralAffiliateMaintenanceSweepUseCase(expire, detect, partners, lock);
    const result = await useCase.execute(new Date());

    expect(result.partnersScanned).toBe(500);
  });

  it("Module 96 Financial Fix Pass — runs the fee-reconciliation backstop over zero-cost commissions and reports the count examined", async () => {
    const expire = fakeExpire(0);
    const detect = { execute: vi.fn().mockResolvedValue([]) } as unknown as DetectPartnerFraudSignalsUseCase;
    const partners = fakePartners([]);
    const lock = new InMemoryLockService();
    const candidates = [{ id: "c1", platformCommissionRefId: "pc1" }, { id: "c2", platformCommissionRefId: "pc2" }] as AffiliateCommissionRecord[];
    const affiliateCommissions = {
      listPendingFeeReconciliation: vi.fn().mockResolvedValue(candidates),
    } as unknown as AffiliateCommissionRepository;
    const reconcile = { execute: vi.fn().mockResolvedValue(null) } as unknown as ReconcileAffiliateCommissionStripeFeeUseCase;

    const useCase = new RunReferralAffiliateMaintenanceSweepUseCase(expire, detect, partners, lock, undefined, reconcile, affiliateCommissions);
    const result = await useCase.execute(new Date());

    expect(result.feeReconciliationsExamined).toBe(2);
    expect(reconcile.execute).toHaveBeenCalledTimes(2);
    expect(reconcile.execute).toHaveBeenCalledWith({ platformCommissionRefId: "pc1" });
    expect(reconcile.execute).toHaveBeenCalledWith({ platformCommissionRefId: "pc2" });
  });

  it("Module 96 Financial Fix Pass — one commission's reconciliation failure is isolated, never aborts the rest of the backstop pass", async () => {
    const expire = fakeExpire(0);
    const detect = { execute: vi.fn().mockResolvedValue([]) } as unknown as DetectPartnerFraudSignalsUseCase;
    const partners = fakePartners([]);
    const lock = new InMemoryLockService();
    const candidates = [{ id: "c1", platformCommissionRefId: "pc1" }, { id: "c2", platformCommissionRefId: "pc2" }] as AffiliateCommissionRecord[];
    const affiliateCommissions = {
      listPendingFeeReconciliation: vi.fn().mockResolvedValue(candidates),
    } as unknown as AffiliateCommissionRepository;
    const reconcile = {
      execute: vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(null),
    } as unknown as ReconcileAffiliateCommissionStripeFeeUseCase;
    const report = vi.fn();
    const failureReporter: FailureReporter = { report };

    const useCase = new RunReferralAffiliateMaintenanceSweepUseCase(expire, detect, partners, lock, failureReporter, reconcile, affiliateCommissions);
    const result = await useCase.execute(new Date());

    expect(result.outcome).toBe("completed");
    expect(result.feeReconciliationsExamined).toBe(2);
    expect(report).toHaveBeenCalledTimes(1);
  });

  it("without the optional reconciliation dependencies (undefined — every pre-existing caller), the backstop is simply skipped", async () => {
    const expire = fakeExpire(0);
    const detect = { execute: vi.fn().mockResolvedValue([]) } as unknown as DetectPartnerFraudSignalsUseCase;
    const partners = fakePartners([]);
    const lock = new InMemoryLockService();

    const useCase = new RunReferralAffiliateMaintenanceSweepUseCase(expire, detect, partners, lock);
    const result = await useCase.execute(new Date());

    expect(result.feeReconciliationsExamined).toBe(0);
    expect(result.stuckPayoutsExamined).toBe(0);
    expect(result.feesFinalizedFailed).toBe(0);
  });

  it("Module 96 Financial Integrity Hardening Pass — Risk 2: runs the stuck-payout recovery backstop and reports the count examined", async () => {
    const expire = fakeExpire(0);
    const detect = { execute: vi.fn().mockResolvedValue([]) } as unknown as DetectPartnerFraudSignalsUseCase;
    const partners = fakePartners([]);
    const lock = new InMemoryLockService();
    const stuck = [{ id: "payout-1" }, { id: "payout-2" }] as PartnerPayoutRecord[];
    const payouts = { listStuckProcessing: vi.fn().mockResolvedValue(stuck) } as unknown as PartnerPayoutRepository;
    const reconcileStuckPayout = { execute: vi.fn().mockResolvedValue(undefined) } as unknown as ReconcileStuckPartnerPayoutUseCase;

    const useCase = new RunReferralAffiliateMaintenanceSweepUseCase(
      expire,
      detect,
      partners,
      lock,
      undefined,
      undefined,
      undefined,
      reconcileStuckPayout,
      payouts,
    );
    const result = await useCase.execute(new Date());

    expect(result.stuckPayoutsExamined).toBe(2);
    expect(reconcileStuckPayout.execute).toHaveBeenCalledTimes(2);
    expect(reconcileStuckPayout.execute).toHaveBeenCalledWith(stuck[0]);
    expect(reconcileStuckPayout.execute).toHaveBeenCalledWith(stuck[1]);
  });

  it("Module 96 Financial Integrity Hardening Pass — Risk 2: one payout's recovery failure is isolated, never aborts the rest of the sweep", async () => {
    const expire = fakeExpire(0);
    const detect = { execute: vi.fn().mockResolvedValue([]) } as unknown as DetectPartnerFraudSignalsUseCase;
    const partners = fakePartners([]);
    const lock = new InMemoryLockService();
    const stuck = [{ id: "payout-1" }, { id: "payout-2" }] as PartnerPayoutRecord[];
    const payouts = { listStuckProcessing: vi.fn().mockResolvedValue(stuck) } as unknown as PartnerPayoutRepository;
    const reconcileStuckPayout = {
      execute: vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(undefined),
    } as unknown as ReconcileStuckPartnerPayoutUseCase;
    const report = vi.fn();
    const failureReporter = { report } as unknown as FailureReporter;

    const useCase = new RunReferralAffiliateMaintenanceSweepUseCase(
      expire,
      detect,
      partners,
      lock,
      failureReporter,
      undefined,
      undefined,
      reconcileStuckPayout,
      payouts,
    );
    const result = await useCase.execute(new Date());

    expect(result.outcome).toBe("completed");
    expect(result.stuckPayoutsExamined).toBe(2);
    expect(report).toHaveBeenCalledTimes(1);
  });

  it("Module 96 Financial Integrity Hardening Pass — Risk 3: runs the fee-finalization backstop and reports the count flagged", async () => {
    const expire = fakeExpire(0);
    const detect = { execute: vi.fn().mockResolvedValue([]) } as unknown as DetectPartnerFraudSignalsUseCase;
    const partners = fakePartners([]);
    const lock = new InMemoryLockService();
    const flagged = [{ id: "c1" }, { id: "c2" }, { id: "c3" }] as AffiliateCommissionRecord[];
    const finalizeOverdueFees = { execute: vi.fn().mockResolvedValue(flagged) } as unknown as FinalizeOverdueAffiliateCommissionFeesUseCase;

    const useCase = new RunReferralAffiliateMaintenanceSweepUseCase(
      expire,
      detect,
      partners,
      lock,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      finalizeOverdueFees,
    );
    const result = await useCase.execute(new Date());

    expect(result.feesFinalizedFailed).toBe(3);
    expect(finalizeOverdueFees.execute).toHaveBeenCalledTimes(1);
  });

  it("Module 96 Financial Integrity Hardening Pass — Risk 3: a fee-finalization backstop failure is reported and does not abort the sweep", async () => {
    const expire = fakeExpire(0);
    const detect = { execute: vi.fn().mockResolvedValue([]) } as unknown as DetectPartnerFraudSignalsUseCase;
    const partners = fakePartners([]);
    const lock = new InMemoryLockService();
    const finalizeOverdueFees = { execute: vi.fn().mockRejectedValue(new Error("db down")) } as unknown as FinalizeOverdueAffiliateCommissionFeesUseCase;
    const report = vi.fn();
    const failureReporter = { report } as unknown as FailureReporter;

    const useCase = new RunReferralAffiliateMaintenanceSweepUseCase(
      expire,
      detect,
      partners,
      lock,
      failureReporter,
      undefined,
      undefined,
      undefined,
      undefined,
      finalizeOverdueFees,
    );
    const result = await useCase.execute(new Date());

    expect(result.outcome).toBe("completed");
    expect(result.feesFinalizedFailed).toBe(0);
    expect(report).toHaveBeenCalledTimes(1);
  });
});
