/**
 * Module 53 — Configuration & Secrets Management.
 *
 * Same role `FeatureFlagProvider` (`application/ports/feature-flag-provider.ts`)
 * or `CacheProvider` (`application/ports/cache-provider.ts`) play for
 * their own modules: a small port the application layer depends on, with
 * zero knowledge of what backs it. Today's only implementation
 * (`infrastructure/config/env-secrets-provider.ts`'s `EnvSecretsProvider`)
 * reads `process.env` through the already-validated `Env`
 * (`infrastructure/config/env.ts`) — every secret this codebase has ever
 * had is process-env-backed today (Vercel/Docker/CI environment
 * variables), so that is the one real adapter.
 *
 * A future cloud secrets manager (AWS Secrets Manager, HashiCorp Vault,
 * GCP Secret Manager, Doppler, ...) implements this same three-method
 * interface and swaps in at `infrastructure/config/compose.ts` alone — no
 * change to `ConfigService`, `collectConfigHealth`, or any call site. The
 * expected shape of that future adapter: a constructor-time bulk fetch
 * (or lazy per-key fetch with an in-memory cache honoring that backend's
 * own rotation/TTL semantics) populating the same `Map<key, value>`
 * `EnvSecretsProvider` already holds, so `getSecret`/`hasSecret` stay
 * synchronous and this port's shape does not need to change to `Promise`-
 * returning just to accommodate a network-backed implementation — the
 * fetch/refresh work happens at construction or on a background timer
 * inside that adapter, never on the read path a request handler is
 * blocking on. This mirrors `ConfigFeatureFlagProvider`'s own "provider
 * owns its I/O and caching, the port stays a plain synchronous read" shape.
 *
 * Deliberately **not** CRUD-shaped like `FeatureFlagProvider` — nothing
 * in this codebase writes secrets at runtime (rotation happens out of
 * band, via the deployment platform's own secret store, followed by a
 * restart — the same "config cannot change without a restart" convention
 * `PlatformConfig`'s own doc comment documents). This port is read-only
 * by design.
 */
export interface SecretsProvider {
  /**
   * The secret value for `key`, or `null` if unset/empty. `key` is one of
   * `Env`'s field names (e.g. `"AUTH_SECRET"`, `"DATABASE_URL"`) —
   * reusing `env.ts`'s own naming rather than inventing a parallel key
   * namespace, so a caller (or a future secrets-manager adapter's own
   * key-mapping table) never has to translate between two vocabularies.
   *
   * Callers that only need to know *whether* a secret is configured
   * (the overwhelmingly common case — see `PlatformConfig`'s
   * `*.configured` flags) should prefer `hasSecret`, which never risks
   * the actual value ending up in a log line, error message, or test
   * snapshot by accident.
   */
  getSecret(key: string): string | null;

  /** Whether `key` has a non-empty value, without exposing it. */
  hasSecret(key: string): boolean;

  /**
   * Every secret key this provider knows about (configured or not) —
   * used by `ConfigService.describeConfig()`/`collectConfigHealth()` to
   * build a complete masked inventory without either of those needing
   * their own hardcoded key list that could drift from the provider's
   * actual coverage.
   */
  listKnownKeys(): readonly string[];
}
