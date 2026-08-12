import "server-only";

import { GetCircuitBreakerStatusUseCase } from "@/application/use-cases/health/get-circuit-breaker-status.use-case";
import { GetPlatformHealthUseCase } from "@/application/use-cases/health/get-platform-health.use-case";
import { ResetCircuitBreakerUseCase } from "@/application/use-cases/health/reset-circuit-breaker.use-case";
import { CircuitBreakerRegistry } from "@/application/services/health/circuit-breaker-registry";
import { HealthCheckRegistry } from "@/application/services/health/health-check-registry";
import { env } from "@/infrastructure/config/env";
import { getAnalyticsHealth } from "@/infrastructure/analytics/compose";
import { getBackupHealth, getRecoveryHealth } from "@/infrastructure/backup/compose";
import { getCacheHealth } from "@/infrastructure/cache/compose";
import { getConfigHealth } from "@/infrastructure/config/compose";
import { getReadReplicaHealth } from "@/infrastructure/database/compose";
import { prisma } from "@/infrastructure/database/prisma/client";
import { createCircuitBreakerHealthContributor } from "@/infrastructure/health/circuit-breaker-health-contributor";
import {
  collectCloudinaryHealth,
  collectOpenTelemetryCollectorHealth,
  collectResendHealth,
  collectStripeHealth,
  collectTwilioHealth,
} from "@/infrastructure/health/external-dependency-checks";
import { getBackgroundJobsHealth } from "@/infrastructure/jobs/compose";
import { getRealtimeHealth } from "@/infrastructure/realtime/compose";
import { getSearchEngineHealth } from "@/infrastructure/search/compose";
import { getSmsProviderHealth } from "@/infrastructure/sms/compose";
import { getTracingHealth } from "@/infrastructure/tracing/compose";

/**
 * Module 56 — Health Checks & Circuit Breakers.
 *
 * Composition root for the module — the same manual, no-DI-container
 * convention every other `compose.ts` in this codebase follows. Builds
 * the two process-wide singleton registries (`CircuitBreakerRegistry`,
 * `HealthCheckRegistry`), registers one `HealthContributor` per external
 * dependency named in Requirement 3, and exposes the three use-cases
 * `/api/health/diagnostics`, `/api/health/circuit-breakers`, and
 * `/api/health/startup` depend on.
 *
 * Every contributor below wraps an **existing** collector this codebase
 * already has (Modules 44-55) — none of that collection logic is
 * duplicated or reimplemented here, only adapted (see
 * `circuit-breaker-health-contributor.ts`'s own doc comment). The only
 * genuinely new collectors are the five in `external-dependency-checks.ts`,
 * for dependencies with no existing `*-health.ts` at all.
 *
 * Lazy singletons, exactly like every other `compose.ts`'s own reasoning
 * (`search/compose.ts`, `sms/compose.ts`): Next.js imports modules during
 * `next build` for static analysis, where constructing registries eagerly
 * at module scope is harmless here (no timers/workers are started), but
 * lazy construction keeps this file consistent with the rest of the
 * codebase and trivially resettable between tests.
 */

let circuitBreakerRegistry: CircuitBreakerRegistry | null = null;
let healthCheckRegistry: HealthCheckRegistry | null = null;

export function getCircuitBreakerRegistry(): CircuitBreakerRegistry {
  if (!circuitBreakerRegistry) {
    circuitBreakerRegistry = new CircuitBreakerRegistry({
      failureThreshold: env.CIRCUIT_BREAKER_FAILURE_THRESHOLD,
      successThreshold: env.CIRCUIT_BREAKER_SUCCESS_THRESHOLD,
      timeoutMs: env.CIRCUIT_BREAKER_TIMEOUT_MS,
      resetTimeoutMs: env.CIRCUIT_BREAKER_RESET_TIMEOUT_MS,
    });
  }
  return circuitBreakerRegistry;
}

export function getHealthCheckRegistry(): HealthCheckRegistry {
  if (!healthCheckRegistry) {
    healthCheckRegistry = new HealthCheckRegistry();
    for (const contributor of buildContributors(getCircuitBreakerRegistry())) {
      healthCheckRegistry.register(contributor);
    }
  }
  return healthCheckRegistry;
}

function buildContributors(registry: CircuitBreakerRegistry) {
  return [
    createCircuitBreakerHealthContributor({
      name: "postgres-primary",
      registry,
      async collect() {
        await prisma.$queryRaw`SELECT 1`;
        return { status: "ok" };
      },
    }),
    createCircuitBreakerHealthContributor({ name: "read-replicas", registry, collect: getReadReplicaHealth }),
    createCircuitBreakerHealthContributor({ name: "redis", registry, collect: async () => getCacheHealth() }),
    createCircuitBreakerHealthContributor({ name: "search-engine", registry, collect: getSearchEngineHealth }),
    createCircuitBreakerHealthContributor({ name: "realtime", registry, collect: async () => getRealtimeHealth() }),
    createCircuitBreakerHealthContributor({ name: "background-jobs", registry, collect: getBackgroundJobsHealth }),
    createCircuitBreakerHealthContributor({ name: "sms-twilio", registry, collect: getSmsProviderHealth }),
    createCircuitBreakerHealthContributor({ name: "analytics", registry, collect: getAnalyticsHealth }),
    createCircuitBreakerHealthContributor({ name: "tracing", registry, collect: async () => getTracingHealth() }),
    createCircuitBreakerHealthContributor({ name: "opentelemetry", registry, collect: async () => collectOpenTelemetryCollectorHealth() }),
    createCircuitBreakerHealthContributor({ name: "config", registry, collect: async () => getConfigHealth() }),
    createCircuitBreakerHealthContributor({ name: "backup", registry, collect: getBackupHealth }),
    createCircuitBreakerHealthContributor({ name: "disaster-recovery", registry, collect: getRecoveryHealth }),
    createCircuitBreakerHealthContributor({ name: "stripe", registry, collect: async () => collectStripeHealth() }),
    createCircuitBreakerHealthContributor({ name: "cloudinary", registry, collect: async () => collectCloudinaryHealth() }),
    createCircuitBreakerHealthContributor({ name: "resend", registry, collect: async () => collectResendHealth() }),
    createCircuitBreakerHealthContributor({ name: "twilio", registry, collect: async () => collectTwilioHealth() }),
  ];
}

export function getPlatformHealthUseCase(): GetPlatformHealthUseCase {
  return new GetPlatformHealthUseCase(getHealthCheckRegistry());
}

export function getCircuitBreakerStatusUseCase(): GetCircuitBreakerStatusUseCase {
  return new GetCircuitBreakerStatusUseCase(getCircuitBreakerRegistry());
}

export function getResetCircuitBreakerUseCase(): ResetCircuitBreakerUseCase {
  return new ResetCircuitBreakerUseCase(getCircuitBreakerRegistry());
}

/** Exposed for tests only — drops every singleton so the next call rebuilds. */
export const __testing = {
  reset(): void {
    circuitBreakerRegistry = null;
    healthCheckRegistry = null;
  },
};
