import "server-only";

import { FeatureFlagService } from "@/application/services/feature-flags/feature-flag-service";
import type { FeatureFlagEvaluationContext, FeatureFlagEvaluationResult } from "@/domain/entities/feature-flag";
import { PrismaAdminAuditLogRepository } from "@/infrastructure/database/prisma/repositories/prisma-admin-audit-log-repository";
import { env } from "@/infrastructure/config/env";
import { ConfigFeatureFlagProvider } from "@/infrastructure/feature-flags/config-feature-flag-provider";
import {
  DEFAULT_FEATURE_FLAG_DEFINITIONS,
  mergeFeatureFlagDefinitions,
  parseFeatureFlagsConfig,
} from "@/infrastructure/feature-flags/feature-flag-definitions";

/**
 * Feature Flags module — composition root.
 *
 * Same manual, no-DI-container convention as every other `compose.ts` in
 * this codebase (`infrastructure/cache/compose.ts`,
 * `infrastructure/events/compose.ts`): one module-level singleton, one
 * exported accessor function, no reflection, no decorators. Every call
 * site — a use case, a Server Component, a Server Action — reaches this
 * module's `FeatureFlagService` through `getFeatureFlagService()`, never
 * by constructing its own `ConfigFeatureFlagProvider`/`FeatureFlagService`
 * directly, so the whole process shares one flag store rather than each
 * caller inventing its own.
 */
let service: FeatureFlagService | null = null;

function buildService(): FeatureFlagService {
  const overrides = parseFeatureFlagsConfig(env.FEATURE_FLAGS_CONFIG);
  const seed = mergeFeatureFlagDefinitions(DEFAULT_FEATURE_FLAG_DEFINITIONS, overrides);
  const provider = new ConfigFeatureFlagProvider(seed);
  const auditLog = new PrismaAdminAuditLogRepository();

  return new FeatureFlagService(provider, auditLog, {
    isGloballyDisabled: () => env.FEATURE_FLAGS_ENABLED === "false",
    defaultEnvironment: () => env.NODE_ENV,
  });
}

export function getFeatureFlagService(): FeatureFlagService {
  if (!service) {
    service = buildService();
  }
  return service;
}

/**
 * Convenience one-liner for the common runtime call site — equivalent to
 * `getFeatureFlagService().isEnabled(key, context)`. Prefer this for a
 * simple boolean gate; use `getFeatureFlagService().evaluate(...)`
 * directly when the evaluation reason or a variant is also needed.
 */
export async function isFeatureEnabled(
  key: string,
  context?: FeatureFlagEvaluationContext,
): Promise<boolean> {
  return getFeatureFlagService().isEnabled(key, context);
}

export async function evaluateFlag(
  key: string,
  context?: FeatureFlagEvaluationContext,
): Promise<FeatureFlagEvaluationResult> {
  return getFeatureFlagService().evaluate(key, context);
}

/** Exposed for tests only — forces the next call to rebuild the service. */
export const __testing = {
  reset(): void {
    service = null;
  },
};
