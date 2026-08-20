import { NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import type { DisputeRepository, DisputeResolutionValue } from "@/domain/repositories/dispute-repository";
import type { PaymentRepository } from "@/domain/repositories/payment-repository";
import type {
  DisputeResolutionDecisionRecord,
  DisputeResolutionDecisionRepository,
} from "@/domain/repositories/dispute-resolution-decision-repository";
import type { FinancialAdjustmentTypeValue } from "@/domain/repositories/financial-adjustment-repository";
import {
  decideDisputeFinancialOutcome,
  type DisputeFinancialAdjustmentIntent,
} from "@/domain/services/dispute-resolution-financial-outcome";
import { isResolvableStatus } from "@/domain/services/dispute-state";
import type { ResolveDisputeUseCase } from "@/application/use-cases/dispute/resolve-dispute.use-case";
import type { CreateFinancialAdjustmentUseCase } from "@/application/use-cases/financial/create-financial-adjustment.use-case";
import type { EventBus } from "@/application/ports/event-bus";
import { EventDispatchError } from "@/application/ports/event-dispatch-error";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";
import { DisputeFinancialOutcomeDetermined } from "@/domain/events/dispute-financial-outcome-determined";
import { NullRefundExecutor, type RefundExecutor } from "@/application/ports/refund-executor";
import { REFUND_TYPE_ADJUSTMENTS } from "@/domain/repositories/financial-adjustment-repository";

export interface ResolveDisputeWithFinancialOutcomeInput {
  resolution: DisputeResolutionValue;
  resolutionNote: string;
  /** Required only for PARTIAL_RESOLUTION/FINANCIAL_ADJUSTMENT_REQUIRED —
   *  see `decideDisputeFinancialOutcome`'s own doc comment. Never
   *  defaulted or derived; an admin must type it in explicitly. */
  requestedAmount?: number | null;
  /** Required only for FINANCIAL_ADJUSTMENT_REQUIRED. */
  requestedAdjustmentType?: FinancialAdjustmentTypeValue | null;
}

/**
 * Module 68 — Dispute Resolution & Financial Protection: the ONE atomic
 * boundary that turns an admin's Dispute resolution into a persisted,
 * authoritative financial outcome — the exact gap the module's audit
 * found: Module 21's `ResolveDisputeUseCase` sets `Dispute.resolution` but
 * never moves money, and Module 22's `CreateFinancialAdjustmentUseCase`
 * (already fully idempotent/append-only) existed but was wired to
 * *nothing* — no code path connected "a dispute was resolved" to "a
 * financial adjustment was created and applied," and nothing prevented a
 * resolution and its financial consequence from disagreeing or duplicating.
 *
 * This use case closes that gap WITHOUT duplicating either module:
 *   - Dispute state transitions still go through the existing, unmodified
 *     `ResolveDisputeUseCase` (which itself still goes through
 *     `DisputeRepository.updateStatus`'s optimistic-concurrency guard).
 *   - Every financial write still goes through the existing, unmodified
 *     `CreateFinancialAdjustmentUseCase` (already idempotent per its own
 *     deterministic key, already append-only via `FinancialLedgerRepository`).
 *   - The only new persisted fact is `DisputeResolutionDecision` — the
 *     single record tying "what was decided" to "what financial outcome
 *     resulted," computed by the pure, deterministic
 *     `decideDisputeFinancialOutcome` (never re-implemented ad hoc here).
 *
 * ## Authorization
 * Admin-only — trusts the caller has already been authorized via
 * `requireRole(ADMIN, SUPER_ADMIN, SUPPORT)` at the Server Action boundary,
 * the exact same convention `ResolveDisputeUseCase` itself documents and
 * every other admin use case in this codebase follows.
 *
 * ## Idempotency & crash recovery
 * At most one `DisputeResolutionDecision` ever exists per dispute
 * (`disputeId` unique, DB-backed). Three cases:
 *   1. A decision already exists for this dispute — return it unchanged.
 *      A double-submit admin click or a retried request can never create a
 *      second decision or a second set of adjustments.
 *   2. The Dispute is still in a resolvable (non-terminal) status — the
 *      normal path: resolve it via `ResolveDisputeUseCase`, then create the
 *      decision from the resolution that use case just persisted.
 *   3. The Dispute is already `RESOLVED` (or beyond) but no decision exists
 *      yet — recovery from a crash between steps 2's two halves (the
 *      resolve succeeded, this method's own follow-through didn't). Skips
 *      re-resolving (which would fail — RESOLVED isn't itself a resolvable
 *      source status) and creates the decision directly from the Dispute's
 *      own already-persisted `resolution`, never re-trusting the caller's
 *      `input.resolution` once a resolution is already on record — this
 *      forecloses a caller supplying a different resolution on retry from
 *      silently producing a different financial outcome than what was
 *      actually decided.
 *
 * ## Concurrency
 * Two admins racing to resolve the same dispute: `ResolveDisputeUseCase`'s
 * own optimistic-concurrency guard (`DisputeRepository.updateStatus`)
 * ensures only one succeeds; the loser's call raises `ConflictError`
 * before this method ever reaches the financial half. Two admins racing
 * AFTER the dispute is already resolved (case 3 above, e.g. both retrying
 * a crashed request): `DisputeResolutionDecisionRepository.create`'s own
 * unique-`disputeId` constraint ensures only one decision is ever created
 * — the loser's `create()` throws `ConflictError`, caught here and
 * resolved by re-reading and returning the winner's decision, never by
 * creating a second one.
 */
export class ResolveDisputeWithFinancialOutcomeUseCase {
  constructor(
    private readonly disputes: DisputeRepository,
    private readonly payments: PaymentRepository,
    private readonly decisions: DisputeResolutionDecisionRepository,
    private readonly resolveDispute: ResolveDisputeUseCase,
    private readonly createFinancialAdjustment: CreateFinancialAdjustmentUseCase,
    private readonly eventBus: EventBus,
    private readonly failureReporter: FailureReporter = new NullFailureReporter(),
    /** Module 77 — Refund & Dispute Financial Execution: see
     *  `RefundExecutor`'s own doc comment for why this defaults to a
     *  no-op — every pre-existing test of this class keeps compiling and
     *  passing unchanged; production wiring (`dispute-resolution/
     *  compose.ts`) always supplies the real executor. */
    private readonly refundExecutor: RefundExecutor = new NullRefundExecutor(),
  ) {}

  async execute(
    adminUserId: string,
    disputeId: string,
    input: ResolveDisputeWithFinancialOutcomeInput,
  ): Promise<DisputeResolutionDecisionRecord> {
    const dispute = await this.disputes.findById(disputeId);
    if (!dispute) {
      throw new NotFoundError("Dispute", disputeId);
    }

    // Case 1 — idempotent replay: a decision already exists.
    const existingDecision = await this.decisions.findByDisputeId(disputeId);
    if (existingDecision) {
      return existingDecision;
    }

    let resolution: DisputeResolutionValue;
    if (dispute.status === "RESOLVED") {
      // Case 3 — recovery: the Dispute was already resolved but no
      // decision exists yet. Trust the persisted resolution, not the
      // caller's input — see this class's own doc comment.
      if (!dispute.resolution) {
        throw new ValidationError("This dispute is RESOLVED but has no recorded resolution — cannot proceed.");
      }
      resolution = dispute.resolution;
    } else {
      // Case 2 — normal path.
      if (!isResolvableStatus(dispute.status)) {
        throw new ValidationError(`Cannot resolve a dispute in status ${dispute.status}.`);
      }
      const resolved = await this.resolveDispute.execute(adminUserId, disputeId, {
        resolution: input.resolution,
        resolutionNote: input.resolutionNote,
      });
      resolution = resolved.resolution ?? input.resolution;
    }

    const payments = await this.payments.findByJobId(dispute.jobId);
    // Same deterministic "prefer a payment that actually captured funds"
    // selection as EvaluatePaymentReleaseUseCase/AdminResolvePaymentReleaseUseCase
    // (Module 66) — never a second, competing definition of "the relevant
    // Payment for this job."
    const payment =
      payments.find((p) => p.status === "CAPTURED" || p.status === "PARTIALLY_REFUNDED") ?? payments[0] ?? null;

    const financialOutcome = decideDisputeFinancialOutcome({
      resolution,
      paymentAmount: payment?.amount ?? null,
      requestedAmount: input.requestedAmount ?? null,
      requestedAdjustmentType: input.requestedAdjustmentType ?? null,
    });

    let decision: DisputeResolutionDecisionRecord;
    try {
      decision = await this.decisions.create({
        disputeId,
        jobId: dispute.jobId,
        paymentId: payment?.id ?? null,
        resolution,
        outcome: financialOutcome.outcome,
        reason: financialOutcome.reason,
        decidedByUserId: adminUserId,
        decidedAt: new Date(),
      });
    } catch (error) {
      // Lost a race against a concurrent create for the same dispute (case
      // 3's concurrency note above) — the winner's decision is already the
      // correct, current state; re-reading it is safe and produces no
      // second financial outcome.
      const fresh = await this.decisions.findByDisputeId(disputeId);
      if (fresh) return fresh;
      throw error;
    }

    const finalDecision = await this.applyAdjustments(adminUserId, decision, financialOutcome.adjustments);

    try {
      await this.eventBus.publishAll([
        new DisputeFinancialOutcomeDetermined(
          finalDecision.id,
          disputeId,
          dispute.jobId,
          resolution,
          finalDecision.outcome,
          finalDecision.status,
          adminUserId,
        ),
      ]);
    } catch (error) {
      if (!(error instanceof EventDispatchError)) throw error;
      this.failureReporter.report(error, { event: error.eventName, eventId: error.eventId });
    }

    return finalDecision;
  }

  /** Applies every adjustment this decision requires via the existing,
   *  unduplicated `CreateFinancialAdjustmentUseCase` (already idempotent
   *  and append-only on its own). Never throws on an individual
   *  adjustment failure — a failed adjustment must never leave the
   *  Dispute's resolution un-auditable; it is recorded on the decision's
   *  own status instead, for an admin to investigate and retry manually
   *  (never automatically — see the module's non-negotiable safety
   *  requirements). */
  private async applyAdjustments(
    adminUserId: string,
    decision: DisputeResolutionDecisionRecord,
    adjustments: readonly DisputeFinancialAdjustmentIntent[],
  ): Promise<DisputeResolutionDecisionRecord> {
    if (adjustments.length === 0) {
      return this.decisions.markApplied(decision.id);
    }

    let succeeded = 0;
    let failed = 0;
    for (const adjustment of adjustments) {
      try {
        const created = await this.createFinancialAdjustment.execute(adminUserId, {
          jobId: decision.jobId,
          disputeId: decision.disputeId,
          paymentId: decision.paymentId,
          type: adjustment.type,
          amount: adjustment.amount,
          reason: decision.reason,
          resolutionDecisionId: decision.id,
        });
        succeeded += 1;

        // Module 77 — Refund & Dispute Financial Execution: the ledger
        // adjustment above only ever records the *decision* — it never
        // itself calls Stripe (see `CreateFinancialAdjustmentUseCase`'s
        // own doc comment). A refund-type adjustment that actually
        // returns money to the customer must additionally trigger real
        // Stripe execution, via the injected `RefundExecutor` port so
        // this class never depends on Stripe/`PaymentGateway` directly.
        // Only fires once the ledger write above succeeded (`created` is
        // the just-`APPLIED` adjustment, unless it landed `PENDING`
        // because `applyAdjustments` itself hasn't marked it yet — see
        // this method's own return statement below, which always calls
        // `markApplied`/`markPartiallyApplied` after this loop) and only
        // for `REFUND_TYPE_ADJUSTMENTS` — `PROFESSIONAL_PAYOUT_REDUCTION`/
        // `CUSTOMER_COMPENSATION`/`COMMISSION_REVERSAL`/
        // `PROFESSIONAL_PAYOUT_RELEASE` never move customer-facing Stripe
        // funds and are deliberately left untouched, exactly like
        // `REFUND_TYPE_ADJUSTMENTS`'s own doc comment describes.
        if (REFUND_TYPE_ADJUSTMENTS.includes(adjustment.type) && decision.paymentId) {
          await this.refundExecutor.executeForAdjustment({
            financialAdjustmentId: created.id,
            paymentId: decision.paymentId,
            jobId: decision.jobId,
            disputeId: decision.disputeId,
            amount: adjustment.amount,
            requestedByUserId: adminUserId,
            reason: decision.reason,
          });
        }
      } catch (error) {
        failed += 1;
        this.failureReporter.report(error instanceof Error ? error : new Error(String(error)), {
          decisionId: decision.id,
          disputeId: decision.disputeId,
          adjustmentType: adjustment.type,
          note: "Financial adjustment failed while applying a DisputeResolutionDecision — requires manual admin review, never automatically retried.",
        });
      }
    }

    if (failed === 0) return this.decisions.markApplied(decision.id);
    if (succeeded === 0) return this.decisions.markFailed(decision.id);
    return this.decisions.markPartiallyApplied(decision.id);
  }
}
