import { NotFoundError } from "@/domain/errors/domain-error";
import { netPayableAmount } from "@/domain/services/partner-payout-rules";
import { roundToCents } from "@/domain/services/money";
import type { AffiliateCommissionRepository } from "@/domain/repositories/affiliate-commission-repository";
import type { PartnerRepository } from "@/domain/repositories/partner-repository";

/**
 * Module 100 — Affiliate Accumulated Balance & €50 Payout.
 *
 * This use case does NOT calculate affiliate earnings — that remains
 * exactly Module 61/96's `AffiliateCommission` lifecycle
 * (PENDING -> APPROVED -> PAID, or CANCELLED/EXPIRED/REVERSED), computed
 * and persisted entirely upstream (`RecordAffiliateCommissionUseCase`,
 * `ApproveAffiliateCommissionUseCase`, the reversal subscribers). This
 * use case only answers "how much of what has already been earned is
 * currently accumulated and available for payout right now" — the
 * accumulation/eligibility layer the module spec calls for, built
 * entirely on top of the existing, unmodified upstream ledger.
 *
 * Distinguishes four buckets, matching the module spec's "earned /
 * available / reserved / paid" vocabulary onto this codebase's own
 * existing `AffiliateCommissionStatusValue`:
 *  - `pendingTotal` — still PENDING (not yet approved for payout at all).
 *  - `availableBalance` — APPROVED, not yet claimed by any in-flight
 *    payout (`payoutId IS NULL`, `costFinalizationFailedAt IS NULL` —
 *    exactly `AffiliateCommissionRepository.listApprovedForPartner`'s own
 *    selection, the SAME set `CreatePartnerPayoutUseCase`/
 *    `selectPayoutBatch` draw a payout batch from), net of any partial
 *    reversal already applied (`netPayableAmount` — see that function's
 *    own doc comment on why gross `affiliateAmount` alone is unsafe).
 *    This is the only figure a payout request is ever gated on.
 *  - `reservedForPayout` — APPROVED and already claimed by a
 *    PENDING/PROCESSING payout (still net of any reversal) — money the
 *    affiliate has earned and will be paid, but that a second payout
 *    request must never be able to double-spend. Computed as
 *    `(net total of every APPROVED commission) - availableBalance` so it
 *    is always internally consistent with `availableBalance` by
 *    construction, never a second independently-computed figure that
 *    could drift from it.
 *  - `paidTotal` — lifetime total already paid out (informational only).
 *
 * `minimumPayoutThreshold`/`isEligibleForPayout`/`amountUntilEligible`
 * are derived server-side from this partner's own
 * `Partner.minimumPayoutThreshold` (defaults to Module 61's
 * `DEFAULT_MINIMUM_PAYOUT_THRESHOLD` = €50 for a partner with no
 * negotiated override) — never a client-supplied or hard-coded constant
 * duplicated here, so a future per-partner threshold change is picked up
 * automatically with no change to this use case.
 */
export interface AffiliateBalanceSummary {
  partnerId: string;
  pendingTotal: number;
  availableBalance: number;
  reservedForPayout: number;
  paidTotal: number;
  minimumPayoutThreshold: number;
  isEligibleForPayout: boolean;
  /** `0` once eligible — how much more the affiliate needs to earn before
   *  they can request a payout. */
  amountUntilEligible: number;
}

export class GetAffiliateBalanceUseCase {
  constructor(
    private readonly partners: PartnerRepository,
    private readonly affiliateCommissions: AffiliateCommissionRepository,
  ) {}

  /** `partnerId` must already be resolved server-side from the
   *  authenticated caller's own session (e.g. via
   *  `GetPartnerByUserIdUseCase`) — this use case trusts whatever id it
   *  is given, exactly like every other partnerId-scoped use case in this
   *  module, so IDOR protection lives entirely in the caller (Server
   *  Action / route handler), never duplicated here. */
  async execute(partnerId: string): Promise<AffiliateBalanceSummary> {
    const partner = await this.partners.findById(partnerId);
    if (!partner) {
      throw new NotFoundError("Partner", partnerId);
    }

    const [totals, unclaimedApproved, allApproved] = await Promise.all([
      this.affiliateCommissions.totalsForPartner(partnerId),
      this.affiliateCommissions.listApprovedForPartner(partnerId),
      this.affiliateCommissions.listForPartner(partnerId, { status: "APPROVED" }),
    ]);

    const availableBalance = roundToCents(unclaimedApproved.reduce((sum, c) => sum + netPayableAmount(c), 0));
    const totalApprovedNet = roundToCents(allApproved.reduce((sum, c) => sum + netPayableAmount(c), 0));
    const reservedForPayout = Math.max(0, roundToCents(totalApprovedNet - availableBalance));

    const threshold = partner.minimumPayoutThreshold;
    const isEligibleForPayout = availableBalance >= roundToCents(threshold) && availableBalance > 0;
    const amountUntilEligible = isEligibleForPayout ? 0 : Math.max(0, roundToCents(threshold - availableBalance));

    return {
      partnerId,
      pendingTotal: totals.pendingTotal,
      availableBalance,
      reservedForPayout,
      paidTotal: totals.paidTotal,
      minimumPayoutThreshold: threshold,
      isEligibleForPayout,
      amountUntilEligible,
    };
  }
}
