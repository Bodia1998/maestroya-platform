import type { DistributedLock } from "@/application/ports/distributed-lock";
import type { ExpireAffiliateCommissionsUseCase } from "@/application/use-cases/affiliate/expire-affiliate-commissions.use-case";
import type { DetectPartnerFraudSignalsUseCase } from "@/application/use-cases/affiliate/detect-partner-fraud-signals.use-case";
import type { ReconcileAffiliateCommissionStripeFeeUseCase } from "@/application/use-cases/affiliate/reconcile-affiliate-commission-stripe-fee.use-case";
import type { ReconcileStuckPartnerPayoutUseCase } from "@/application/use-cases/affiliate/reconcile-stuck-partner-payout.use-case";
import type { FinalizeOverdueAffiliateCommissionFeesUseCase } from "@/application/use-cases/affiliate/finalize-overdue-affiliate-commission-fees.use-case";
import type { AffiliateCommissionRepository } from "@/domain/repositories/affiliate-commission-repository";
import type { PartnerPayoutRepository } from "@/domain/repositories/partner-payout-repository";
import type { PartnerRepository } from "@/domain/repositories/partner-repository";
import { logger } from "@/infrastructure/observability/logger";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";

/** Bounds one sweep invocation's fraud-detection pass — this platform's
 *  `PartnerRepository.list` is itself documented as "expected to stay
 *  small for now" (see that interface's own doc comment), so a single
 *  generous cap rather than true pagination/cursoring is the
 *  proportionate choice here, unlike Module 92's Job-ledger cursor sweep
 *  (a genuinely large, unbounded table). Revisit with real pagination
 *  first if that assumption stops holding — see this class's own doc
 *  comment. */
const MAX_PARTNERS_PER_SWEEP = 500;

/** Module 96 Financial Integrity Hardening Pass — bounds the Risk 3
 *  fee-finalization backstop per sweep run, same reasoning as
 *  `MAX_FEE_RECONCILIATIONS_PER_SWEEP`. */
const MAX_FEE_FINALIZATIONS_PER_SWEEP = 200;

/** Module 96 Financial Fix Pass — bounds the fee-reconciliation backstop
 *  pass (see `ReconcileAffiliateCommissionStripeFeeUseCase`'s own doc
 *  comment on why this sweep re-attempting it daily is safe and cheap,
 *  not merely tolerated). A commission that never gets a STRIPE_FEE row
 *  simply keeps costing one no-op lookup per sweep, indefinitely — bounded
 *  per-run, not a memory/growth concern given `listPendingFeeReconciliation`
 *  is itself oldest-first and shrinks every time a fee genuinely arrives. */
const MAX_FEE_RECONCILIATIONS_PER_SWEEP = 200;

/** Module 96 Financial Integrity Hardening Pass — Risk 2 backstop bound:
 *  at most this many stuck-PROCESSING payouts are examined per sweep run
 *  — the set is expected to be tiny/zero on every healthy run (this only
 *  ever fires after a process crash mid-transfer), so a generous cap is
 *  proportionate, same reasoning as `MAX_FEE_RECONCILIATIONS_PER_SWEEP`. */
const MAX_STUCK_PAYOUTS_PER_SWEEP = 50;

/** Module 96 Financial Integrity Hardening Pass — a payout is only
 *  considered for crash recovery once it has sat in `PROCESSING` for at
 *  least this long, so a payout whose Stripe call is merely slow (still
 *  genuinely in flight) is never raced against by the sweep. 10 minutes
 *  is comfortably longer than any real `stripe.transfers.create` call is
 *  expected to take, while still well inside Stripe's own 24h
 *  idempotency-key retention window (see
 *  `ReconcileStuckPartnerPayoutUseCase`'s own doc comment on why that
 *  window bounds this recovery mechanism's correctness, and the OPEN
 *  RISK the once-daily cron cadence creates against it).*/
const STUCK_PAYOUT_THRESHOLD_MS = 10 * 60 * 1000;

/** Comfortably longer than MAX_PARTNERS_PER_SWEEP partner-fraud-checks
 *  plus the commission-expiry batch are expected to take — a safety net
 *  for a crashed holder, same reasoning as every other LOCK_TTL_MS in
 *  this codebase (see ExecuteProfessionalPayoutUseCase/
 *  RunScheduledReconciliationSweepUseCase's own constants). */
const LOCK_TTL_MS = 5 * 60 * 1000;

const LOCK_KEY = "referral-affiliate:maintenance-sweep";

export interface ReferralAffiliateMaintenanceSweepResult {
  outcome: "completed" | "skipped_locked";
  expiredCommissions: number;
  partnersScanned: number;
  partnersFailed: number;
  fraudFlagsRaised: number;
  /** Module 96 Financial Fix Pass — how many zero-cost commissions this
   *  run examined for a possibly-now-available Stripe fee. Most runs
   *  correct 0 of these (the webhook-triggered path already handles the
   *  overwhelming common case) — this count existing and being non-zero
   *  occasionally is expected, not a sign of trouble. */
  feeReconciliationsExamined: number;
  /** Module 96 Financial Integrity Hardening Pass — how many payouts
   *  stuck in PROCESSING past `STUCK_PAYOUT_THRESHOLD_MS` this run
   *  attempted to recover. Expected to be 0 on essentially every run —
   *  see `ReconcileStuckPartnerPayoutUseCase`'s own doc comment. */
  stuckPayoutsExamined: number;
  /** Module 96 Financial Integrity Hardening Pass — how many zero-cost
   *  commissions this run flagged `costFinalizationFailedAt` because
   *  their fee never arrived within the bounded window — see
   *  `FinalizeOverdueAffiliateCommissionFeesUseCase`'s own doc comment. */
  feesFinalizedFailed: number;
}

/**
 * Module 96 — Referral & Affiliate Production Wiring: the single
 * scheduled entry point for this module's two genuinely time-based
 * operations —
 *
 *   1. **Commission expiry** (`ExpireAffiliateCommissionsUseCase`) — a
 *      `PENDING` `AffiliateCommission` past its `expiresAt` is marked
 *      `EXPIRED`. Already idempotent (only ever touches rows still
 *      `PENDING` — see that use case's own doc comment), so a retried or
 *      overlapping sweep re-selects a shrinking, eventually-empty set,
 *      never double-expires anything.
 *   2. **Fraud sweep** (`DetectPartnerFraudSignalsUseCase`, run once per
 *      currently-`APPROVED` partner) — every rule in
 *      `affiliate-fraud-rules.ts` re-evaluated against that partner's
 *      current activity. Each rule's own finding is itself idempotent at
 *      the repository layer (a repeat finding does not duplicate an
 *      already-open `PartnerFraudFlag` row — unchanged, pre-existing
 *      behavior this sweep does not alter), so a retried sweep never
 *      creates duplicate flags either.
 *
 * Deliberately does **not** schedule payouts — `CreatePartnerPayoutUseCase`
 * is admin-triggered only (see MODULE_96's own report, "Payout
 * Lifecycle" — a deliberate scope choice, not an oversight), so no payout
 * call belongs in an unattended sweep.
 *
 * ## Locking / concurrency
 * The entire sweep runs inside `lock.withLock(...)` — the existing
 * `DistributedLock` (Module 44), the same primitive
 * `RunScheduledReconciliationSweepUseCase`/`ExecuteProfessionalPayoutUseCase`
 * already use; no second locking mechanism. A concurrent invocation that
 * cannot acquire the lock returns immediately with `outcome:
 * "skipped_locked"` (never blocks, never retries) — the expected,
 * harmless overlap between a scheduler retry and a slow-running prior
 * invocation, not an error.
 *
 * ## Failure isolation
 * One partner's fraud check throwing (a bad row, an unexpected repository
 * error) is caught and reported via `FailureReporter`, never allowed to
 * abort the whole sweep — the exact same "one batch's failure must not
 * prevent the others from completing" convention
 * `RunWorkflowExpirationsUseCase.runBatch` already establishes, applied
 * per-partner here since a fraud-check failure is much more granular than
 * a whole category batch.
 */
export class RunReferralAffiliateMaintenanceSweepUseCase {
  constructor(
    private readonly expireAffiliateCommissions: ExpireAffiliateCommissionsUseCase,
    private readonly detectPartnerFraudSignals: DetectPartnerFraudSignalsUseCase,
    private readonly partners: PartnerRepository,
    private readonly lock: DistributedLock,
    private readonly failureReporter: FailureReporter = new NullFailureReporter(),
    /** Module 96 Financial Fix Pass — optional, same "every pre-existing
     *  caller/test keeps compiling unchanged" convention used throughout
     *  this module: `null` here (the default) means the fee-
     *  reconciliation backstop pass is simply skipped, never a crash.
     *  Every real production composition (`affiliate/compose.ts`) always
     *  supplies both. */
    private readonly reconcileStripeFee: ReconcileAffiliateCommissionStripeFeeUseCase | null = null,
    private readonly affiliateCommissions: AffiliateCommissionRepository | null = null,
    /** Module 96 Financial Integrity Hardening Pass — optional, same
     *  "every pre-existing caller/test keeps compiling unchanged"
     *  convention: `null` (the default) skips the stuck-payout recovery
     *  backstop entirely, never a crash. Real production composition
     *  supplies all three. */
    private readonly reconcileStuckPayout: ReconcileStuckPartnerPayoutUseCase | null = null,
    private readonly payouts: PartnerPayoutRepository | null = null,
    /** Module 96 Financial Integrity Hardening Pass — optional, same
     *  "keeps every pre-existing caller/test compiling unchanged"
     *  convention. `null` skips the Risk 3 fee-finalization backstop. */
    private readonly finalizeOverdueFees: FinalizeOverdueAffiliateCommissionFeesUseCase | null = null,
  ) {}

  async execute(now: Date = new Date()): Promise<ReferralAffiliateMaintenanceSweepResult> {
    const result = await this.lock.withLock(LOCK_KEY, LOCK_TTL_MS, () => this.runLocked(now));

    if (result === null) {
      logger.info("referral_affiliate_maintenance_sweep_skipped_locked", {});
      return {
        outcome: "skipped_locked",
        expiredCommissions: 0,
        partnersScanned: 0,
        partnersFailed: 0,
        fraudFlagsRaised: 0,
        feeReconciliationsExamined: 0,
        stuckPayoutsExamined: 0,
        feesFinalizedFailed: 0,
      };
    }

    return result;
  }

  private async runLocked(now: Date): Promise<ReferralAffiliateMaintenanceSweepResult> {
    const startedAt = Date.now();

    const expiredCommissions = await this.expireAffiliateCommissions.execute(now);

    const approvedPartners = (await this.partners.list({ status: "APPROVED" })).slice(0, MAX_PARTNERS_PER_SWEEP);

    let partnersFailed = 0;
    let fraudFlagsRaised = 0;

    for (const partner of approvedPartners) {
      try {
        const flags = await this.detectPartnerFraudSignals.execute(partner.id);
        fraudFlagsRaised += flags.length;
      } catch (error) {
        partnersFailed += 1;
        this.failureReporter.report(error, { context: "RunReferralAffiliateMaintenanceSweepUseCase", partnerId: partner.id });
      }
    }

    const feeReconciliationsExamined = await this.runFeeReconciliationBackstop();
    const stuckPayoutsExamined = await this.runStuckPayoutRecoveryBackstop(now);
    const feesFinalizedFailed = await this.runFeeFinalizationBackstop(now);

    logger.info("referral_affiliate_maintenance_sweep_completed", {
      expiredCommissions,
      partnersScanned: approvedPartners.length,
      partnersFailed,
      fraudFlagsRaised,
      feeReconciliationsExamined,
      stuckPayoutsExamined,
      feesFinalizedFailed,
      durationMs: Date.now() - startedAt,
    });

    return {
      outcome: "completed",
      expiredCommissions,
      partnersScanned: approvedPartners.length,
      partnersFailed,
      fraudFlagsRaised,
      feeReconciliationsExamined,
      stuckPayoutsExamined,
      feesFinalizedFailed,
    };
  }

  /**
   * Module 96 Financial Fix Pass — the backstop half of Stripe fee-timing
   * reconciliation (see `ReconcileAffiliateCommissionStripeFeeUseCase`'s
   * own doc comment for the full design: this covers the narrow true-
   * race window the payments-webhook-triggered call can miss). One
   * partner's/commission's failure here is isolated exactly like the
   * fraud-check loop above — never allowed to abort the rest of the
   * sweep.
   */
  private async runFeeReconciliationBackstop(): Promise<number> {
    if (!this.reconcileStripeFee || !this.affiliateCommissions) {
      return 0;
    }

    const candidates = await this.affiliateCommissions.listPendingFeeReconciliation(MAX_FEE_RECONCILIATIONS_PER_SWEEP);

    for (const candidate of candidates) {
      try {
        await this.reconcileStripeFee.execute({ platformCommissionRefId: candidate.platformCommissionRefId });
      } catch (error) {
        this.failureReporter.report(error, {
          context: "RunReferralAffiliateMaintenanceSweepUseCase.feeReconciliation",
          affiliateCommissionId: candidate.id,
        });
      }
    }

    return candidates.length;
  }

  /**
   * Module 96 Financial Integrity Hardening Pass — Risk 2 backstop: see
   * `ReconcileStuckPartnerPayoutUseCase`'s own doc comment for the full
   * mechanism. Isolated per-payout failure handling, same convention as
   * the fee-reconciliation backstop above.
   */
  private async runStuckPayoutRecoveryBackstop(now: Date): Promise<number> {
    if (!this.reconcileStuckPayout || !this.payouts) {
      return 0;
    }

    const olderThan = new Date(now.getTime() - STUCK_PAYOUT_THRESHOLD_MS);
    const stuck = await this.payouts.listStuckProcessing(olderThan, MAX_STUCK_PAYOUTS_PER_SWEEP);

    for (const payout of stuck) {
      try {
        await this.reconcileStuckPayout.execute(payout);
      } catch (error) {
        this.failureReporter.report(error, {
          context: "RunReferralAffiliateMaintenanceSweepUseCase.stuckPayoutRecovery",
          payoutId: payout.id,
        });
      }
    }

    return stuck.length;
  }

  /**
   * Module 96 Financial Integrity Hardening Pass — Risk 3 backstop: see
   * `FinalizeOverdueAffiliateCommissionFeesUseCase`'s own doc comment.
   * Deliberately NOT wrapped per-item in its own try/catch — a batch
   * `listFeeFinalizationOverdue` + per-row `markCostFinalizationFailed`
   * failure here is rare enough (a DB error, not a business-logic
   * failure) that letting it propagate and fail this ONE backstop step
   * (already isolated at the sweep level by being its own top-level
   * `await`, same as every other backstop here) is acceptable; still
   * reported via the shared failure reporter rather than crashing the
   * whole sweep.
   */
  private async runFeeFinalizationBackstop(now: Date): Promise<number> {
    if (!this.finalizeOverdueFees) {
      return 0;
    }
    try {
      const flagged = await this.finalizeOverdueFees.execute(now, MAX_FEE_FINALIZATIONS_PER_SWEEP);
      return flagged.length;
    } catch (error) {
      this.failureReporter.report(error, { context: "RunReferralAffiliateMaintenanceSweepUseCase.feeFinalization" });
      return 0;
    }
  }
}
