import type { PaymentReleaseStatus } from "@/domain/services/payment-release-decision";

/**
 * Module 69 — Financial Ledger & Payout Readiness Audit (Section 24: the
 * Payout Readiness Contract).
 *
 * The single application/domain-level boundary answering "is this
 * professional currently eligible to receive a payout for this financial
 * amount?" — the ONE thing a future Module 70 (Stripe Connect) is allowed
 * to depend on to make that call. This function NEVER executes a payout —
 * see `CheckPayoutReadinessUseCase`'s own doc comment — it only decides,
 * exactly like `payment-release-decision.ts`/
 * `dispute-resolution-financial-outcome.ts` before it: pure, no I/O, no
 * Prisma, no Stripe, no event bus.
 *
 * ## Why a future Stripe module can depend on this without knowing internals
 * Every input below is already-decided domain state Module 70 is not
 * expected to (and must not) re-derive itself:
 *   - `releaseStatus` — Module 66's single authoritative release decision
 *     (`payment-release-decision.ts`), never Job.status or Payment.status
 *     read directly (Invariant 12).
 *   - `kycKycEligible`/`payoutHoldActive` — Module 59/65's own eligibility
 *     and Trust & Integrity hold checks, never re-implemented here.
 *   - `financiallyConsistent`/`recognizedPayableAmount` — Module 69's own
 *     reconciliation (`financial-reconciliation.ts`) and the append-only
 *     ledger, never a live balance computed ad hoc.
 * A future Stripe module reads this function's OUTPUT only — it never
 * needs to know what a `Commission`, `Transaction`, `DisputeResolutionDecision`,
 * or `TrustAutomatedAction` even is.
 *
 * ## Status vocabulary (Section 24 — reusing existing vocabulary, not
 * inventing new statuses)
 * - `financial_inconsistency` — the reconciliation service found a problem
 *   with this Payment's ledger chain. Always checked FIRST and always wins
 *   over every other input — per this module's safety rule ("when
 *   uncertain... prefer the financially safe behavior"), an inconsistent
 *   financial chain must never be judged payable no matter what the release/
 *   KYC/trust state says.
 * - `denied` — Module 66 permanently denied release for this Payment
 *   (`RELEASE_DENIED` — job cancelled, payment never captured, or fully
 *   refunded). Never reachable back to `eligible` for this same Payment.
 * - `held` — an explicit block: a Trust & Integrity payout hold is active
 *   (checked before anything else below it, per Section 11's "a payout hold
 *   MUST NOT be bypassed" requirement — this is deliberately NOT
 *   overridable by any other input here), or Module 66's release decision
 *   is `RELEASE_HELD` (open dispute, confirmation timeout under review,
 *   etc).
 * - `pending` — no release decision exists yet (the professional hasn't
 *   even completed/had the job confirmed), or KYC/payout eligibility is not
 *   yet approved. Distinct from `held`: nothing is actively *blocking* this,
 *   it just hasn't happened yet.
 * - `insufficient_balance` — every gate above passed, but the authoritative
 *   ledger-derived payable amount, net of whatever has already been paid
 *   out, is zero or negative.
 * - `eligible` — every condition holds; `payableAmount` is the exact amount
 *   a future Stripe module may transfer, never a figure it re-derives
 *   itself.
 */
export type PayoutReadinessStatus =
  | "eligible"
  | "pending"
  | "held"
  | "denied"
  | "insufficient_balance"
  | "financial_inconsistency";

export interface PayoutReadinessInput {
  /** `null` when no `JobCompletionConfirmation` exists yet for this Job. */
  releaseStatus: PaymentReleaseStatus | null;
  /** From `CheckPayoutEligibilityUseCase` (Module 59 — Persona KYC). */
  kycEligible: boolean;
  /** An ACTIVE Module 65 `PAYOUT_HOLD` `TrustAutomatedAction` exists for
   *  this professional's User. */
  payoutHoldActive: boolean;
  /** From `PaymentReconciliationReport.consistent` — `false` if any
   *  `ReconciliationIssueCode` was found for this Payment. */
  financiallyConsistent: boolean;
  /** From `PaymentReconciliationReport.amountPayableToProfessional` — the
   *  authoritative, ledger-derived net amount recognized as owed for this
   *  Payment, `null` if nothing has been recognized yet (no
   *  `PROFESSIONAL_NET_EARNING` entry). */
  recognizedPayableAmount: number | null;
  /** Sum already paid out to this professional across every `PAID` Payout
   *  — see this module's own doc comment on why this is only trackable at
   *  the professional-aggregate level, not per-Payment, given the existing
   *  `Payout` schema. Always `0` until a real payout provider exists to
   *  ever create a `PAID` Payout row. */
  amountAlreadyPaidOut: number;
}

export interface PayoutReadinessDecision {
  status: PayoutReadinessStatus;
  /** The exact amount a future payout provider may transfer — always `0`
   *  for every status except `eligible`. Never negative. */
  payableAmount: number;
  reason: string;
}

export function decidePayoutReadiness(input: PayoutReadinessInput): PayoutReadinessDecision {
  if (!input.financiallyConsistent) {
    return {
      status: "financial_inconsistency",
      payableAmount: 0,
      reason: "This payment's financial ledger chain has an unresolved inconsistency — payout is blocked until it is investigated and (if needed) corrected with a new, explicit ledger entry. See ReconcilePaymentUseCase.",
    };
  }

  if (input.releaseStatus === "RELEASE_DENIED") {
    return {
      status: "denied",
      payableAmount: 0,
      reason: "Payment release was permanently denied for this job (cancelled, never captured, or fully refunded) — no payout is due.",
    };
  }

  // Trust & Integrity payout hold — checked before every other block/pending
  // condition below, and never overridable by any of them. See Section 11.
  if (input.payoutHoldActive) {
    return {
      status: "held",
      payableAmount: 0,
      reason: "A Trust & Integrity payout hold is active on this professional's account.",
    };
  }

  if (input.releaseStatus === "RELEASE_HELD") {
    return {
      status: "held",
      payableAmount: 0,
      reason: "Payment release is currently held — see the underlying JobCompletionConfirmation.releaseReason for the specific blocking condition (dispute, confirmation timeout under review, etc).",
    };
  }

  if (input.releaseStatus === null) {
    return {
      status: "pending",
      payableAmount: 0,
      reason: "No payment-release decision exists yet for this job — the professional has not completed it, or it has not yet been confirmed.",
    };
  }

  if (!input.kycEligible) {
    return {
      status: "pending",
      payableAmount: 0,
      reason: "Identity verification (KYC) is not yet approved for this professional.",
    };
  }

  if (input.releaseStatus !== "RELEASE_APPROVED") {
    // Defensive — every other PaymentReleaseStatus value is handled above;
    // this is unreachable given the current three-value union, kept as an
    // explicit fail-safe rather than falling through to `eligible`.
    return {
      status: "pending",
      payableAmount: 0,
      reason: `Payment release status (${input.releaseStatus}) does not yet permit payout.`,
    };
  }

  const payable = (input.recognizedPayableAmount ?? 0) - input.amountAlreadyPaidOut;
  if (input.recognizedPayableAmount === null || payable <= 0) {
    return {
      status: "insufficient_balance",
      payableAmount: 0,
      reason:
        input.recognizedPayableAmount === null
          ? "No earnings have been recognized for this payment yet (no PROFESSIONAL_NET_EARNING ledger entry)."
          : "The recognized payable amount, net of what has already been paid out, is zero or less.",
    };
  }

  return {
    status: "eligible",
    payableAmount: payable,
    reason: "All payout readiness conditions are satisfied.",
  };
}
