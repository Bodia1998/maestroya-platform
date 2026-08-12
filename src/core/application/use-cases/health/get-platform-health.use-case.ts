import type { HealthCheckRegistry } from "@/application/services/health/health-check-registry";
import type { PlatformHealthReport } from "@/domain/entities/health-status";

/**
 * Module 56 — Health Checks & Circuit Breakers.
 *
 * Thin application-layer entry point over `HealthCheckRegistry.runAll` —
 * exists so route handlers (`/api/health/diagnostics`) depend on a
 * use-case, the same convention every other module's read path follows
 * (e.g. `GetRecoveryReadinessUseCase`), rather than reaching into an
 * infrastructure singleton directly.
 */
export class GetPlatformHealthUseCase {
  constructor(private readonly registry: HealthCheckRegistry) {}

  async execute(): Promise<PlatformHealthReport> {
    return this.registry.runAll();
  }
}
