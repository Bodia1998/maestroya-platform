# Module 53 — Configuration & Secrets Management

## 1. What this module is

A structured configuration and secrets layer built **on top of**
`infrastructure/config/env.ts` — never a replacement for it. `env.ts`
already does the hard, validation-heavy part of this problem ("is
`process.env` well-formed, and does the app fail fast if not?") to a
mature, production-grade standard: Zod-validated types, `.catch()` for
operational tuning knobs, `.optional()` for provider-specific secrets,
`.superRefine` for production-only hard requirements. Module 53 does not
touch any of that. It answers a different, narrower question `env.ts`
was never meant to answer: **once you have a validated `Env`, how does
the rest of the application read it without every module reinventing its
own `env.FOO` scavenger hunt, and how does anything (a log line, a
diagnostics endpoint, a health check) talk about configuration without
risking a secret value leaking into it?**

Three concrete capabilities, all additive:

1. **Structured, namespaced configuration** (`ConfigService.get(section)`)
   — one typed slice per subsystem (`app`, `database`, `email`, `auth`,
   `payments`, `storage`, `sms`, `search`, `geocoding`, `cache`, `queue`,
   `realtime`, `analytics`, `tracing`, `observability`, `featureFlags`)
   instead of scattered `env.X` reads across infrastructure modules.
2. **A `SecretsProvider` port** separating "public config, safe to
   surface anywhere" from "secrets, presence-checkable but never
   value-exposed by default" — with one real adapter today
   (`EnvSecretsProvider`, process-env-backed) and a documented extension
   point for a future cloud secrets manager.
3. **Masked diagnostics + a health check** — `ConfigService.describeConfig()`
   produces the one snapshot shape that is always safe to log or return
   from an admin surface, and `collectConfigHealth()` feeds
   `/api/health/ready`'s new `checks.configuration`.

## 2. Architecture

```
domain/entities/platform-config.ts               — PlatformConfig and its
                                                     16 namespaced sections
                                                     (pure types, no logic)

application/ports/secrets-provider.ts             — SecretsProvider interface
application/services/config/
  config-service.ts                               — ConfigService: get(),
                                                     getAll(), hasSecret(),
                                                     getSecret(),
                                                     describeConfig()

infrastructure/config/
  config-resolver.ts                               — resolvePlatformConfig(env),
                                                     SECRET_ENV_KEYS,
                                                     REQUIRED_SECRET_ENV_KEYS
  env-secrets-provider.ts                           — EnvSecretsProvider
                                                     (the one real
                                                     SecretsProvider today)
  config-health.ts                                  — collectConfigHealth()
  compose.ts                                        — composition root:
                                                     getConfigService(),
                                                     getSecretsProvider(),
                                                     getConfigHealth()
```

This mirrors Module 52's own shape exactly: a port
(`SecretsProvider` ≈ `FeatureFlagProvider`), a service that orchestrates
it (`ConfigService` ≈ `FeatureFlagService`), one concrete adapter today
with a documented swap-in point for a future one, and a manual
`compose.ts` composition root — no DI container, no decorators,
identical to every other infrastructure-swappable module in this
codebase (Module 46's `CacheProvider`, Module 47's
`SearchIndexProvider`, Module 49's `SmsSender`).

## 3. How this composes with `env.ts` — additive, not a replacement

`env.ts`'s `envSchema` is **untouched** by this module. Every field, every
`.catch()`/`.optional()`/`.superRefine` decision documented in that file
stays exactly as it was before Module 53. `resolvePlatformConfig(env)`
(`infrastructure/config/config-resolver.ts`) is the single new seam: a
**pure function** that takes an already-validated `Env` value and
regroups its ~70 flat fields into `PlatformConfig`'s 16 subsystem
sections. It performs no validation of its own — there is nothing left
to validate by the time it runs; every field it reads has already passed
`envSchema`.

This has two consequences worth calling out explicitly:

- **`resolvePlatformConfig` and `EnvSecretsProvider` both take `Env` as a
  plain argument**, rather than importing the `env` singleton
  themselves (unlike almost every other infrastructure module in this
  codebase, which imports `env` directly). This is deliberate: it makes
  both directly unit-testable with hand-built `Env`-shaped fixtures
  (`tests/unit/core/infrastructure/config/platform-config-env-fixture.ts`),
  with no `vi.resetModules()` + re-import ceremony — a meaningfully
  cheaper test suite than `env.ts`'s own, which *does* need that ceremony
  because it validates `process.env` as a module-level side effect.
  `infrastructure/config/compose.ts` is the one place the real `env`
  singleton is read and handed to both.

- **Existing code that reads `env.X` directly keeps working, unchanged,
  forever.** `env.ts` remains this codebase's single source of truth for
  raw environment access — `ConfigService` is the structured,
  discoverable *alternative* for new code (and an easy target for
  incremental migration of old code), not a mandated rewrite. Nothing in
  this module requires touching `sms-sender-factory.ts`,
  `search-provider-factory.ts`, `tracing-config.ts`, or any other
  existing `env.X` call site.

## 4. Structured configuration: `ConfigService`

```ts
import { getConfigService } from "@/infrastructure/config/compose";

const smsConfig = getConfigService().get("sms");
// { provider: "mock" | "twilio", configured: boolean }

const tracingConfig = getConfigService().get("tracing");
// { enabled, exporter, serviceName, otlpEndpointConfigured }
```

`get<K extends keyof PlatformConfig>(section: K): PlatformConfig[K]` is
fully type-safe — the return type is inferred from `section`, so
`get("sms").provider` is `"mock" | "twilio"` at compile time, not
`unknown`/`any`. Every field is either a genuinely non-sensitive value
(a URL, an enum, a numeric knob, a from-address, a Cloudinary cloud
name) or a boolean `*.configured`/`*.enabled` presence flag standing in
for a field whose real value is a secret — `PlatformConfig` never holds
a credential, connection string, or API key by value. See
`domain/entities/platform-config.ts` for the full per-section field list
and the rationale for each inclusion/exclusion.

### Caching — computed once per process

`ConfigService` is constructed once by `infrastructure/config/compose.ts`'s
lazy singleton (`getConfigService()`), exactly like every other module's
`compose.ts` builds its one instance and reuses it for the process's
lifetime (`getFeatureFlagService()`, `getTracingHealth()`'s underlying
tracer). No TTL/expiry machinery was added: this codebase's env vars
never change mid-process — a configuration change always means an env
var change, which always means a restart — so a shorter-lived cache
would buy nothing. `__testing.reset()` is the escape hatch tests use to
force a rebuild after mutating `process.env` and re-importing `env.ts`,
the same convention `feature-flags/compose.ts`'s own `__testing.reset()`
establishes.

## 5. Secrets handling: `SecretsProvider`

```ts
import { getSecretsProvider } from "@/infrastructure/config/compose";

getSecretsProvider().hasSecret("STRIPE_SECRET_KEY"); // true, never the value
getSecretsProvider().getSecret("STRIPE_SECRET_KEY");  // the actual value, when truly needed
```

`SecretsProvider` (`application/ports/secrets-provider.ts`) is three
methods: `getSecret`, `hasSecret`, `listKnownKeys`. Deliberately
**read-only** — nothing in this codebase writes secrets at runtime;
rotation happens out of band (the deployment platform's own secret
store) followed by a restart, the same "config cannot change without a
restart" rule `PlatformConfig` itself follows. This is the one clear
difference from `FeatureFlagProvider`'s CRUD shape.

`key` values are `Env`'s own field names (`"AUTH_SECRET"`,
`"DATABASE_URL"`, ...) — reusing `env.ts`'s existing vocabulary rather
than inventing a second one a caller (or a future adapter's key-mapping
table) would have to translate.

### `SECRET_ENV_KEYS` — what counts as a secret

`infrastructure/config/config-resolver.ts` exports the single list every
part of this module treats as authoritative: 21 `Env` fields spanning
`DATABASE_URL`, `AUTH_SECRET`, every OAuth client *secret* (not the
paired client *id*, which is not confidential), `STRIPE_SECRET_KEY` /
`STRIPE_WEBHOOK_SECRET` (not `STRIPE_PUBLISHABLE_KEY`, which Stripe
designs to be safe in client-side code), `CLOUDINARY_API_KEY` /
`CLOUDINARY_API_SECRET`, `REDIS_URL`, the three geocoding provider keys,
`CRON_SECRET`, the Twilio SID/token pair, both search engines' API keys,
`SENTRY_DSN`, and `OTEL_EXPORTER_HEADERS`. See that file's own doc
comment for the full inclusion/exclusion reasoning.
`REQUIRED_SECRET_ENV_KEYS` is the subset `envSchema` requires
unconditionally in every environment — used only by the health check
(§7), as a defensive cross-check that can, in practice, never actually
fail (see that section).

### The one real adapter: `EnvSecretsProvider`

`infrastructure/config/env-secrets-provider.ts`'s `EnvSecretsProvider`
reads its values from the `Env` it's constructed with (not `process.env`
directly — preserving `env.ts`'s "one validated boundary" rule), holding
them in a private `Map` built once at construction.

### Extension point: a future cloud secrets manager

No AWS Secrets Manager / HashiCorp Vault / GCP Secret Manager
integration was built — that's explicitly out of scope (§9). What exists
is the seam a future implementation plugs into: implement
`SecretsProvider`'s three methods (fetching from the external store at
construction time, or lazily with the adapter's own cache honoring that
backend's rotation semantics — the port stays synchronous, so the
network/refresh work never happens on a request's read path), key the
returned map by the same `SECRET_ENV_KEYS` names, and swap it in at
`infrastructure/config/compose.ts`'s `getSecretsProvider()` alone. No
change to `ConfigService`, `collectConfigHealth`, or any call site. See
`EnvSecretsProvider`'s own doc comment for the full extension-point
writeup, including why no `SECRETS_PROVIDER` selector env var exists yet
(there is only one real implementation to select between today —
adding a switch with nothing to switch to would be speculative, untested
code, the exact thing this module's scope explicitly rules out).

## 6. Masked diagnostics: `describeConfig()`

```ts
const snapshot = getConfigService().describeConfig();
// {
//   environment: "production",
//   config: { app: {...}, database: {...}, ... },   // full PlatformConfig
//   secrets: { AUTH_SECRET: "set", REDIS_URL: "unset", ... }
// }
```

This is the one shape in this module that is unconditionally safe to
log, return from a diagnostics/admin endpoint, or attach to a support
ticket: `config` never contains a secret value by construction
(`PlatformConfig`'s own type guarantees that), and `secrets` maps every
key `SecretsProvider.listKnownKeys()` reports to `"set"`/`"unset"` —
never the underlying value. Every unit and integration test for this
module includes an explicit assertion that a known secret value never
appears anywhere in a `JSON.stringify`'d snapshot.

This deliberately does **not** reuse `logger.ts`'s existing
`REDACTED_KEY_PATTERN`-based `redact()` helper. That helper solves a
different problem well — recursively scanning an arbitrary, unstructured
metadata object for suspiciously-named keys before writing a log line —
but `describeConfig()`'s inputs are not arbitrary: they are the known,
finite `SECRET_ENV_KEYS` list. A named-key `"set"`/`"unset"` map is more
precise (no false-positive redaction of an unrelated field that merely
matches the pattern, no risk of a secret slipping through because its
key didn't match the regex) and more useful (an operator sees exactly
which named secrets are configured, not just that "some redaction
happened somewhere").

## 7. Health check integration

`/api/health/ready` reports `checks.configuration`
(`infrastructure/config/config-health.ts`'s `collectConfigHealth()`),
joining every Module-4x/5x check there in the route's established
**visibility-only** category — reported, never allowed to change the
response's overall `status` or HTTP code. See that file's own doc
comment and the route's updated doc comment for the full reasoning; in
short: a missing *required* secret cannot actually be observed here (the
process would have failed to start before this handler could ever run),
and a misconfigured *optional* provider degrades one already-isolated
feature (which has its own health check reporting it), never this
instance's ability to serve traffic.

```json
{
  "status": "ok",
  "environment": "production",
  "requiredSecretsConfigured": true,
  "configuredOptionalProviders": 3,
  "totalOptionalProviders": 11,
  "issues": []
}
```

`status: "degraded"` fires for two categories of finding: (1) a required
secret reported as missing by `SecretsProvider` — always-true in
practice, kept as defensive insurance against a future `env.ts`
refactor silently loosening a requirement — and (2) a specific,
detectable inconsistency in an *optional* provider's configuration:
`SMS_PROVIDER=twilio` selected without complete Twilio credentials, or
`TRACING_EXPORTER=otlp` selected with tracing enabled but no
`OTEL_EXPORTER_OTLP_ENDPOINT`. Both cases are already handled gracefully
elsewhere in the codebase (`sms-sender-factory.ts` throws at
construction rather than silently degrading; `resolveTracingConfig`
downgrades to `none` rather than exporting nowhere) — this check adds
*visibility* into the same fact, not new behavior.

## 8. Testing

- **Unit — resolver** (`tests/unit/core/infrastructure/config/config-resolver.test.ts`):
  every section's field mapping, OAuth provider detection (all/partial/
  none configured), Stripe Connect independence from the base Stripe
  credentials, SMS mock-vs-twilio completeness, opt-in vs. opt-out
  boolean defaults (tracing/queue/cache bypass default off; search
  indexing/analytics refresh default on), tracing service name fallback,
  `SECRET_ENV_KEYS`/`REQUIRED_SECRET_ENV_KEYS` invariants (no
  duplicates, required ⊆ full list).
- **Unit — secrets provider** (`tests/unit/core/infrastructure/config/env-secrets-provider.test.ts`):
  set/unset presence, `getSecret` returning the real value vs. `null`,
  an entirely unknown key resolving to `null`/`false` rather than
  throwing, `listKnownKeys()` matching `SECRET_ENV_KEYS` exactly, a
  non-secret field (e.g. an OAuth client id) never leaking through.
- **Unit — service** (`tests/unit/core/application/services/config/config-service.test.ts`):
  `get`/`getAll`, delegation to a fake `SecretsProvider`, `describeConfig()`'s
  shape and its explicit "no secret value ever appears in the serialized
  snapshot" assertion, coverage over every key the fake provider reports
  (including zero-secrets-set).
- **Unit — health** (`tests/unit/core/infrastructure/config/config-health.test.ts`):
  clean baseline → `"ok"`; each of the two issue categories individually
  and combined; the defensive required-secret-missing branch (exercised
  directly via a hand-built `secrets` map, since it cannot occur through
  the normal `EnvSecretsProvider` path); optional-provider counting never
  exceeding the total; total invariance across configurations; never
  throws.
- **Unit — compose** (`tests/unit/core/infrastructure/config/compose.test.ts`):
  singleton identity for both `getConfigService()`/`getSecretsProvider()`,
  real-env wiring, `getConfigHealth()` reflecting real misconfiguration,
  `__testing.reset()` forcing a rebuild.
- **Integration — composition wiring** (`tests/integration/config/config-flows.test.ts`):
  imports the real `infrastructure/config/compose.ts` under a controlled
  `process.env`, proving `ConfigService`/`EnvSecretsProvider` see real
  env values, `describeConfig()` never leaks a real secret value end to
  end, `getConfigHealth()` reflects a real misconfiguration, and
  `/api/health/ready`'s `checks.configuration` matches the shape
  `getConfigHealth()` returns directly without affecting overall
  readiness.
- **Integration — health route** (`tests/integration/observability/health-routes.test.ts`,
  "Module 53" block): the same visibility-only assertions, alongside
  every other module's own block in that shared suite.

## 9. Non-goals / known gaps

- **No cloud secrets manager integration.** No AWS Secrets Manager,
  HashiCorp Vault, GCP Secret Manager, or similar client was added. This
  was explicitly out of scope — see `SecretsProvider`'s and
  `EnvSecretsProvider`'s own doc comments for the exact extension point a
  future adapter would use.
- **No secret rotation, versioning, or expiry.** Every secret is a
  point-in-time process-env value; rotating one means updating the
  deployment platform's environment variables and restarting, exactly
  how it already worked before this module existed. A future non-env
  adapter could add its own rotation-aware caching internally without
  any change to the `SecretsProvider` port.
- **No admin UI/API for viewing configuration.** `describeConfig()` is
  the ready-made, safe-to-expose payload; wiring it behind an
  authenticated admin route (following the `requireRole()` pattern
  Module 52's own §7 documents for its future admin surface) is a
  follow-up, not part of this module.
- **`ConfigService` does not migrate existing `env.X` call sites.** It is
  additive and available for new code; nothing in this change requires
  or performs a rewrite of any existing infrastructure module's direct
  `env` usage.
