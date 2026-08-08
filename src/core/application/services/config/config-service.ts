import type { PlatformConfig } from "@/domain/entities/platform-config";
import type { SecretsProvider } from "@/application/ports/secrets-provider";

/** One entry in `describeConfig()`'s masked secrets inventory — presence
 *  only, never the value, so this shape is always safe to log or return
 *  from a diagnostics endpoint. */
export type SecretPresence = "set" | "unset";

export interface ConfigSnapshot {
  /** `PlatformConfig.app.nodeEnv` surfaced at the top level too, since
   *  "what environment is this snapshot from" is the first thing anyone
   *  reading a diagnostics dump wants to confirm without drilling into
   *  `config.app`. */
  readonly environment: PlatformConfig["app"]["nodeEnv"];
  /** The full structured, non-secret configuration. Safe to log or
   *  return from an admin/diagnostics surface in its entirety — nothing
   *  in `PlatformConfig` is ever a secret value (see that type's own doc
   *  comment). */
  readonly config: PlatformConfig;
  /** Every secret key `SecretsProvider` knows about, mapped to whether it
   *  is currently set — never the value itself. */
  readonly secrets: Readonly<Record<string, SecretPresence>>;
}

/**
 * Module 53 — Configuration & Secrets Management.
 *
 * The single entry point application code should use for both concerns
 * this module owns:
 *
 *  - **Structured settings** — `get(section)` returns one typed,
 *    namespaced slice of `PlatformConfig` (e.g. `get("sms")` →
 *    `SmsConfigSection`), instead of every call site reaching into
 *    scattered `env.FOO` reads across infrastructure modules. This does
 *    not replace direct `env.X` reads everywhere overnight — `env.ts`
 *    remains the source of truth and existing modules keep working
 *    unchanged — it is the structured, discoverable alternative new code
 *    (and incrementally migrated old code) should reach for.
 *
 *  - **Secrets presence + masked diagnostics** — `hasSecret`/`getSecret`
 *    delegate to the injected `SecretsProvider` port (today:
 *    `EnvSecretsProvider`, see that class's own doc comment for the
 *    cloud-secrets-manager extension point), and `describeConfig()`
 *    produces the one shape that is always safe to log, return from an
 *    admin surface, or attach to a support ticket — the full public
 *    config plus a "set"/"unset" map for every known secret, never an
 *    actual secret value.
 *
 * Constructed once with an already-resolved `PlatformConfig` — the
 * *caching* this module's spec calls out. `PlatformConfig` is computed
 * once per process by `infrastructure/config/config-resolver.ts`'s
 * `resolvePlatformConfig()` and handed to this class by
 * `infrastructure/config/compose.ts`'s singleton, exactly like every
 * other module's `compose.ts` builds its one service instance lazily and
 * reuses it for the life of the process (`getFeatureFlagService()`,
 * `getTracingHealth()`'s underlying tracer, ...). No TTL/expiry
 * machinery: this codebase's env vars never change mid-process (a
 * config change always means an env var change, which always means a
 * restart), so there is nothing a shorter cache would buy — see
 * `PlatformConfig`'s own doc comment for the same point.
 *
 * Deliberately holds no reference to `Env` itself and performs no env
 * parsing — that stays exactly where it already is (`env.ts`). This
 * class's only inputs are the already-resolved `PlatformConfig` and the
 * `SecretsProvider` port; it is fully unit-testable with hand-built
 * fakes of both, no `process.env`/module-reset gymnastics required.
 */
export class ConfigService {
  constructor(
    private readonly config: PlatformConfig,
    private readonly secrets: SecretsProvider,
  ) {}

  /** Type-safe, namespaced read into the structured config — e.g.
   *  `configService.get("tracing").exporter`. Never throws: `section` is
   *  constrained to `keyof PlatformConfig` at the type level, so there is
   *  no "unknown section" runtime case to handle. */
  get<K extends keyof PlatformConfig>(section: K): PlatformConfig[K] {
    return this.config[section];
  }

  /** The full structured config, for a caller that genuinely needs more
   *  than one section at once (e.g. `describeConfig()` itself). Prefer
   *  `get(section)` at ordinary call sites — it documents which section a
   *  piece of code actually depends on. */
  getAll(): PlatformConfig {
    return this.config;
  }

  /** Whether `key` (an `Env` field name, e.g. `"STRIPE_SECRET_KEY"`) has
   *  a configured secret value. Safe to call from anywhere, including a
   *  log line or an error message — never risks the value itself. */
  hasSecret(key: string): boolean {
    return this.secrets.hasSecret(key);
  }

  /**
   * The actual secret value for `key`, or `null` if unset. Exists for the
   * rare legitimate case where a caller needs the credential itself (most
   * of this codebase's existing infrastructure factories read `env.X`
   * directly for that today, and continue to — this is the port-based
   * alternative for new code that wants to depend on `SecretsProvider`
   * rather than `env.ts` directly, e.g. because it must also work against
   * a future non-env-backed adapter). Callers must never log, include in
   * an error message, or otherwise let the return value escape a
   * narrowly-scoped use — `hasSecret`/`describeConfig()` are the safe
   * defaults for anything observability-related.
   */
  getSecret(key: string): string | null {
    return this.secrets.getSecret(key);
  }

  /**
   * Builds the one snapshot shape that is always safe to log, return
   * from a diagnostics endpoint, or attach to a support ticket: the full
   * public `PlatformConfig` (never contains a secret value by
   * construction) plus a "set"/"unset" map covering every secret
   * `SecretsProvider` knows about. Never includes an actual secret value
   * — this is the boundary that makes "safe to expose" true by
   * construction rather than by the caller remembering to redact.
   */
  describeConfig(): ConfigSnapshot {
    const secrets: Record<string, SecretPresence> = {};
    for (const key of this.secrets.listKnownKeys()) {
      secrets[key] = this.secrets.hasSecret(key) ? "set" : "unset";
    }

    return {
      environment: this.config.app.nodeEnv,
      config: this.config,
      secrets,
    };
  }
}
