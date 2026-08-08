/**
 * Feature Flags module.
 *
 * The domain model for runtime feature flags — plain, JSON-safe types with
 * no behaviour (same convention as `search-document.ts`/
 * `analytics-dashboard.ts`): a flag definition is a value that gets stored,
 * transported, and evaluated by pure functions in
 * `domain/services/feature-flag-evaluator.ts`, never a class with its own
 * methods.
 *
 * Deliberately depends on nothing outside `core/domain` — in particular,
 * `FeatureFlagTargeting.roleAllowList` is typed as `readonly string[]`,
 * not `RoleKey[]` (`infrastructure/auth/rbac.ts`), because the domain
 * layer must not import from infrastructure. The application layer
 * (`application/services/feature-flags/feature-flag-service.ts`) is the
 * seam where `RoleKey` values get passed in as plain strings — `RoleKey`
 * is itself a string union, so it's always a valid `string`.
 */

/** Mirrors `env.NODE_ENV`'s three values (`infrastructure/config/env.ts`) —
 *  the codebase's one existing notion of "environment". No separate
 *  environment concept is introduced for this module. */
export type FeatureFlagEnvironment = "development" | "test" | "production";

export const FEATURE_FLAG_ENVIRONMENTS: readonly FeatureFlagEnvironment[] = [
  "development",
  "test",
  "production",
];

/**
 * Deterministic percentage rollout. `percentage` is the share (0-100
 * inclusive) of the stable identifier space (see `feature-flag-rollout.ts`)
 * that evaluates to enabled. 0 and 100 are valid and meaningful (0 = rolled
 * back to nobody without touching `enabled`/deleting the flag; 100 = fully
 * rolled out, kept for the audit trail/history of how it got there).
 */
export interface FeatureFlagRolloutConfig {
  readonly percentage: number;
}

/**
 * Explicit targeting. Deny takes precedence over allow (see
 * `feature-flag-evaluator.ts`) — an operator emergency-excluding a specific
 * user must always win over any allow-list/rollout that would otherwise
 * include them. `roleAllowList` reuses whatever role keys
 * `infrastructure/auth/rbac.ts`'s `ROLES` defines today — this module adds
 * no roles of its own.
 */
export interface FeatureFlagTargeting {
  readonly userAllowList?: readonly string[];
  readonly userDenyList?: readonly string[];
  readonly roleAllowList?: readonly string[];
}

/**
 * Optional multivariate split. When present, a flag that evaluates to
 * enabled also resolves to exactly one of `variants` (chosen by the same
 * deterministic hash as the percentage rollout, on a second, independent
 * salt — see `feature-flag-rollout.ts`), instead of the implicit boolean
 * on/off. Weights don't need to sum to 100; they're normalized at
 * evaluation time.
 */
export interface FeatureFlagVariant {
  readonly name: string;
  readonly weight: number;
}

/**
 * A complete flag definition, as stored by a `FeatureFlagProvider`
 * (`application/ports/feature-flag-provider.ts`) and consumed by
 * `evaluateFeatureFlag` (`domain/services/feature-flag-evaluator.ts`).
 *
 * `key` is the stable, human-readable identifier every call site
 * evaluates by (e.g. `"new-dashboard-ui"`) — never a database id, so it
 * reads the same in code, config, and audit log metadata.
 */
export interface FeatureFlagDefinition {
  readonly key: string;
  readonly description?: string;
  /** Base enabled state before any targeting/rollout rule is applied. A
   *  flag with `enabled: false` never reaches a user regardless of
   *  rollout/targeting — those only ever narrow an enabled flag further,
   *  never widen a disabled one. */
  readonly enabled: boolean;
  /** Global-scoped, per-flag emergency override. When `true`, this flag
   *  evaluates to disabled for every context, unconditionally — it is
   *  checked before every other rule, including explicit user allow-lists.
   *  See also the process-wide kill switch
   *  (`FEATURE_FLAGS_ENABLED`/`FeatureFlagService`'s `isGloballyDisabled`),
   *  which forces *every* flag off at once; this field is the single-flag
   *  equivalent. */
  readonly killSwitch?: boolean;
  /** Restricts which environment(s) this flag may ever be enabled in. A
   *  flag evaluated in an environment not listed here always evaluates to
   *  disabled. `undefined`/empty means "every environment" — not
   *  "production only" — so existing flags that never set this keep their
   *  current behaviour if this field is added later. */
  readonly environments?: readonly FeatureFlagEnvironment[];
  readonly rollout?: FeatureFlagRolloutConfig;
  readonly targeting?: FeatureFlagTargeting;
  readonly variants?: readonly FeatureFlagVariant[];
  /** Free-form, non-evaluated metadata (owner team, ticket link, rollout
   *  plan notes, ...) — never read by the evaluator, only ever surfaced to
   *  an admin UI/audit log. */
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly updatedAt?: string;
}

/** Everything the evaluator needs to know about the caller. `userId` is
 *  the stable identifier percentage rollouts hash on — without it, a
 *  percentage-rollout flag can never resolve to enabled (see
 *  `feature-flag-evaluator.ts`), because there is no stable identity to
 *  bucket. `environment` defaults to the process's own `env.NODE_ENV` when
 *  omitted (set by `FeatureFlagService`, not by the evaluator itself, to
 *  keep the evaluator a pure function of its arguments). */
export interface FeatureFlagEvaluationContext {
  readonly userId?: string;
  readonly roles?: readonly string[];
  readonly environment?: FeatureFlagEnvironment;
  readonly attributes?: Readonly<Record<string, string | number | boolean>>;
}

/** Why `evaluate()` returned what it returned — surfaced for debugging/
 *  admin visibility, never used by callers to branch (callers use
 *  `enabled`/`variant`). */
export type FeatureFlagEvaluationReason =
  | "GLOBAL_KILL_SWITCH"
  | "UNKNOWN_FLAG"
  | "FLAG_KILL_SWITCH"
  | "FLAG_DISABLED"
  | "ENVIRONMENT_SCOPED"
  | "USER_DENY_LIST"
  | "USER_ALLOW_LIST"
  | "ROLE_TARGETED"
  | "PERCENTAGE_ROLLOUT"
  | "DEFAULT_ENABLED"
  | "ERROR_FALLBACK";

export interface FeatureFlagEvaluationResult {
  readonly key: string;
  readonly enabled: boolean;
  readonly variant?: string;
  readonly reason: FeatureFlagEvaluationReason;
}

/** Fail-closed default returned whenever a flag can't be meaningfully
 *  evaluated (unknown key, provider error, ...) — see requirement that
 *  evaluation must never throw and must default to "off". */
export function unknownFlagResult(key: string): FeatureFlagEvaluationResult {
  return { key, enabled: false, reason: "UNKNOWN_FLAG" };
}
