import "server-only";

import { ConfigService } from "@/application/services/config/config-service";
import type { SecretsProvider } from "@/application/ports/secrets-provider";
import { env } from "@/infrastructure/config/env";
import { resolvePlatformConfig } from "@/infrastructure/config/config-resolver";
import { EnvSecretsProvider } from "@/infrastructure/config/env-secrets-provider";
import { collectConfigHealth, type ConfigHealthReport } from "@/infrastructure/config/config-health";

/**
 * Module 53 — Configuration & Secrets Management — composition root.
 *
 * Same manual, no-DI-container convention as every other `compose.ts` in
 * this codebase (`infrastructure/feature-flags/compose.ts`,
 * `infrastructure/tracing/compose.ts`): one module-level singleton pair,
 * one exported accessor per singleton, no reflection, no decorators.
 * Every call site reaches this module's `ConfigService`/`SecretsProvider`
 * through `getConfigService()`/`getSecretsProvider()`, never by calling
 * `resolvePlatformConfig()`/constructing `EnvSecretsProvider` directly, so
 * the whole process shares one resolved config snapshot rather than
 * recomputing it (a purely mechanical, but still pointless-to-repeat)
 * remapping of `env` on every read.
 *
 * `env` is read here exactly once, at first access — never inside
 * `resolvePlatformConfig()`/`EnvSecretsProvider` themselves (both take an
 * `Env` value as a constructor/function argument instead), which is what
 * keeps those two independently unit-testable with hand-built fixtures.
 * This module is the one seam where the real, validated `env` singleton
 * (`infrastructure/config/env.ts`) meets this module's own types.
 */
let configService: ConfigService | null = null;
let secretsProvider: SecretsProvider | null = null;

export function getSecretsProvider(): SecretsProvider {
  if (!secretsProvider) {
    secretsProvider = new EnvSecretsProvider(env);
  }
  return secretsProvider;
}

export function getConfigService(): ConfigService {
  if (!configService) {
    configService = new ConfigService(resolvePlatformConfig(env), getSecretsProvider());
  }
  return configService;
}

/**
 * Builds the `checks.configuration` payload for `/api/health/ready`
 * (Module 25 — Production Infrastructure). Derives its inputs from the
 * same cached `ConfigService` every other caller uses
 * (`describeConfig()`), so this reports exactly what the rest of the
 * process would see from `getConfigService()` — never a second,
 * independently-computed view that could drift from it.
 */
export function getConfigHealth(): ConfigHealthReport {
  const { config, secrets } = getConfigService().describeConfig();
  return collectConfigHealth({ config, secrets });
}

/** Exposed for tests only — forces the next call to rebuild both
 *  singletons (e.g. after mutating `process.env` and re-importing
 *  `env.ts` in an integration test). */
export const __testing = {
  reset(): void {
    configService = null;
    secretsProvider = null;
  },
};
