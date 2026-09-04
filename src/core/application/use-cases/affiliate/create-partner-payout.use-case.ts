import { ConflictError, NotFoundError, StripeTransferError, ValidationError } from "@/domain/errors/domain-error";
import { selectPayoutBatch } from "@/domain/services/partner-payout-rules";
import type { AffiliateCommissionRepository } from "@/domain/repositories/affiliate-commission-repository";
import type { PartnerPayoutRecord, PartnerPayoutRepository } from "@/domain/repositories/partner-payout-repository";
import type { PartnerRecord, PartnerRepository } from "@/domain/repositories/partner-repository";
import type { StripeTransferGateway } from "@/application/ports/stripe-transfer-gateway";
import { logger } from "@/infrastructure/observability/logger";

/**
 * Module 61/96 — Affiliate & Partner System: admin action — settles a
 * partner's entire outstanding `APPROVED` balance into one `PartnerPayout`
 * batch, gated on `Partner.minimumPayoutThreshold` (see
 * `domain/services/partner-payout-rules.ts`).
 *
 * Module 96 addition: when the partner's own `payoutMethod` is `STRIPE`,
 * this now actually executes a `stripe.transfers.create` via the shared
 * `StripeTransferGateway` port (Module 76's own gateway, reused unchanged
 * — no second Stripe transfer implementation exists anywhere in this
 * codebase). `MANUAL` partners are unaffected — their payout row still
 * only ever records a batch for offline settlement, exactly as before.
 *
 * ## Destination — never caller-supplied
 * The Stripe Connect destination account is read exclusively from the
 * partner's own server-side record (`Partner.payoutDetails.
 * stripeConnectAccountId`), the same "never accepted from client input"
 * rule `ResolvePayoutDestinationUseCase`/`StripeTransferGateway` already
 * enforce for professional payouts. There is no `partnerId`-adjacent
 * "destination account id" parameter anywhere on this use case's input —
 * partner A has no path to redirect partner B's payout to their own
 * Stripe account, because the only account ever used is the one loaded
 * fresh from `input.partnerId`'s own `Partner` row.
 *
 * ## Duplicate-payout guard — Module 96 Financial Fix Pass
 * Refuses to create a second batch while a `PENDING`/`PROCESSING` payout
 * already exists for this partner. This is now a DATABASE-level
 * guarantee, not an application check: `PartnerPayoutRepository.
 * createBatch` inserts the payout row and atomically claims every
 * commission in the batch (`payoutId = <this payout>`) inside one
 * transaction, backed by a partial unique index on
 * `partner_payouts(partnerId) WHERE status IN ('PENDING','PROCESSING')`
 * and a conditional `updateMany` + row-count check on the commissions —
 * see that method's own doc comment. Two concurrent admin clicks (or an
 * admin double-click) can therefore never both succeed: the loser's
 * transaction rolls back entirely and this use case surfaces the same
 * `ValidationError` message as before. A failed Stripe transfer releases
 * the claim (`releaseClaimedCommissions`) so the same commissions are
 * selectable by a genuinely new payout attempt — a failed payout stays
 * retryable, but retrying never resurrects the SAME payout row or
 * re-executes the SAME Stripe transfer (see `StripeTransferGatewayAdapter.
 * createTransfer`'s idempotency key, tied 1:1 to this payout's own id).
 */
export class CreatePartnerPayoutUseCase {
  constructor(
    private readonly partners: PartnerRepository,
    private readonly affiliateCommissions: AffiliateCommissionRepository,
    private readonly payouts: PartnerPayoutRepository,
    private readonly transferGateway?: StripeTransferGateway,
  ) {}

  async execute(input: { partnerId: string; periodStart: Date; periodEnd: Date }): Promise<PartnerPayoutRecord> {
    const partner = await this.partners.findById(input.partnerId);
    if (!partner) {
      throw new NotFoundError("Partner", input.partnerId);
    }

    const approved = await this.affiliateCommissions.listApprovedForPartner(input.partnerId);
    const batch = selectPayoutBatch(approved, partner.minimumPayoutThreshold);
    if (!batch) {
      throw new ValidationError(
        `Partner "${partner.id}" has not reached the minimum payout threshold of ${partner.minimumPayoutThreshold}.`,
      );
    }

    let payout: PartnerPayoutRecord;
    try {
      payout = await this.payouts.createBatch(
        {
          partnerId: partner.id,
          amount: batch.amount,
          method: partner.payoutMethod,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
        },
        batch.commissionIds,
      );
    } catch (error) {
      if (error instanceof ConflictError) {
        // Same partner-facing message this used to be an application-
        // level check for — see this class's own doc comment on why the
        // guarantee behind it changed, not the observable behavior.
        throw new ValidationError(
          `Partner "${partner.id}" already has a payout in progress — wait for it to complete before starting another.`,
        );
      }
      throw error;
    }

    if (partner.payoutMethod !== "STRIPE") {
      await this.affiliateCommissions.markPaidByIds(batch.commissionIds, payout.id, new Date());
      return this.payouts.updateStatus(payout.id, { status: "PAID", processedAt: new Date() });
    }

    return this.executeStripeTransfer(partner, payout, batch.commissionIds);
  }

  private async executeStripeTransfer(
    partner: PartnerRecord,
    payout: PartnerPayoutRecord,
    commissionIds: string[],
  ): Promise<PartnerPayoutRecord> {
    if (!this.transferGateway) {
      // Module 96 Financial Fix Pass — release the claim on every FAILED
      // path, not just the Stripe-call catch block below, so these
      // commissions are never stranded under a payout that never even
      // attempted a transfer.
      await this.affiliateCommissions.releaseClaimedCommissions(payout.id);
      const failed = await this.payouts.updateStatus(payout.id, {
        status: "FAILED",
        failureReason: "No Stripe transfer gateway is configured for STRIPE-method partner payouts.",
      });
      return failed;
    }

    const stripeAccountId = this.resolveStripeAccountId(partner);
    if (!stripeAccountId) {
      await this.affiliateCommissions.releaseClaimedCommissions(payout.id);
      await this.payouts.updateStatus(payout.id, {
        status: "FAILED",
        failureReason: "This partner's Stripe Connect account is not configured — cannot execute payout.",
      });
      throw new ValidationError(
        `Partner "${partner.id}" has payoutMethod STRIPE but no stripeConnectAccountId on file — cannot execute payout.`,
      );
    }

    await this.payouts.updateStatus(payout.id, { status: "PROCESSING" });

    try {
      const transfer = await this.transferGateway.createTransfer({
        destinationStripeAccountId: stripeAccountId,
        amount: payout.amount,
        currency: payout.currency,
        idempotencyKey: `partner-payout:${payout.id}`,
        metadata: { payoutId: payout.id },
      });

      await this.affiliateCommissions.markPaidByIds(commissionIds, payout.id, new Date());

      return this.payouts.updateStatus(payout.id, {
        status: "PAID",
        reference: transfer.stripeTransferId,
        processedAt: new Date(),
      });
    } catch (error) {
      const message =
        error instanceof StripeTransferError ? error.message : error instanceof Error ? error.message : "Unknown payout execution failure.";

      // Module 96 Financial Fix Pass — release the claim BEFORE marking
      // FAILED, so these commissions are immediately selectable by a
      // future payout attempt (listApprovedForPartner filters on
      // payoutId IS NULL) rather than permanently stranded under a dead
      // payout row. Never releases anything already PAID — see this
      // repository method's own doc comment.
      await this.affiliateCommissions.releaseClaimedCommissions(payout.id);
      await this.payouts.updateStatus(payout.id, { status: "FAILED", failureReason: message });

      logger.error("partner_payout_execution_failed", { partnerId: partner.id, payoutId: payout.id, error: message });

      throw error;
    }
  }

  /** Reads the destination Stripe Connect account strictly from this
   *  partner's own `payoutDetails` — never from any caller input. */
  private resolveStripeAccountId(partner: PartnerRecord): string | null {
    const details = partner.payoutDetails;
    if (!details || typeof details !== "object") return null;
    const value = (details as Record<string, unknown>).stripeConnectAccountId;
    return typeof value === "string" && value.length > 0 ? value : null;
  }
}
