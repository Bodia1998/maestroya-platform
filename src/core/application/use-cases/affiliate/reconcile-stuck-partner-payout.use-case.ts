import { StripeTransferError } from "@/domain/errors/domain-error";
import type { AffiliateCommissionRepository } from "@/domain/repositories/affiliate-commission-repository";
import type { PartnerPayoutRecord, PartnerPayoutRepository } from "@/domain/repositories/partner-payout-repository";
import type { PartnerRecord, PartnerRepository } from "@/domain/repositories/partner-repository";
import type { StripeTransferGateway } from "@/application/ports/stripe-transfer-gateway";
import { logger } from "@/infrastructure/observability/logger";

/**
 * Module 96 Financial Integrity Hardening Pass — Risk 2: recovers a
 * `PartnerPayout` stuck in `PROCESSING` because the process that ran
 * `CreatePartnerPayoutUseCase.executeStripeTransfer` crashed (or the
 * response was lost to a network failure) somewhere between the Stripe
 * transfer actually succeeding and this platform's own DB update that
 * marks the commissions PAID / the payout PAID. Without this, such a
 * payout stays `PROCESSING` forever — its commissions permanently
 * claimed (`payoutId` set) but never `PAID`, and never releasable for a
 * new payout attempt either (nothing else ever revisits a `PROCESSING`
 * row).
 *
 * ## The recovery mechanism — re-use the SAME idempotency key
 * This codebase's `StripeTransferGateway` port has no separate
 * "retrieve transfer by idempotency key" method (see that port's own
 * doc comment — deliberately narrow, one method for creation, one for
 * reversal). It does not need one: Stripe's OWN documented idempotency
 * contract for `POST /v1/transfers` is that a repeated request carrying
 * the identical `Idempotency-Key` header returns the ORIGINAL transfer
 * unchanged — no second transfer is ever created — for as long as
 * Stripe retains that key (24 hours by default, not configurable via
 * this API). `CreatePartnerPayoutUseCase.executeStripeTransfer` already
 * derives that key deterministically as `partner-payout:<payoutId>` —
 * this use case reconstructs the EXACT same `CreateTransferRequest`
 * (destination, amount, currency, idempotencyKey, metadata) from the
 * stuck payout's own already-persisted fields and calls
 * `transferGateway.createTransfer` again:
 *   - If the original transfer actually succeeded, Stripe returns that
 *     SAME `Transfer.id` — no new transfer, no double-pay — and this use
 *     case finishes the interrupted DB update (mark commissions + payout
 *     PAID) exactly as the original call would have.
 *   - If the original transfer never actually reached Stripe (crash
 *     before the API call, or Stripe itself never received/processed
 *     it), this call creates it now, for the first and only time, and
 *     the payout completes correctly, later than intended but correctly.
 *   - If Stripe now genuinely rejects the transfer (e.g. the
 *     destination account was deauthorized in the interim), the payout
 *     is released and marked FAILED, retryable, exactly like the
 *     original synchronous failure path.
 *
 * ## OPEN RISK — bounded by Stripe's own key retention
 * This recovery is only guaranteed correct while Stripe still holds the
 * original idempotency key (24h by default). A payout stuck in
 * `PROCESSING` for longer than that (crash + delayed sweep discovery)
 * risks a genuine double-transfer if the original silently succeeded
 * after the key expired. The maintenance sweep runs once daily (see
 * `vercel.json`), so a payout that gets stuck shortly after a given
 * day's sweep run will not be examined again until roughly 24h later —
 * uncomfortably close to that boundary. This is flagged explicitly in
 * the accompanying report as an OPEN RISK: production deployment should
 * either shorten the sweep cadence for this specific backstop or add
 * dedicated alerting on any `PROCESSING` payout older than a much
 * shorter threshold (e.g. 15 minutes) so a human can intervene well
 * inside Stripe's key-retention window, rather than relying on this
 * recovery pass alone for payouts that go stale for a full day.
 *
 * ## Idempotent / safe to re-run
 * `markPaidByPayoutId`/`releaseClaimedCommissions` are both no-ops
 * against a payout whose commissions are already in their target state,
 * and `updateStatus` transitions are themselves idempotent no-ops when
 * re-applied. Calling this use case twice for the same stuck payout (a
 * sweep re-running before the previous run's effects are even needed
 * again) is harmless.
 */
export class ReconcileStuckPartnerPayoutUseCase {
  constructor(
    private readonly partners: PartnerRepository,
    private readonly affiliateCommissions: AffiliateCommissionRepository,
    private readonly payouts: PartnerPayoutRepository,
    private readonly transferGateway: StripeTransferGateway,
  ) {}

  async execute(payout: PartnerPayoutRecord): Promise<void> {
    if (payout.status !== "PROCESSING") {
      // Already resolved by a concurrent sweep run / the original
      // in-flight call itself finishing — nothing to do.
      return;
    }

    const partner = await this.partners.findById(payout.partnerId);
    const stripeAccountId = partner ? this.resolveStripeAccountId(partner) : null;
    if (!partner || !stripeAccountId) {
      // Cannot even reconstruct the original request — this partner's
      // Stripe configuration changed out from under a still-PROCESSING
      // payout. Never guess; surface it as FAILED/retryable and let an
      // operator investigate, same as `CreatePartnerPayoutUseCase`'s own
      // "no destination on file" path.
      await this.affiliateCommissions.releaseClaimedCommissions(payout.id);
      await this.payouts.updateStatus(payout.id, {
        status: "FAILED",
        failureReason: "Stuck-payout recovery: partner or Stripe Connect destination no longer resolvable.",
      });
      logger.error("partner_payout_recovery_no_destination", { payoutId: payout.id, partnerId: payout.partnerId });
      return;
    }

    try {
      const transfer = await this.transferGateway.createTransfer({
        destinationStripeAccountId: stripeAccountId,
        amount: payout.amount,
        currency: payout.currency,
        // SAME key as the original attempt — see class doc comment. This
        // is the entire recovery mechanism: Stripe itself tells us
        // whether the original succeeded.
        idempotencyKey: `partner-payout:${payout.id}`,
        metadata: { payoutId: payout.id },
      });

      await this.affiliateCommissions.markPaidByPayoutId(payout.id, new Date());
      await this.payouts.updateStatus(payout.id, {
        status: "PAID",
        reference: transfer.stripeTransferId,
        processedAt: new Date(),
      });

      logger.info("partner_payout_recovered", { payoutId: payout.id, partnerId: payout.partnerId, stripeTransferId: transfer.stripeTransferId });
    } catch (error) {
      const message =
        error instanceof StripeTransferError ? error.message : error instanceof Error ? error.message : "Unknown payout recovery failure.";

      await this.affiliateCommissions.releaseClaimedCommissions(payout.id);
      await this.payouts.updateStatus(payout.id, { status: "FAILED", failureReason: message });

      logger.error("partner_payout_recovery_failed", { payoutId: payout.id, partnerId: payout.partnerId, error: message });
    }
  }

  private resolveStripeAccountId(partner: PartnerRecord): string | null {
    const details = partner.payoutDetails;
    if (!details || typeof details !== "object") return null;
    const value = (details as Record<string, unknown>).stripeConnectAccountId;
    return typeof value === "string" && value.length > 0 ? value : null;
  }
}
