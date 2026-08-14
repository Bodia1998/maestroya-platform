import { deriveEscalationTier, type RiskEscalationTier } from "@/domain/services/risk-score-policy";
import type { TrustAutomatedActionTypeValue } from "@/domain/repositories/trust-automated-action-repository";

/**
 * Module 65 — Trust & Integrity System: requirement #15 — "Automatic
 * Actions ... All actions must be configurable." This is the single place
 * that turns a Risk Score escalation tier (`risk-score-policy.ts`) plus a
 * small amount of repeat-offender context into a concrete
 * `TrustAutomatedActionType` — a closed decision table, not an ad hoc
 * chain of `if`s scattered across the various `Detect*UseCase`s, so every
 * detector (off-platform, fraud, spam, ...) produces a consistent
 * consequence for the same escalation tier.
 *
 * "Configurable" here means `ActionPolicyConfig` — every threshold and the
 * tier -> action mapping itself is a plain object a caller can override
 * (e.g. from `PlatformSetting`, mirroring `CommissionRateRepository`'s own
 * "read from DB, fall back to this default" shape) rather than a hardcoded
 * switch statement.
 */

export interface ActionPolicyConfig {
  /** Tier -> action mapping for a first-time escalation into that tier. */
  firstOffense: Readonly<Record<Exclude<RiskEscalationTier, "NONE">, TrustAutomatedActionTypeValue>>;
  /** Tier -> action mapping once `priorActiveActionsForUser` (see
   *  `decideAutomatedAction`) shows this user already has an active
   *  action at or above the same tier — repeat offenders within the
   *  `MANUAL_REVIEW`/`SUSPENSION` tiers escalate to a harsher action
   *  rather than repeating the same one indefinitely. */
  repeatOffense: Readonly<Record<Exclude<RiskEscalationTier, "NONE">, TrustAutomatedActionTypeValue>>;
}

export const DEFAULT_ACTION_POLICY_CONFIG: ActionPolicyConfig = {
  firstOffense: {
    WARNING: "WARNING",
    RESTRICTION: "TEMPORARY_RESTRICTION",
    MANUAL_REVIEW: "MANUAL_REVIEW",
    SUSPENSION: "TEMPORARY_SUSPENSION",
  },
  repeatOffense: {
    WARNING: "TEMPORARY_RESTRICTION",
    RESTRICTION: "MANUAL_REVIEW",
    MANUAL_REVIEW: "TEMPORARY_SUSPENSION",
    SUSPENSION: "PERMANENT_SUSPENSION",
  },
};

export interface AutomatedActionDecision {
  tier: RiskEscalationTier;
  action: TrustAutomatedActionTypeValue | null;
  isRepeatOffense: boolean;
}

/**
 * Decides which automated action (if any) applies for `riskScore`, given
 * how many of this user's own past `TrustAutomatedAction`s are still
 * `ACTIVE` at the same tier or higher (`priorActiveActionsForUser`,
 * gathered by the calling use case via `TrustAutomatedActionRepository`).
 * `action` is `null` when the tier is `NONE` — no action is ever taken for
 * a Risk Score below the `WARNING` threshold.
 */
export function decideAutomatedAction(
  riskScore: number,
  priorActiveActionsForUser: number,
  config: ActionPolicyConfig = DEFAULT_ACTION_POLICY_CONFIG,
): AutomatedActionDecision {
  const tier = deriveEscalationTier(riskScore);
  if (tier === "NONE") {
    return { tier, action: null, isRepeatOffense: false };
  }

  const isRepeatOffense = priorActiveActionsForUser > 0;
  const action = isRepeatOffense ? config.repeatOffense[tier] : config.firstOffense[tier];
  return { tier, action, isRepeatOffense };
}

/** Requirement #13's own architecture-only payout hold: `PAYMENT_ABUSE_DETECTED`
 *  findings always request a `PAYOUT_HOLD` regardless of tier, since
 *  holding a payout is the one action cheap enough to apply defensively
 *  even before a full manual review concludes — reversed automatically if
 *  the review clears the account (see `apply-automated-action.use-case.ts`). */
export function requiresPayoutHold(reason: string): boolean {
  return reason === "PAYMENT_ABUSE_DETECTED";
}
