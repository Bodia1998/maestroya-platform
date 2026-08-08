import type {
  FeatureFlagDefinition,
  FeatureFlagEvaluationContext,
  FeatureFlagEvaluationResult,
} from "@/domain/entities/feature-flag";
import { hashToBucket, isInRolloutPercentage, pickVariant } from "@/domain/services/feature-flag-rollout";

/**
 * Feature Flags module — the evaluation rule engine.
 *
 * A pure function (same convention as `ranking-engine.ts`/
 * `spam-detection.ts`): no I/O, no provider lookups, no logging — just
 * `(definition, context) -> result`. `FeatureFlagService`
 * (`application/services/feature-flags/feature-flag-service.ts`) is the
 * only caller, and is the layer responsible for fetching the definition,
 * applying the process-wide kill switch, and catching anything this
 * function might still manage to throw (it shouldn't, by construction,
 * but the service wraps it anyway — see that file's own doc comment).
 *
 * Precedence, most to least specific (each rule below can only ever
 * *narrow* an enabled flag toward disabled, or grant an explicit
 * exception back to enabled — never both at once for the same input):
 *
 *  1. Flag-level kill switch (`definition.killSwitch`) — always disabled.
 *  2. `definition.enabled === false` — always disabled.
 *  3. Environment scoping — disabled if the flag doesn't apply here.
 *  4. User deny-list — disabled, even if also on the allow-list (an
 *     explicit exclusion is a stronger signal than an explicit inclusion;
 *     an operator emergency-blocking one user must win regardless of what
 *     else targets them).
 *  5. User allow-list — enabled, bypassing rollout percentage entirely.
 *  6. Role allow-list — enabled, bypassing rollout percentage entirely.
 *  7. Percentage rollout, if configured — deterministic per-user bucket.
 *  8. No rollout configured — the base `enabled: true` applies to
 *     everyone.
 *
 * The caller-supplied global kill switch
 * (`FEATURE_FLAGS_ENABLED`/`FeatureFlagService`) and "unknown flag key"
 * case are deliberately **not** handled here — both are checked by
 * `FeatureFlagService` before this function is even called, since neither
 * needs a `FeatureFlagDefinition` to decide (see
 * `domain/entities/feature-flag.ts`'s `unknownFlagResult`).
 */
export function evaluateFeatureFlag(
  definition: FeatureFlagDefinition,
  context: FeatureFlagEvaluationContext,
): FeatureFlagEvaluationResult {
  const key = definition.key;

  if (definition.killSwitch) {
    return { key, enabled: false, reason: "FLAG_KILL_SWITCH" };
  }

  if (!definition.enabled) {
    return { key, enabled: false, reason: "FLAG_DISABLED" };
  }

  if (definition.environments && definition.environments.length > 0) {
    const environment = context.environment;
    if (!environment || !definition.environments.includes(environment)) {
      return { key, enabled: false, reason: "ENVIRONMENT_SCOPED" };
    }
  }

  const targeting = definition.targeting;
  const userId = context.userId;

  if (targeting?.userDenyList && userId && targeting.userDenyList.includes(userId)) {
    return { key, enabled: false, reason: "USER_DENY_LIST" };
  }

  if (targeting?.userAllowList && userId && targeting.userAllowList.includes(userId)) {
    return { key, enabled: true, variant: resolveVariant(definition, userId), reason: "USER_ALLOW_LIST" };
  }

  if (targeting?.roleAllowList && targeting.roleAllowList.length > 0) {
    const roles = context.roles ?? [];
    const hasTargetedRole = roles.some((role) => targeting.roleAllowList?.includes(role));
    if (hasTargetedRole) {
      // Fall back to the flag key itself as the hash identity when no
      // userId is present, so role-targeted variant assignment is still
      // deterministic per-flag rather than throwing/omitting a variant —
      // this is a coarser identity (every anonymous role-matched caller
      // gets the same variant) but never wrong or non-deterministic.
      return {
        key,
        enabled: true,
        variant: resolveVariant(definition, userId ?? key),
        reason: "ROLE_TARGETED",
      };
    }
  }

  if (definition.rollout) {
    // A percentage rollout with no stable identifier to hash on cannot be
    // meaningfully evaluated per-user — fail closed rather than either
    // enabling for everyone (defeats the rollout) or throwing.
    if (!userId) {
      return { key, enabled: false, reason: "PERCENTAGE_ROLLOUT" };
    }
    const included = isInRolloutPercentage(key, userId, definition.rollout.percentage);
    return {
      key,
      enabled: included,
      variant: included ? resolveVariant(definition, userId) : undefined,
      reason: "PERCENTAGE_ROLLOUT",
    };
  }

  return { key, enabled: true, variant: resolveVariant(definition, userId ?? key), reason: "DEFAULT_ENABLED" };
}

function resolveVariant(definition: FeatureFlagDefinition, stableId: string): string | undefined {
  if (!definition.variants || definition.variants.length === 0) return undefined;
  return pickVariant(definition.key, stableId, definition.variants);
}

/** Exposed for tests only. */
export const __testing = { hashToBucket };
