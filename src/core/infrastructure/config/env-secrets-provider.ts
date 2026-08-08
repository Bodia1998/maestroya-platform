import "server-only";

import type { SecretsProvider } from "@/application/ports/secrets-provider";
import type { Env } from "@/infrastructure/config/env";
import { SECRET_ENV_KEYS } from "@/infrastructure/config/config-resolver";

/**
 * Module 53 — Configuration & Secrets Management.
 *
 * The only `SecretsProvider` implementation today: every secret this
 * codebase has ever had lives in process environment variables (Vercel
 * project settings, a Docker `--env-file`, GitHub Actions secrets, a
 * local `.env`), already validated once by `envSchema`
 * (`infrastructure/config/env.ts`). This adapter's entire job is
 * presenting that already-validated data through the `SecretsProvider`
 * port, so application code depends on the port, never on `process.env`
 * or `Env` directly for secret *presence* checks.
 *
 * Reads its values from a supplied `Env`, not `process.env` again — the
 * same "single validated boundary" discipline `env.ts`'s own doc comment
 * establishes ("Import `env` instead of reading `process.env` directly
 * anywhere else"). This class never touches `process.env`.
 *
 * ### Extension point for a future cloud secrets manager
 *
 * A future `AwsSecretsManagerSecretsProvider`/`VaultSecretsProvider`
 * would **not** read from `Env` at all — it would fetch values from the
 * external store at construction time (or lazily, with its own cache),
 * keyed by the same `SECRET_ENV_KEYS` names (so callers never need to
 * know which backend is active), and implement the same three methods.
 * `infrastructure/config/compose.ts`'s `buildSecretsProvider()` is the
 * one place that decision would be made — e.g. gated by a new
 * `SECRETS_PROVIDER` env var following the exact `SEARCH_PROVIDER`/
 * `SMS_PROVIDER` `.catch()`-to-safe-default convention `env.ts` already
 * uses for every other swappable backend. No such variable exists today
 * because there is only one real implementation to select — adding it
 * without a second implementation to switch to would be speculative,
 * untested code, exactly what this module's own "no real cloud
 * integrations, just the port and the env-backed adapter" scope
 * boundary rules out (see docs/MODULE_53_CONFIGURATION_AND_SECRETS_MANAGEMENT.md,
 * "Non-goals").
 */
export class EnvSecretsProvider implements SecretsProvider {
  private readonly values: ReadonlyMap<string, string>;

  constructor(env: Env) {
    const values = new Map<string, string>();
    for (const key of SECRET_ENV_KEYS) {
      const value = env[key];
      if (typeof value === "string" && value.length > 0) {
        values.set(key, value);
      }
    }
    this.values = values;
  }

  getSecret(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  hasSecret(key: string): boolean {
    return this.values.has(key);
  }

  listKnownKeys(): readonly string[] {
    return SECRET_ENV_KEYS;
  }
}
