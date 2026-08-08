import type {
  FeatureFlagDefinition,
  FeatureFlagEvaluationContext,
  FeatureFlagEvaluationResult,
} from "@/domain/entities/feature-flag";
import { unknownFlagResult } from "@/domain/entities/feature-flag";
import { evaluateFeatureFlag } from "@/domain/services/feature-flag-evaluator";
import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import { ValidationError } from "@/domain/errors/domain-error";
import type { FeatureFlagProvider } from "@/application/ports/feature-flag-provider";
import { logger } from "@/infrastructure/observability/logger";

export interface FeatureFlagServiceOptions {
  /** Process-wide emergency override — see `env.FEATURE_FLAGS_ENABLED`
   *  (`infrastructure/config/env.ts`). Read as a function (not a plain
   *  boolean captured once) so a value read from `env` at request time
   *  reflects the current process env, the same pattern
   *  `CacheManager`'s `bypass` option uses for `CACHE_BYPASS_ENABLED`. */
  isGloballyDisabled: () => boolean;
  /** The environment `evaluate()` assumes when the caller's context
   *  doesn't specify one — normally `env.NODE_ENV`. */
  defaultEnvironment: () => FeatureFlagEvaluationContext["environment"];
}

/**
 * Feature Flags module — evaluation orchestration + admin-facing
 * read/write surface.
 *
 * This is the one entry point every call site in the codebase should use:
 *
 *  - `evaluate()`/`isEnabled()` for runtime checks at a feature's call
 *    site (an application service, a use case, a Server Component).
 *  - `listFlags()`/`getFlag()`/`updateFlag()` for a future admin
 *    API/UI layer (Module 16's Admin Panel — see this module's own docs
 *    for the extension point) — deliberately the same shape as
 *    `AdminRepository`'s read/list/update methods so wiring an admin
 *    Server Action here later is a copy of an existing pattern, not a new
 *    one.
 *
 * Fail-closed by construction: `evaluate()` catches anything the provider
 * lookup or the (already-pure, already-defensive) evaluator might still
 * throw and returns a disabled result rather than propagating — a broken
 * flag must never take down the feature it's supposed to gate. Evaluation
 * itself is never audit-logged (would be extremely high-volume noise on
 * every request); only definition *changes* — `updateFlag` — are, via the
 * existing `AdminAuditLogRepository` (Module 16), same trail
 * `ChangeUserRoleUseCase` and every other admin action write to.
 */
export class FeatureFlagService {
  constructor(
    private readonly provider: FeatureFlagProvider,
    private readonly auditLog: AdminAuditLogRepository,
    private readonly options: FeatureFlagServiceOptions,
  ) {}

  /**
   * Evaluates `key` for `context`. Never throws — any failure (provider
   * error, malformed stored definition) resolves to a disabled result
   * with `reason: "ERROR_FALLBACK"`, logged at `error` level so the
   * failure is still observable without breaking the caller.
   */
  async evaluate(key: string, context: FeatureFlagEvaluationContext = {}): Promise<FeatureFlagEvaluationResult> {
    try {
      if (this.options.isGloballyDisabled()) {
        return { key, enabled: false, reason: "GLOBAL_KILL_SWITCH" };
      }

      const definition = await this.provider.getDefinition(key);
      if (!definition) {
        return unknownFlagResult(key);
      }

      const resolvedContext: FeatureFlagEvaluationContext = {
        ...context,
        environment: context.environment ?? this.options.defaultEnvironment(),
      };

      return evaluateFeatureFlag(definition, resolvedContext);
    } catch (error) {
      logger.error("feature_flag.evaluation_failed", { key, error });
      return { key, enabled: false, reason: "ERROR_FALLBACK" };
    }
  }

  /** Convenience wrapper for the common "just give me a boolean" call
   *  site — equivalent to `(await evaluate(key, context)).enabled`. */
  async isEnabled(key: string, context: FeatureFlagEvaluationContext = {}): Promise<boolean> {
    const result = await this.evaluate(key, context);
    return result.enabled;
  }

  /** Admin-friendly read: every known flag definition, sorted by `key` for
   *  a stable, predictable listing (a future admin UI table, a CLI dump,
   *  ...). */
  async listFlags(): Promise<FeatureFlagDefinition[]> {
    const definitions = await this.provider.listDefinitions();
    return [...definitions].sort((a, b) => a.key.localeCompare(b.key));
  }

  /** Admin-friendly read: a single flag definition, or `null` if `key`
   *  doesn't exist. */
  async getFlag(key: string): Promise<FeatureFlagDefinition | null> {
    return this.provider.getDefinition(key);
  }

  /**
   * Admin-friendly write: creates `key` if it doesn't exist yet (`patch`
   * must then include `enabled`), or merges `patch` onto the existing
   * definition otherwise. Records an audit log entry — `adminUserId` is
   * always resolved server-side by the caller (a future admin Server
   * Action via `requireRole()`, the same convention every other admin
   * mutation in this codebase follows — see `rbac.ts`'s `requireRole`),
   * never trusted as caller input here.
   *
   * Recorded as `FEATURE_FLAG_KILL_SWITCH_TOGGLED` when `patch.killSwitch`
   * is present and differs from the previous value (the one change this
   * module's spec calls out for its own audit-log visibility), and as
   * `FEATURE_FLAG_UPDATED` for every other change — same "one action per
   * conceptually distinct mutation" convention `admin-audit-log-repository.ts`
   * documents for `USER_SUSPENDED` vs `USER_ROLE_CHANGED`.
   */
  async updateFlag(
    adminUserId: string | null,
    key: string,
    patch: Partial<Omit<FeatureFlagDefinition, "key">>,
  ): Promise<FeatureFlagDefinition> {
    const existing = await this.provider.getDefinition(key);

    if (!existing && patch.enabled === undefined) {
      throw new ValidationError(`Creating a new flag "${key}" requires an explicit "enabled" value.`);
    }

    const next: FeatureFlagDefinition = {
      ...existing,
      ...patch,
      key,
      updatedAt: new Date().toISOString(),
      enabled: patch.enabled ?? existing?.enabled ?? false,
    };

    const stored = await this.provider.upsertDefinition(next);

    const killSwitchChanged =
      patch.killSwitch !== undefined && patch.killSwitch !== (existing?.killSwitch ?? false);

    await this.auditLog.record({
      adminUserId,
      action: killSwitchChanged ? "FEATURE_FLAG_KILL_SWITCH_TOGGLED" : "FEATURE_FLAG_UPDATED",
      targetType: "FeatureFlag",
      targetId: key,
      metadata: {
        previous: existing ?? null,
        next: stored,
      },
    });

    return stored;
  }
}
