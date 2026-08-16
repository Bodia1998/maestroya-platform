import { DomainEvent } from "@/domain/events/domain-event";
import type { DisputeResolutionValue } from "@/domain/repositories/dispute-repository";
import type { DisputeResolutionDecisionStatusValue } from "@/domain/repositories/dispute-resolution-decision-repository";
import type { DisputeFinancialOutcomeValue } from "@/domain/services/dispute-resolution-financial-outcome";

/**
 * Module 68 — Dispute Resolution & Financial Protection: raised once by
 * `ResolveDisputeWithFinancialOutcomeUseCase` after a
 * `DisputeResolutionDecision` has been created and every required
 * `FinancialAdjustment` has been attempted (whether all succeeded,
 * partially succeeded, or all failed — `finalStatus` tells subscribers
 * which). Describes a domain fact ("this decision now has this financial
 * outcome, at this status"), not a command — no subscriber is expected to
 * move money in reaction to this event; that already happened (or didn't)
 * before it was published. A future Stripe-execution module could
 * subscribe to this event to enqueue the real transfer/refund it
 * represents, without this module ever depending on Stripe.
 */
export class DisputeFinancialOutcomeDetermined extends DomainEvent {
  static readonly eventName = "dispute.financial-outcome-determined";

  constructor(
    readonly decisionId: string,
    readonly disputeId: string,
    readonly jobId: string,
    readonly resolution: DisputeResolutionValue,
    readonly outcome: DisputeFinancialOutcomeValue,
    readonly finalStatus: DisputeResolutionDecisionStatusValue,
    /** The admin who made the resolution decision. */
    readonly decidedByUserId: string,
  ) {
    super();
  }
}
