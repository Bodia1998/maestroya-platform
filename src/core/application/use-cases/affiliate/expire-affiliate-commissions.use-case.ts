import type { AffiliateCommissionRepository } from "@/domain/repositories/affiliate-commission-repository";

/**
 * Module 61 — Affiliate & Partner System: batch sweep — expires every
 * still-`PENDING` `AffiliateCommission` whose `expiresAt` has passed (see
 * `AFFILIATE_COMMISSION_EXPIRY_DAYS`). Intended to run on a schedule (the
 * same "future cron entry point, no scheduler wired up by this module"
 * convention `scripts/run-referral-report.ts` documents for Module 60's own
 * reporting — see docs/MODULE_61's "Remaining Limitations").
 *
 * Only ever touches `PENDING` rows — an `APPROVED` commission is presumed
 * reviewed and correct, so it is never silently expired out from under a
 * partner just because a payout hasn't happened yet; only unreviewed rows
 * time out.
 */
export class ExpireAffiliateCommissionsUseCase {
  constructor(private readonly affiliateCommissions: AffiliateCommissionRepository) {}

  async execute(asOf: Date = new Date()): Promise<number> {
    const expirable = await this.affiliateCommissions.listExpirable(asOf);
    for (const commission of expirable) {
      await this.affiliateCommissions.updateStatus(commission.id, { status: "EXPIRED", expiredAt: asOf });
    }
    return expirable.length;
  }
}
