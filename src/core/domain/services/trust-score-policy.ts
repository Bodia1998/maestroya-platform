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
  | "ADMIN_ADJUSTMENT";

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
