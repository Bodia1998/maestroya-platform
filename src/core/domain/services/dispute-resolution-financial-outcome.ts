import { ValidationError } from "@/domain/errors/domain-error";
import type { DisputeResolutionValue } from "@/domain/repositories/dispute-repository";
import type { FinancialAdjustmentTypeValue } from "@/domain/repositories/financial-adjustment-repository";

/**
 * Module 68 — Dispute Resolution & Financial Protection: the single
 * authoritative, pure function that turns an admin's *business-level*
 * Dispute resolution (`DisputeResolutionValue` — Module 21's existing
 * vocabulary, see `dispute-repository.ts`'s own doc comment: "never a
 * Stripe/payment action") into a deterministic *financial* outcome — which
 * of the existing Module 22 `FinancialAdjustmentTypeValue`s must be
 * recorded, and for how much. Mirrors `payment-release-decision.ts`'s own
 * "pure function — no I/O, no Prisma, no Stripe, no event bus" convention
 * exactly: the calling use case
 * (`ResolveDisputeWithFinancialOutcomeUseCase`) gathers inputs (the
 * Payment amount, any admin-specified amount) and persists/executes this
 * function's output; this file only decides.
 *
 * ## Why this exists instead of five scattered `if` statements
 * The module brief requires "the resolution must determine WHAT SHOULD
 * HAPPEN financially" as one deterministic, auditable step, and forbids a
 * second competing financial-decision engine. This file is that one
 * mapping — `ResolveDisputeWithFinancialOutcomeUseCase` is the only
 * caller, and every `FinancialAdjustment` Module 68 ever creates is
 * computed here, never invented ad hoc at the call site.
 *
 * ## Money is never invented
 * Every amount this function returns is either the full, already-known
 * `Payment.amount` (for a full refund/release) or a value the admin
 * explicitly typed in (for a partial refund or a generic adjustment) —
 * this function never guesses, prorates, or estimates an amount. Passing
 * `null` for a required amount is a hard `ValidationError`, not a
 * fallback to some default.
 */

export type DisputeFinancialOutcomeValue =
  | "NO_FINANCIAL_ACTION"
  | "FULL_RELEASE"
  | "FULL_REFUND"
  | "PARTIAL_REFUND"
  | "HOLD_FOR_REVIEW";

export interface DisputeFinancialAdjustmentIntent {
  type: FinancialAdjustmentTypeValue;
  amount: number;
}

export interface DisputeFinancialOutcomeDecision {
  outcome: DisputeFinancialOutcomeValue;
  /** Zero or more `FinancialAdjustment`s `ResolveDisputeWithFinancialOutcomeUseCase`
   *  must create via the existing `CreateFinancialAdjustmentUseCase` — this
   *  function never creates them itself (no I/O). Empty for
   *  `NO_FINANCIAL_ACTION`, `FULL_RELEASE`, and `HOLD_FOR_REVIEW` — none of
   *  those move money. */
  adjustments: readonly DisputeFinancialAdjustmentIntent[];
  reason: string;
}

export interface DisputeFinancialOutcomeInput {
  resolution: DisputeResolutionValue;
  /** The full captured amount of the Payment this dispute's Job is tied
   *  to — `null` only if no Payment exists yet (a dispute can be opened
   *  and resolved before any Payment is captured, e.g. a pre-completion
   *  dispute). Required (must be non-null and positive) for
   *  `CUSTOMER_FAVOR`; a `CUSTOMER_FAVOR` resolution against a Job with no
   *  Payment is a `ValidationError` — there is nothing to refund. */
  paymentAmount: number | null;
  /** Admin-specified amount — required for `PARTIAL_RESOLUTION` (the
   *  refund amount, must be strictly between 0 and `paymentAmount`) and
   *  for `FINANCIAL_ADJUSTMENT_REQUIRED` (paired with
   *  `requestedAdjustmentType` below). Ignored for every other
   *  resolution — this function never re-derives an amount the admin
   *  didn't ask for. */
  requestedAmount: number | null;
  /** Required only for `FINANCIAL_ADJUSTMENT_REQUIRED` — which existing
   *  `FinancialAdjustmentTypeValue` applies. `FINANCIAL_ADJUSTMENT_REQUIRED`
   *  is Module 21's own documented escape hatch ("the generic 'Module 22
   *  must act' flag") for a resolution shape none of the other five
   *  values fit; this function does not further guess which adjustment
   *  type that means — an admin must say so explicitly. */
  requestedAdjustmentType: FinancialAdjustmentTypeValue | null;
}

/**
 * Resolutions whose financial outcome moves money and therefore MUST have
 * an `APPLIED` `DisputeResolutionDecision` before the Dispute is allowed to
 * close — see `CloseDisputeUseCase`'s Module 68 guard. `NO_ACTION` and
 * `PROFESSIONAL_FAVOR` need no settlement step (nothing to refund; the
 * professional's normal release continues through Module 66 unchanged).
 * `ESCALATED_EXTERNALLY` is a deliberate, documented exception — see this
 * function's own doc comment on `HOLD_FOR_REVIEW` below and
 * MODULE_68_IMPLEMENTATION_REPORT.md's "Remaining limitations".
 */
export function disputeResolutionRequiresFinancialSettlementBeforeClose(
  resolution: DisputeResolutionValue | null,
): boolean {
  return (
    resolution === "CUSTOMER_FAVOR" ||
    resolution === "PARTIAL_RESOLUTION" ||
    resolution === "FINANCIAL_ADJUSTMENT_REQUIRED"
  );
}

export function decideDisputeFinancialOutcome(input: DisputeFinancialOutcomeInput): DisputeFinancialOutcomeDecision {
  switch (input.resolution) {
    case "NO_ACTION":
      return {
        outcome: "NO_FINANCIAL_ACTION",
        adjustments: [],
        reason: "The dispute was resolved with no financial consequence for either party.",
      };

    case "PROFESSIONAL_FAVOR":
      // No refund; the professional's payout continues through the
      // existing, unduplicated Module 66 release gate once the Dispute is
      // closed (`AdminResolvePaymentReleaseUseCase`) — this function does
      // not itself approve or execute a release.
      return {
        outcome: "FULL_RELEASE",
        adjustments: [],
        reason: "The dispute was resolved in the professional's favor — no refund is due; the normal payment release flow applies.",
      };

    case "CUSTOMER_FAVOR": {
      if (input.paymentAmount === null || input.paymentAmount <= 0) {
        throw new ValidationError(
          "Cannot resolve in the customer's favor with a financial outcome: no captured payment exists for this job to refund.",
        );
      }
      return {
        outcome: "FULL_REFUND",
        adjustments: [{ type: "FULL_REFUND", amount: input.paymentAmount }],
        reason: `The dispute was resolved in the customer's favor — the full captured amount (${input.paymentAmount}) is refundable; the professional receives no payout.`,
      };
    }

    case "PARTIAL_RESOLUTION": {
      if (input.paymentAmount === null || input.paymentAmount <= 0) {
        throw new ValidationError(
          "Cannot record a partial resolution's financial outcome: no captured payment exists for this job.",
        );
      }
      if (input.requestedAmount === null || input.requestedAmount <= 0) {
        throw new ValidationError("A partial resolution requires an explicit, positive refund amount.");
      }
      if (input.requestedAmount >= input.paymentAmount) {
        throw new ValidationError(
          "A partial resolution's refund amount must be less than the full captured payment amount — use CUSTOMER_FAVOR for a full refund.",
        );
      }
      return {
        outcome: "PARTIAL_REFUND",
        adjustments: [{ type: "PARTIAL_REFUND", amount: input.requestedAmount }],
        reason: `The dispute was partially resolved in the customer's favor — a partial refund of ${input.requestedAmount} (of ${input.paymentAmount} captured) is due; the professional's payout is reduced accordingly.`,
      };
    }

    case "FINANCIAL_ADJUSTMENT_REQUIRED": {
      if (!input.requestedAdjustmentType) {
        throw new ValidationError(
          "FINANCIAL_ADJUSTMENT_REQUIRED resolutions require an explicit adjustment type — this function never guesses one.",
        );
      }
      if (input.requestedAmount === null || input.requestedAmount <= 0) {
        throw new ValidationError("FINANCIAL_ADJUSTMENT_REQUIRED resolutions require an explicit, positive amount.");
      }
      if (
        input.paymentAmount !== null &&
        (input.requestedAdjustmentType === "FULL_REFUND" ||
          input.requestedAdjustmentType === "PARTIAL_REFUND" ||
          input.requestedAdjustmentType === "PLATFORM_FEE_REFUND") &&
        input.requestedAmount > input.paymentAmount
      ) {
        throw new ValidationError("A refund-type adjustment cannot exceed the full captured payment amount.");
      }
      // FULL_REFUND is its own outcome bucket for reporting clarity;
      // PROFESSIONAL_PAYOUT_RELEASE has no negative consequence for either
      // party (money already earned is simply no longer held — see
      // CreateFinancialAdjustmentUseCase's own doc comment on this exact
      // sign convention); every other adjustment type reduces what either
      // the platform or professional retains and is bucketed as
      // PARTIAL_REFUND for the coarse business-outcome summary — the exact
      // mechanics are always carried precisely by `adjustments[].type`/
      // `amount`, never inferred from `outcome` alone.
      const outcome: DisputeFinancialOutcomeValue =
        input.requestedAdjustmentType === "FULL_REFUND"
          ? "FULL_REFUND"
          : input.requestedAdjustmentType === "PROFESSIONAL_PAYOUT_RELEASE"
            ? "FULL_RELEASE"
            : "PARTIAL_REFUND";
      return {
        outcome,
        adjustments: [{ type: input.requestedAdjustmentType, amount: input.requestedAmount }],
        reason: `An explicit financial adjustment (${input.requestedAdjustmentType}) of ${input.requestedAmount} was required by the dispute's resolution.`,
      };
    }

    case "ESCALATED_EXTERNALLY":
      // Explicitly no automatic financial action — see this module's
      // non-negotiable safety requirement "no payout merely because a
      // dispute timed out [or was escalated]". A human must return with a
      // fresh, explicit resolution once the external/legal escalation
      // concludes; this function never invents one. See
      // `disputeResolutionRequiresFinancialSettlementBeforeClose`'s own doc
      // comment for why this specific value is a documented exception to
      // the close-time settlement guard, not silently treated the same as
      // NO_ACTION.
      return {
        outcome: "HOLD_FOR_REVIEW",
        adjustments: [],
        reason: "The dispute was escalated externally — no automatic financial action is taken; a human must resolve this again once the escalation concludes.",
      };
  }
}
