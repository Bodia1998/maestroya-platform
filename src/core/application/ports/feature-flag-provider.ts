import type { FeatureFlagDefinition } from "@/domain/entities/feature-flag";

/**
 * Feature Flags module — the provider abstraction.
 *
 * Same role as `CacheProvider` (`application/ports/cache-provider.ts`) or
 * `SearchIndexProvider`: a small port the application layer (
 * `FeatureFlagService`) depends on, with zero knowledge of what backs it.
 * Today's only implementation (`infrastructure/feature-flags/
 * config-feature-flag-provider.ts`) is in-memory/config-backed; a future
 * database-backed or remote-config-backed provider (LaunchDarkly,
 * Unleash, a `FeatureFlag` Prisma table) implements this same interface
 * and swaps in at `infrastructure/feature-flags/compose.ts` alone — no
 * change to `FeatureFlagService`, the evaluator, or any call site.
 *
 * Deliberately just CRUD-shaped reads/writes on whole definitions, not
 * evaluation — evaluation is `domain/services/feature-flag-evaluator.ts`'s
 * job, and stays provider-agnostic.
 */
export interface FeatureFlagProvider {
  /** `null` if no definition exists for `key` — not an error. */
  getDefinition(key: string): Promise<FeatureFlagDefinition | null>;

  /** All known definitions, in no particular guaranteed order — callers
   *  that need a stable order (e.g. an admin listing UI) sort themselves. */
  listDefinitions(): Promise<FeatureFlagDefinition[]>;

  /** Creates `definition` if `definition.key` is new, otherwise replaces
   *  the existing definition for that key entirely (not a partial patch —
   *  `FeatureFlagService.updateFlag` is the layer that merges a partial
   *  patch onto the current definition before calling this). Returns the
   *  stored definition. */
  upsertDefinition(definition: FeatureFlagDefinition): Promise<FeatureFlagDefinition>;
}
