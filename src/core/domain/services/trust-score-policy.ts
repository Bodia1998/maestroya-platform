import { clampScore } from "@/domain/value-objects/trust-risk-score";

/**
 * Module 65 — Trust & Integrity System: pure business rules for how a
 * user's Trust Score (0-100, higher = more trustworthy) moves in response
 * to a behavioural event. Deliberately a closed, named table of deltas
 * (never an arbitrary caller-supplied number) — same "business rules
 * instead of arbitrary values" requirement this module's brief states
 * explicitly for the Risk Score, applied symmetrically here. Every
 * delta below is a starting default; `deltaOverrides` lets a future admin
 * console retune a single reason without touching this file, the same
 * "configurable, not hardcoded" shape `commission-policy.ts`'s
 * `commissionRateBps` already establishes.
 */

export const DEFAULT_TRUST_SCORE = 70;

export type TrustRiskEventReasonValue =
  | "ACCOUNT_VERIFIED"
  | "POSITIVE_REVIEW_RECEIVED"
  | "JOB_COMPLETED_SUCCESSFULLY"
  | "CLEAN_HISTORY_DECAY"
  | "OFF_PLATFORM_SIGNAL_DETECTED"
  | "FRAUD_SIGNAL_DETECTED"
  | "FAKE_REVIEW_PATTERN_DETECTED"
  | "SPAM_ACTIVITY_DETECTED"
  | "SUSPICIOUS_PRICING_DETECTED"
  | "BOOKING_ABUSE_DETECTED"
  | "PAYMENT_ABUSE_DETECTED"
  | "IDENTITY_RISK_DETECTED"
  | "MANUAL_REVIEW_CONFIRMED"
  | "APPEAL_APPROVED"
  | "ADMIN_ADJUSTMENT"
  /** Module 66 — Job Completion & Payment Release Protection: the customer
   *  confirmation window elapsed with no response. Deliberately scored 0
   *  below (see TRUST_SCORE_DELTA_TABLE) — a non-response is not, by
   *  itself, evidence of anything the professional or customer did wrong
   *  (the customer may simply be travelling), so it opens a
   *  ManualReviewCase (see ProcessJobCompletionConfirmationsUseCase) with
   *  `skipAutomatedAction: true` rather than moving either party's score
   *  or applying a TrustAutomatedAction automatically. */
  | "JOB_COMPLETION_CONFIRMATION_TIMEOUT"
  /** Module 67 — Trust & Integrity Completion Risk Detection: a Job was
   *  marked completed implausibly soon after work started (see
   *  premature-completion-detection-rules.ts). Scored the same, moderate
   *  magnitude as OFF_PLATFORM_SIGNAL_DETECTED — a real signal for human
   *  review, not the FRAUD_SIGNAL_DETECTED/PAYMENT_ABUSE_DETECTED tier
   *  reserved for confirmed or financially-dangerous findings (see
   *  detect-premature-job-completion.use-case.ts's own doc comment on this
   *  module's Trust & Integrity boundary). */
  | "PREMATURE_JOB_COMPLETION_DETECTED"
  /** Module 67 — Trust & Integrity Completion Risk Detection: a dispute was
   *  opened suspiciously soon after a Job was marked completed. Scored 0,
   *  mirroring JOB_COMPLETION_CONFIRMATION_TIMEOUT's own reasoning exactly
   *  — fault is genuinely ambiguous (could be a rushed/defective
   *  completion, or a customer gaming the confirmation flow; "a legitimate
   *  customer dispute is normal platform behavior" per this module's own
   *  brief), so this reason only ever opens a ManualReviewCase with
   *  `skipAutomatedAction: true`, never an automatic score movement or
   *  TrustAutomatedAction. See detect-job-completion-dispute-conflict.use-case.ts. */
  | "JOB_COMPLETION_DISPUTE_CONFLICT_DETECTED"
  /** Module 67 — Trust & Integrity Completion Risk Detection: a Job was
   *  marked completed while a Dispute was already open on it. Unlike
   *  JOB_COMPLETION_DISPUTE_CONFLICT_DETECTED above, this IS attributed to
   *  whoever completed the Job (a clearer signal — the open dispute was
   *  already visible platform-wide via EvaluatePaymentReleaseUseCase's own
   *  hasBlockingDispute check), so it is scored the same moderate
   *  magnitude as OFF_PLATFORM_SIGNAL_DETECTED / PREMATURE_JOB_COMPLETION_
   *  DETECTED above, not 0. */
  | "COMPLETION_DURING_ACTIVE_DISPUTE_DETECTED";

/** The default Trust Score delta for each reason. Positive reasons raise
 *  trust, negative/abuse reasons lower it. `ADMIN_ADJUSTMENT` is 0 here —
 *  an admin always supplies their own explicit delta for that reason (see
 *  `RecordTrustRiskAdjustmentUseCase`), this table only covers the
 *  automated reasons. */
export const TRUST_SCORE_DELTA_TABLE: Readonly<Record<TrustRiskEventReasonValue, number>> = {
  ACCOUNT_VERIFIED: 10,
  POSITIVE_REVIEW_RECEIVED: 3,
  JOB_COMPLETED_SUCCESSFULLY: 2,
  CLEAN_HISTORY_DECAY: 1,
  OFF_PLATFORM_SIGNAL_DETECTED: -8,
  FRAUD_SIGNAL_DETECTED: -25,
  FAKE_REVIEW_PATTERN_DETECTED: -15,
  SPAM_ACTIVITY_DETECTED: -10,
  SUSPICIOUS_PRICING_DETECTED: -10,
  BOOKING_ABUSE_DETECTED: -15,
  PAYMENT_ABUSE_DETECTED: -20,
  IDENTITY_RISK_DETECTED: -20,
  MANUAL_REVIEW_CONFIRMED: -30,
  APPEAL_APPROVED: 15,
  ADMIN_ADJUSTMENT: 0,
  JOB_COMPLETION_CONFIRMATION_TIMEOUT: 0,
  PREMATURE_JOB_COMPLETION_DETECTED: -8,
  JOB_COMPLETION_DISPUTE_CONFLICT_DETECTED: 0,
  COMPLETION_DURING_ACTIVE_DISPUTE_DETECTED: -8,
};

export interface TrustScoreRecalculation {
  scoreBefore: number;
  delta: number;
  scoreAfter: number;
}

/**
 * Computes the next Trust Score for a user given their current score, the
 * business reason for the change, and an optional caller-supplied override
 * (only ever used for `ADMIN_ADJUSTMENT`, where there is no default in the
 * table above). Clamped to [0, 100] — see `clampScore`.
 */
export function recalculateTrustScore(
  currentScore: number,
  reason: TrustRiskEventReasonValue,
  deltaOverride?: number,
): TrustScoreRecalculation {
  const delta = deltaOverride ?? TRUST_SCORE_DELTA_TABLE[reason];
  const scoreBefore = clampScore(currentScore);
  const scoreAfter = clampScore(scoreBefore + delta);
  return { scoreBefore, delta: scoreAfter - scoreBefore, scoreAfter };
}
