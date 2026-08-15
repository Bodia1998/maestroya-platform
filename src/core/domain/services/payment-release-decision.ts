import type { JobStatusValue } from "@/domain/repositories/job-repository";
import type { PaymentStatusValue } from "@/domain/repositories/payment-repository";
import type { JobCompletionConfirmationStatus } from "./job-completion-confirmation-state";

/**
 * Module 66 — Job Completion & Payment Release Protection: the single
 * authoritative rule for whether a professional's payout for a Job's
 * captured Payment may be released. Every place in the codebase that ever
 * needs to know "is this payout allowed" — today's
 * `EvaluatePaymentReleaseUseCase`, and every future Stripe Connect payout
 * trigger (Module 67+) — MUST go through this function (via that use
 * case). No other file is allowed to duplicate this decision.
 *
 * ## Why this exists (the core safety property of Module 66)
 * None of the following, alone or in combination with any subset of the
 * others, is sufficient to approve a release:
 *   - the professional marked the Job COMPLETED
 *   - `Payment.status === "CAPTURED"`
 *   - the professional's KYC/identity verification is APPROVED
 * `RELEASE_APPROVED` requires **all** of: Job completed, customer
 * confirmed (never inferred from silence — see
 * job-completion-confirmation-rules.ts's own doc comment), Payment
 * actually captured (and not fully refunded), no blocking dispute, no
 * Trust & Integrity payout hold, and payout (KYC) eligibility.
 *
 * ## Outcomes
 * - `RELEASE_APPROVED` — every condition holds; funds may be released.
 * - `RELEASE_HELD` — currently blocked, but could still resolve to
 *   approved later (waiting on the customer, an open dispute, a payout
 *   hold, pending KYC, a timeout under manual review). Re-evaluating
 *   later, once the blocking condition clears, can move this to
 *   `RELEASE_APPROVED` — see `EvaluatePaymentReleaseUseCase`.
 * - `RELEASE_DENIED` — permanently blocked for this Job/Payment as
 *   currently understood (the Job was cancelled, or the Payment was never
 *   captured / was fully refunded). Never reachable back to `RELEASE_
 *   APPROVED` without a new Payment/Job existing, which this module does
 *   not create.
 *
 * Pure function — no I/O, no Prisma, no Stripe, no event bus. The calling
 * use case is responsible for gathering every input field from the
 * relevant repositories/use cases (Job, JobCompletionConfirmation,
 * Dispute, Payment, CheckPayoutEligibilityUseCase, Trust & Integrity's
 * TrustAutomatedActionRepository) and for persisting/publishing the
 * result — this function only decides.
 */
export interface PaymentReleaseDecisionInput {
  jobStatus: JobStatusValue;
  /** `null` when the Job has no JobCompletionConfirmation row yet (i.e.
   *  the professional has not completed it). */
  confirmationStatus: JobCompletionConfirmationStatus | null;
  /** Whether any Dispute on this Job is still open (status !== CLOSED).
   *  Deliberately conservative — even a RESOLVED-but-not-yet-CLOSED
   *  dispute blocks release, since Module 68's financial-adjustment
   *  outcome has not necessarily been applied/settled yet. An admin
   *  closing the dispute (Module 21's existing CloseDisputeUseCase) is
   *  what clears this on the next re-evaluation. */
  hasBlockingDispute: boolean;
  /** `null` when no Payment exists yet for this Job. */
  paymentStatus: PaymentStatusValue | null;
  /** From `CheckPayoutEligibilityUseCase` — professional KYC/identity
   *  verification approved. */
  payoutEligible: boolean;
  /** An ACTIVE Module 65 `PAYOUT_HOLD` TrustAutomatedAction exists for the
   *  receiving professional's User. */
  payoutHoldActive: boolean;
  /**
   * Admin-only override — set exclusively by
   * `AdminResolvePaymentReleaseUseCase` after a human has explicitly
   * concluded a DISPUTED or TIMED_OUT_UNDER_REVIEW investigation in the
   * professional's favor (a closed Dispute, or a resolved
   * ManualReviewCase — see that use case's own doc comment for the exact
   * precondition it enforces before ever setting this). When `true`, a
   * DISPUTED/TIMED_OUT_UNDER_REVIEW `confirmationStatus` is treated the
   * same as CONFIRMED for the purposes of this decision — but every
   * OTHER condition below (payment captured, no *other* blocking dispute,
   * payout hold, KYC eligibility) still applies unchanged. This exists
   * because `confirmationStatus` is intentionally a one-shot, terminal
   * fact (see job-completion-confirmation-state.ts's own doc comment) —
   * without this escape hatch, a manually-investigated-and-cleared case
   * could never reach RELEASE_APPROVED through this same, single
   * authoritative function. Defaults to `false`; every non-admin caller
   * (`EvaluatePaymentReleaseUseCase`'s normal automatic re-evaluation)
   * always passes `false`.
   */
  adminOverrideConfirmed?: boolean;
}

export type PaymentReleaseStatus = "RELEASE_APPROVED" | "RELEASE_HELD" | "RELEASE_DENIED";

export interface PaymentReleaseDecision {
  status: PaymentReleaseStatus;
  reason: string;
}

const PAYMENT_DENIAL_STATUSES: ReadonlySet<PaymentStatusValue> = new Set(["FAILED", "CANCELLED", "REFUNDED"]);

export function decidePaymentReleaseStatus(input: PaymentReleaseDecisionInput): PaymentReleaseDecision {
  // --- Permanent denials first — never reachable back to approved. ---
  if (input.jobStatus === "CANCELLED") {
    return { status: "RELEASE_DENIED", reason: "The job was cancelled; no payout is due." };
  }

  if (input.paymentStatus === null) {
    return { status: "RELEASE_DENIED", reason: "No payment exists for this job yet." };
  }

  if (PAYMENT_DENIAL_STATUSES.has(input.paymentStatus)) {
    return {
      status: "RELEASE_DENIED",
      reason: `The payment is ${input.paymentStatus.toLowerCase()} — no payout is due.`,
    };
  }

  // --- Everything below requires the payment to have actually captured
  //     funds (CAPTURED or PARTIALLY_REFUNDED — some amount may still be
  //     due to the professional net of the partial refund; the exact
  //     payout amount is a Module 67/Stripe concern, not this decision's). ---
  if (input.paymentStatus !== "CAPTURED" && input.paymentStatus !== "PARTIALLY_REFUNDED") {
    return {
      status: "RELEASE_HELD",
      reason: `The payment has not been captured yet (current status: ${input.paymentStatus}).`,
    };
  }

  if (input.jobStatus !== "COMPLETED" || input.confirmationStatus === null) {
    return { status: "RELEASE_HELD", reason: "The job has not been marked completed by the professional yet." };
  }

  if (input.hasBlockingDispute) {
    return { status: "RELEASE_HELD", reason: "An open dispute is blocking release of this payout." };
  }

  switch (input.confirmationStatus) {
    case "DISPUTED":
      if (!input.adminOverrideConfirmed) {
        return { status: "RELEASE_HELD", reason: "The customer disputed the completed service." };
      }
      break; // admin-reviewed and cleared — fall through to the eligibility checks below
    case "TIMED_OUT_UNDER_REVIEW":
      if (!input.adminOverrideConfirmed) {
        return {
          status: "RELEASE_HELD",
          reason: "The customer did not respond within the confirmation window; this job is under manual review.",
        };
      }
      break; // admin-reviewed and cleared — fall through to the eligibility checks below
    case "WAITING_FOR_CUSTOMER":
      return { status: "RELEASE_HELD", reason: "Waiting for the customer to confirm the completed service." };
    case "CONFIRMED":
      break; // fall through to the eligibility checks below
  }

  if (input.payoutHoldActive) {
    return {
      status: "RELEASE_HELD",
      reason: "A Trust & Integrity payout hold is active on the professional's account.",
    };
  }

  if (!input.payoutEligible) {
    return {
      status: "RELEASE_HELD",
      reason: "The professional is not yet eligible for payout (identity verification not approved).",
    };
  }

  return { status: "RELEASE_APPROVED", reason: "All release conditions are satisfied." };
}
