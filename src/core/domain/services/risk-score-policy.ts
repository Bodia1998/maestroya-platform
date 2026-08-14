import { clampScore } from "@/domain/value-objects/trust-risk-score";
import type { TrustRiskEventReasonValue } from "@/domain/services/trust-score-policy";

/**
 * Module 65 — Trust & Integrity System: pure business rules for how a
 * user's Risk Score (0-100, higher = more dangerous) moves, and — the
 * module's other central requirement — the closed mapping from a Risk
 * Score band to the escalation tier (`warning` / `restriction` /
 * `suspension` / `manual review` / `appeal`) named explicitly in the
 * module brief. Every threshold below is a named constant, never an
 * inline magic number, so `RISK_SCORE_THRESHOLDS` is the one place a
 * future admin console would retune escalation sensitivity.
 */

export const DEFAULT_RISK_SCORE = 0;

/** Mirrors `TRUST_SCORE_DELTA_TABLE` — same reasons, opposite polarity:
 *  every reason that lowers trust raises risk by (at least roughly) the
 *  same magnitude, and vice versa. Kept as an independent table (not
 *  derived via `-delta`) so the two can be retuned independently — e.g. a
 *  `FRAUD_SIGNAL_DETECTED` might deserve a bigger risk bump than the trust
 *  hit it causes. */
export const RISK_SCORE_DELTA_TABLE: Readonly<Record<TrustRiskEventReasonValue, number>> = {
  ACCOUNT_VERIFIED: -5,
  POSITIVE_REVIEW_RECEIVED: -1,
  JOB_COMPLETED_SUCCESSFULLY: -1,
  CLEAN_HISTORY_DECAY: -1,
  OFF_PLATFORM_SIGNAL_DETECTED: 12,
  FRAUD_SIGNAL_DETECTED: 30,
  FAKE_REVIEW_PATTERN_DETECTED: 18,
  SPAM_ACTIVITY_DETECTED: 12,
  SUSPICIOUS_PRICING_DETECTED: 12,
  BOOKING_ABUSE_DETECTED: 18,
  PAYMENT_ABUSE_DETECTED: 25,
  IDENTITY_RISK_DETECTED: 22,
  MANUAL_REVIEW_CONFIRMED: 35,
  APPEAL_APPROVED: -20,
  ADMIN_ADJUSTMENT: 0,
};

export interface RiskScoreRecalculation {
  scoreBefore: number;
  delta: number;
  scoreAfter: number;
}

export function recalculateRiskScore(
  currentScore: number,
  reason: TrustRiskEventReasonValue,
  deltaOverride?: number,
): RiskScoreRecalculation {
  const delta = deltaOverride ?? RISK_SCORE_DELTA_TABLE[reason];
  const scoreBefore = clampScore(currentScore);
  const scoreAfter = clampScore(scoreBefore + delta);
  return { scoreBefore, delta: scoreAfter - scoreBefore, scoreAfter };
}

export type RiskEscalationTier = "NONE" | "WARNING" | "RESTRICTION" | "MANUAL_REVIEW" | "SUSPENSION";

/**
 * The score bands that decide escalation tier — a closed, ordered table
 * rather than a chain of inline `if` comparisons, so
 * `deriveEscalationTier` and this module's report generator both read the
 * exact same thresholds. Every band is a lower-bound (inclusive); a score
 * lands in the highest band it meets or exceeds.
 */
export const RISK_SCORE_THRESHOLDS: Readonly<Record<Exclude<RiskEscalationTier, "NONE">, number>> = {
  WARNING: 30,
  RESTRICTION: 50,
  MANUAL_REVIEW: 70,
  SUSPENSION: 85,
};

/**
 * Maps a Risk Score to the escalation tier the automated-action policy
 * (`trust-integrity-action-policy.ts`) should apply. Purely a function of
 * the score itself — `trust-integrity-action-policy.ts` layers additional
 * context (repeat-offender count, whether this is a first-time signal) on
 * top of this before deciding the concrete `TrustAutomatedActionType`.
 */
export function deriveEscalationTier(riskScore: number): RiskEscalationTier {
  const score = clampScore(riskScore);
  if (score >= RISK_SCORE_THRESHOLDS.SUSPENSION) return "SUSPENSION";
  if (score >= RISK_SCORE_THRESHOLDS.MANUAL_REVIEW) return "MANUAL_REVIEW";
  if (score >= RISK_SCORE_THRESHOLDS.RESTRICTION) return "RESTRICTION";
  if (score >= RISK_SCORE_THRESHOLDS.WARNING) return "WARNING";
  return "NONE";
}

/** Every escalation tier at or above `RESTRICTION` entitles the affected
 *  user to submit an appeal (see requirement #17) — `WARNING` alone does
 *  not, since no restrictive action was actually taken. */
export function isAppealable(tier: RiskEscalationTier): boolean {
  return tier === "RESTRICTION" || tier === "MANUAL_REVIEW" || tier === "SUSPENSION";
}
