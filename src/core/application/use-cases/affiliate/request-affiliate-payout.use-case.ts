import { NotFoundError } from "@/domain/errors/domain-error";
import type { PartnerPayoutRecord } from "@/domain/repositories/partner-payout-repository";
import type { PartnerRepository } from "@/domain/repositories/partner-repository";
import type { AffiliateCommissionRepository } from "@/domain/repositories/affiliate-commission-repository";
import type { CreatePartnerPayoutUseCase } from "@/application/use-cases/affiliate/create-partner-payout.use-case";

/**
 * Module 100 — Affiliate Accumulated Balance & €50 Payout: the
 * self-service counterpart to Module 61/96's admin-only
 * `CreatePartnerPayoutUseCase`.
 *
 * Deliberately a thin wrapper, not a second payout-execution path: every
 * actual accounting guarantee (the €50/partner-threshold check via
 * `selectPayoutBatch`, the atomic claim-then-pay transaction backed by
 * `partner_payouts`' partial unique index, the Stripe transfer, the
 * FAILED-releases-the-claim recovery behavior) lives in
 * `CreatePartnerPayoutUseCase` and is reused completely unchanged — see
 * that class's own doc comment for the full guarantee. This use case's
 * only job is the one thing self-service payout genuinely needs that the
 * admin flow doesn't: resolving `periodStart`/`periodEnd` automatically
 * instead of requiring the affiliate to pick a reporting period (a
 * partner-facing "request payout" button has no reason to expose that
 * concept — `periodStart`/`periodEnd` on `PartnerPayout` are descriptive
 * bookkeeping only; they play no role in which commissions get selected
 * — see `selectPayoutBatch`, which is driven entirely by commission
 * status/claim state, never by date range).
 *
 * ## Security — identity is never accepted as input
 * `partnerId` must already be resolved server-side from the authenticated
 * caller's own session (see `GetPartnerByUserIdUseCase`) before this use
 * case is ever called — exactly the same convention every partner-facing
 * Server Action in this module already follows
 * (`requireOwnPartnerId()` in `dashboard/partner/actions.ts`). There is
 * no separate "on behalf of" parameter anywhere on this use case's input,
 * so there is no code path through which affiliate A could ever trigger a
 * payout for affiliate B even by tampering with a hidden field.
 */
export class RequestAffiliatePayoutUseCase {
  constructor(
    private readonly partners: PartnerRepository,
    private readonly affiliateCommissions: AffiliateCommissionRepository,
    private readonly createPayout: CreatePartnerPayoutUseCase,
  ) {}

  async execute(input: { partnerId: string }): Promise<PartnerPayoutRecord> {
    const partner = await this.partners.findById(input.partnerId);
    if (!partner) {
      throw new NotFoundError("Partner", input.partnerId);
    }

    // periodEnd is always "now" — this payout settles every currently
    // unclaimed APPROVED commission, exactly as `CreatePartnerPayoutUseCase`
    // already does regardless of what period is passed in.
    const periodEnd = new Date();

    // periodStart is informational only (see class doc comment above), so
    // the earliest currently-unclaimed APPROVED commission's own
    // `createdAt` is a faithful, always-available choice — falling back to
    // the partner's own account creation date on the (should-be-impossible,
    // since `CreatePartnerPayoutUseCase` will itself reject an empty/
    // below-threshold batch) case of an empty batch.
    const unclaimedApproved = await this.affiliateCommissions.listApprovedForPartner(input.partnerId);
    const periodStart =
      unclaimedApproved.length > 0
        ? unclaimedApproved.reduce((earliest, c) => (c.createdAt < earliest ? c.createdAt : earliest), unclaimedApproved[0]!.createdAt)
        : partner.createdAt;

    return this.createPayout.execute({ partnerId: input.partnerId, periodStart, periodEnd });
  }
}
