import { NotFoundError, StripeTransferError, ValidationError } from "@/domain/errors/domain-error";
import type { PayoutRecord, PayoutRepository } from "@/domain/repositories/payout-repository";
import type { CommissionRepository } from "@/domain/repositories/commission-repository";
import type { StripeTransferGateway } from "@/application/ports/stripe-transfer-gateway";
import type { EventBus } from "@/application/ports/event-bus";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";
import { publishDomainEvent } from "@/application/services/events/publish-domain-event";
import type { CreateFinancialAdjustmentUseCase } from "@/application/use-cases/financial/create-financial-adjustment.use-case";
import { ProfessionalPayoutReversed } from "@/domain/events/professional-payout-reversed";
import { PayoutReversalFailed } from "@/domain/events/payout-reversal-failed";
import { logger } from "@/infrastructure/observability/logger";

export interface ReversePayoutInput {
  payoutId: string;
  requestedByUserId: string;
  reason: string | null;
}

const REVERSIBLE_STATUSES = ["PAID"] as const;

/**
 * Module 77 — Refund & Dispute Financial Execution.
 *
 * Reverses an already-`PAID` Payout's Stripe Transfer — the Module 76
 * counterpart `ExecuteRefundUseCase` invokes (never any other module) once
 * a customer refund has determined that a professional who was already
 * paid must have that payout clawed back. Reuses `StripeTransferGateway`
 * (Module 76) unchanged — `reverseTransfer` is the one new method added to
 * that same port, never a second/parallel transfer gateway (see this
 * module's own "do not duplicate the existing Stripe Connect transfer
 * architecture" requirement).
 *
 * ## Full reversal only
 * Only ever reverses a Payout's full `amount` — no partial-reversal
 * support is invented here. `Payout` (unlike `Payment`) has no existing
 * concept of a partial payout, so there is nothing for a partial reversal
 * to be partial *of*; a `PARTIAL_REFUND` dispute outcome against an
 * already-paid Job still reverses the professional's ENTIRE original
 * transfer (the only financially consistent option available without
 * inventing a new domain concept Module 68 never decided) — recording
 * that nuance (if ever required) is future Module 80/81 reconciliation
 * territory, not this module's.
 *
 * ## Idempotency
 * `Payout.reversalIdempotencyKey` (`payout-reversal:<payoutId>`), reused
 * unchanged across every retried attempt, is the Stripe-level guarantee —
 * the same convention `Payout.idempotencyKey` already establishes for the
 * original transfer. `PayoutRepository.markReversed`'s own compare-and-
 * swap (`fromStatuses: ["PAID"]`) is the database-level guarantee: a
 * second concurrent/duplicate reversal attempt either sees `status ===
 * "REVERSED"` already (early return) or loses the CAS race and safely
 * returns the winner's already-reversed record — never a second Stripe
 * reversal call's result is silently discarded, and never two ledger
 * commission-reversal entries are created (`CreateFinancialAdjustmentUseCase`'s
 * own idempotency key is `adjustment:<jobId>:none:COMMISSION_REVERSAL:<paymentId>`
 * — also naturally idempotent per Job+Payment).
 *
 * ## Commission reversal
 * Never mutates `Commission.status` directly — `CommissionRepository`'s
 * own doc comment is explicit that a correction is "a COMMISSION_REVERSAL
 * ledger entry ... plus a FinancialAdjustment, never a second Commission
 * row or a mutation of this one." This use case reuses the existing,
 * unduplicated `CreateFinancialAdjustmentUseCase` for exactly that ledger
 * entry — never invents a second commission-reversal mechanism.
 *
 * ## Never silently marks a rejected reversal as reversed
 * A Stripe failure (insufficient balance, an already-reversed Transfer at
 * Stripe's own end, ...) marks the Payout `markReversalFailed` — it stays
 * `PAID`, never silently `REVERSED` — and raises `PayoutReversalFailed`
 * for an admin/future reconciliation process to see. Never automatically
 * retried by this use case itself, mirroring `ExecuteProfessionalPayoutUseCase`'s
 * own "a failed attempt is a terminal signal, not a background retry
 * loop" posture.
 */
export class ReverseProfessionalPayoutUseCase {
  constructor(
    private readonly payouts: PayoutRepository,
    private readonly transferGateway: StripeTransferGateway,
    private readonly commissions: CommissionRepository,
    private readonly createFinancialAdjustment: CreateFinancialAdjustmentUseCase,
    private readonly eventBus: EventBus,
    private readonly failureReporter: FailureReporter = new NullFailureReporter(),
  ) {}

  async execute(input: ReversePayoutInput): Promise<PayoutRecord> {
    const payout = await this.payouts.findById(input.payoutId);
    if (!payout) {
      throw new NotFoundError("Payout", input.payoutId);
    }

    if (payout.status === "REVERSED") {
      return payout; // idempotent replay
    }
    if (!REVERSIBLE_STATUSES.includes(payout.status as (typeof REVERSIBLE_STATUSES)[number])) {
      throw new ValidationError(`Cannot reverse a payout in status ${payout.status} — only a PAID payout can be reversed.`);
    }
    if (!payout.stripeTransferId) {
      throw new ValidationError(`Payout ${payout.id} has no stripeTransferId — cannot reverse.`);
    }

    const idempotencyKey = payout.reversalIdempotencyKey ?? `payout-reversal:${payout.id}`;

    try {
      const reversal = await this.transferGateway.reverseTransfer({
        stripeTransferId: payout.stripeTransferId,
        amount: payout.amount,
        currency: payout.currency,
        idempotencyKey,
        metadata: { payoutId: payout.id },
      });

      const { applied, record } = await this.payouts.markReversed({
        id: payout.id,
        stripeReversalId: reversal.stripeReversalId,
        reversedAmount: payout.amount,
        reversalIdempotencyKey: idempotencyKey,
        fromStatuses: REVERSIBLE_STATUSES,
      });

      if (!applied) {
        // Lost the race — another concurrent reversal attempt already
        // won (Stripe idempotency guaranteed both received the same
        // `stripeReversalId`). `record` already reflects the winner's
        // REVERSED state.
        return record;
      }

      await this.reverseCommission(payout, input);

      await publishDomainEvent(
        this.eventBus,
        new ProfessionalPayoutReversed(
          record.id,
          record.jobId,
          record.paymentId,
          record.professionalProfileId,
          record.companyProfileId,
          record.reversedAmount ?? payout.amount,
          record.currency,
          reversal.stripeReversalId,
        ),
        this.failureReporter,
      );

      logger.info("payout_reversal.reversed", { payoutId: record.id, jobId: record.jobId, stripeReversalId: reversal.stripeReversalId });

      return record;
    } catch (error) {
      const message =
        error instanceof StripeTransferError ? error.message : error instanceof Error ? error.message : "Unknown payout reversal failure.";

      const { record } = await this.payouts.markReversalFailed({
        id: payout.id,
        reversalFailureReason: message,
        fromStatuses: REVERSIBLE_STATUSES,
      });

      logger.error("payout_reversal.failed", { payoutId: payout.id, jobId: payout.jobId, error: message });

      await publishDomainEvent(
        this.eventBus,
        new PayoutReversalFailed(record.id, record.jobId, record.paymentId, message),
        this.failureReporter,
      );

      throw error;
    }
  }

  /** See this class's own "commission reversal" doc comment — reuses the
   *  existing, unduplicated `CreateFinancialAdjustmentUseCase`. Never
   *  throws past this call: a failed ledger write must not undo an
   *  already-successful Stripe reversal or leave the Payout in an
   *  inconsistent status — it is reported for manual review instead,
   *  mirroring `ResolveDisputeWithFinancialOutcomeUseCase.applyAdjustments`'s
   *  own "never let a ledger-side failure abort the operation that
   *  already succeeded externally" posture. */
  private async reverseCommission(payout: PayoutRecord, input: ReversePayoutInput): Promise<void> {
    if (!payout.paymentId || !payout.jobId) return;

    try {
      const commission = await this.commissions.findByPaymentId(payout.paymentId);
      if (!commission) return;

      await this.createFinancialAdjustment.execute(input.requestedByUserId, {
        jobId: payout.jobId,
        disputeId: null,
        paymentId: payout.paymentId,
        type: "COMMISSION_REVERSAL",
        amount: commission.amount,
        reason: input.reason ?? `Commission reversed following payout reversal for payout ${payout.id}.`,
      });
    } catch (error) {
      this.failureReporter.report(error instanceof Error ? error : new Error(String(error)), {
        payoutId: payout.id,
        paymentId: payout.paymentId,
        note: "Commission reversal ledger entry failed after a successful payout reversal — requires manual review.",
      });
    }
  }
}
