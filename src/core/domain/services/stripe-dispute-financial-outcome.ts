import { roundToCents } from "@/domain/services/money";

/**
 * Module 86 — Stripe Chargeback & Dispute Handling: the single
 * authoritative, pure function that turns a Stripe `charge.dispute.closed`
 * event's own final status into a deterministic financial outcome —
 * mirrors `dispute-resolution-financial-outcome.ts`'s (Module 68) own
 * "pure function — no I/O, no Prisma, no Stripe, no event bus" convention
 * exactly, applied to a Stripe-driven resolution instead of an
 * admin-driven one. `ProcessStripeDisputeWebhookUseCase` is the only
 * caller; every financial consequence a Stripe dispute closure ever has
 * is computed here, never invented ad hoc at the call site.
 *
 * ## Only three outcomes are possible at `closed` time
 * Stripe's own dispute lifecycle resolves to exactly one of `won`
 * (the platform keeps the funds — Stripe already reversed whatever it
 * provisionally withdrew), `lost` (the platform permanently loses the
 * disputed funds — Stripe's withdrawal is final), or `warning_closed`
 * (an early-warning dispute that never became a real chargeback — no
 * funds were ever withdrawn in the first place). This function maps each
 * to a `StripeDisputeFinancialOutcome` with NO further branching on
 * `reason`/`evidenceDueBy`/anything else — this platform's financial
 * response to a chargeback never depends on WHY the customer's bank
 * disputed the charge, only on how Stripe finally resolved it.
 *
 * ## Why `LOST` reuses `FULL_REFUND`/`PARTIAL_REFUND` — not a new type
 * `FinancialAdjustmentTypeValue` already has no dedicated "chargeback"
 * type, and this function deliberately does not invent one. A lost
 * Stripe dispute has the exact same effect on `Payment` that a
 * `CUSTOMER_FAVOR`-resolved internal Dispute already has (see
 * `payment-status.ts`'s own doc comment: "Module 21 Disputes already
 * models dispute outcomes against a Payment via FinancialAdjustment, it
 * doesn't need a mirrored Payment status" — a chargeback loss is simply
 * another instance of that same fact) — the captured amount is
 * permanently no longer available to the platform, and the professional
 * receives no payout for it (or has an already-executed payout reversed).
 * `FULL_REFUND` when the disputed amount covers the whole remaining
 * captured balance, `PARTIAL_REFUND` otherwise — matching
 * `decideDisputeFinancialOutcome`'s own `CUSTOMER_FAVOR`/
 * `PARTIAL_RESOLUTION` split exactly. `CreateFinancialAdjustmentUseCase`'s
 * own Invariant-8 refund-boundedness guard remains the authoritative
 * backstop against this ever exceeding what was actually captured.
 */

export type StripeDisputeFinancialOutcomeValue = "NO_FINANCIAL_ACTION" | "CHARGEBACK_LOSS";

export interface StripeDisputeAdjustmentIntent {
  type: "FULL_REFUND" | "PARTIAL_REFUND";
  amount: number;
}

export interface StripeDisputeFinancialOutcomeDecision {
  outcome: StripeDisputeFinancialOutcomeValue;
  /** At most one — a Stripe dispute is always for a single fixed amount,
   *  never split across several adjustments (see this file's own doc
   *  comment). Empty for `NO_FINANCIAL_ACTION`. */
  adjustments: readonly StripeDisputeAdjustmentIntent[];
  reason: string;
}

export interface StripeDisputeFinancialOutcomeInput {
  /** Stripe's own final dispute status, already mapped onto this
   *  platform's own `StripeDisputeStatusValue` (`won`/`lost`/
   *  `warning_closed` — `ProcessStripeDisputeWebhookUseCase` never passes
   *  a non-terminal status here). */
  finalStatus: "WON" | "LOST" | "WARNING_CLOSED";
  /** Stripe's own disputed amount. */
  disputeAmount: number;
  /** The Payment's own captured `amount` — `null` only if no matching
   *  Payment was ever found for this dispute (an edge case
   *  `ProcessStripeDisputeWebhookUseCase` handles by never calling this
   *  function with `finalStatus: "LOST"` in the first place; kept
   *  optional here so the function's own contract stays honest either
   *  way). */
  paymentAmount: number | null;
  /** Sum of every already-`APPLIED` refund-type `FinancialAdjustment`
   *  against this Payment (Invariant 8's own running total) — used only
   *  to decide `FULL_REFUND` vs. `PARTIAL_REFUND` for reporting clarity;
   *  the actual bound is still enforced downstream by
   *  `CreateFinancialAdjustmentUseCase` itself, never re-implemented
   *  here. */
  alreadyRefunded: number;
}

export function decideStripeDisputeFinancialOutcome(
  input: StripeDisputeFinancialOutcomeInput,
): StripeDisputeFinancialOutcomeDecision {
  if (input.finalStatus === "WON") {
    return {
      outcome: "NO_FINANCIAL_ACTION",
      adjustments: [],
      reason: "The Stripe dispute was won — Stripe already returned the disputed funds to the platform's balance; no MaestroYa-side adjustment is recorded.",
    };
  }

  if (input.finalStatus === "WARNING_CLOSED") {
    return {
      outcome: "NO_FINANCIAL_ACTION",
      adjustments: [],
      reason: "The Stripe dispute closed as a warning that never became a real chargeback — no funds were ever withdrawn, no adjustment is recorded.",
    };
  }

  // finalStatus === "LOST"
  if (input.paymentAmount === null || input.paymentAmount <= 0) {
    return {
      outcome: "NO_FINANCIAL_ACTION",
      adjustments: [],
      reason: "The Stripe dispute was lost but no captured Payment could be matched — nothing to adjust; requires manual reconciliation.",
    };
  }

  const remainingCapturedBalance = roundToCents(input.paymentAmount - input.alreadyRefunded);
  const adjustmentAmount = roundToCents(Math.min(input.disputeAmount, Math.max(remainingCapturedBalance, 0)));

  if (adjustmentAmount <= 0) {
    return {
      outcome: "NO_FINANCIAL_ACTION",
      adjustments: [],
      reason: "The Stripe dispute was lost, but the Payment's captured balance was already fully refunded/adjusted — no further adjustment is recorded.",
    };
  }

  const type = adjustmentAmount >= remainingCapturedBalance ? "FULL_REFUND" : "PARTIAL_REFUND";

  return {
    outcome: "CHARGEBACK_LOSS",
    adjustments: [{ type, amount: adjustmentAmount }],
    reason: `The Stripe dispute was lost — the platform permanently loses ${adjustmentAmount} ${type === "FULL_REFUND" ? "(the full remaining captured balance)" : "of the captured amount"}.`,
  };
}
