import "server-only";

import type { FeatureFlagDefinition } from "@/domain/entities/feature-flag";
import type { FeatureFlagProvider } from "@/application/ports/feature-flag-provider";

/**
 * Feature Flags module — the in-memory/config-backed `FeatureFlagProvider`.
 *
 * Seeded once at construction (from the code-defined defaults merged with
 * `FEATURE_FLAGS_CONFIG`, see `feature-flag-definitions.ts`), then held
 * entirely in a process-local `Map`. `upsertDefinition` (called by
 * `FeatureFlagService.updateFlag`, e.g. from a future admin UI) mutates
 * that `Map` directly — changes are visible immediately within the same
 * process but are **not persisted** and do not propagate to other
 * instances/processes/deploys. That trade-off is deliberate and
 * documented, not an oversight: this is the same starting point
 * `InMemoryCacheProvider`/`InMemorySearchProvider` take for their
 * respective modules — a fully functional implementation for local
 * development, tests, and a single-instance deployment, with a clear
 * upgrade path.
 *
 * The upgrade path is exactly the point of the `FeatureFlagProvider` port:
 * a future `PrismaFeatureFlagProvider` (backed by a `FeatureFlag` table)
 * or a remote-config-backed provider (LaunchDarkly, Unleash, ...)
 * implements the same three methods and swaps in at
 * `infrastructure/feature-flags/compose.ts` alone — `FeatureFlagService`,
 * the evaluator, and every call site are unaffected.
 */
export class ConfigFeatureFlagProvider implements FeatureFlagProvider {
  private readonly definitions = new Map<string, FeatureFlagDefinition>();

  constructor(seed: readonly FeatureFlagDefinition[] = []) {
    for (const definition of seed) {
      this.definitions.set(definition.key, definition);
    }
  }

  async getDefinition(key: string): Promise<FeatureFlagDefinition | null> {
    return this.definitions.get(key) ?? null;
  }

  async listDefinitions(): Promise<FeatureFlagDefinition[]> {
    return Array.from(this.definitions.values());
  }

  async upsertDefinition(definition: FeatureFlagDefinition): Promise<FeatureFlagDefinition> {
    this.definitions.set(definition.key, definition);
    return definition;
  }
}
