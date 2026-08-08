# Module 52 — Feature Flags

> Requested as "Module 19" — that number is already taken in this codebase
> by `docs/MODULE_19_SEARCH_RANKING.md`. This module is filed under the
> next available number in the existing sequential series (the highest at
> the time this was written was Module 51 — Distributed Tracing).

## 1. What this module is

A production-grade feature flag system: a typed domain model, a
deterministic evaluation engine, a swappable provider abstraction, and a
service that orchestrates the two — enabling safe, gradual, reversible
production releases (percentage rollouts, user/role targeting,
environment scoping, and an emergency kill switch) without a deploy.

It follows the same layering every other module in this codebase uses
(Clean Architecture: domain → application → infrastructure), the same
manual composition-root convention (no DI container), and reuses the
platform's existing config system, structured logger, role model, and
admin audit trail rather than introducing parallel versions of any of
them.

## 2. Architecture

```
domain/entities/feature-flag.ts              — types: FeatureFlagDefinition,
                                                 evaluation context/result
domain/services/feature-flag-rollout.ts       — deterministic hashing
                                                 (percentage rollout + variant split)
domain/services/feature-flag-evaluator.ts     — pure rule engine:
                                                 (definition, context) -> result

application/ports/feature-flag-provider.ts    — FeatureFlagProvider interface
application/dto/feature-flag.dto.ts           — zod schemas (config parsing +
                                                 future admin API input)
application/services/feature-flags/
  feature-flag-service.ts                     — orchestration: evaluate(),
                                                 isEnabled(), listFlags(),
                                                 getFlag(), updateFlag()

infrastructure/feature-flags/
  feature-flag-definitions.ts                 — code-defined default catalog +
                                                 FEATURE_FLAGS_CONFIG parsing
  config-feature-flag-provider.ts             — in-memory FeatureFlagProvider
  compose.ts                                  — composition root:
                                                 getFeatureFlagService(),
                                                 evaluateFlag(), isFeatureEnabled()
```

This mirrors the shape of every other infrastructure-swappable module in
the codebase (e.g. Module 46's Caching Layer: `CacheProvider` port,
`InMemoryCacheProvider`/`RedisCacheProvider`, `cache-provider-factory.ts`,
`compose.ts`) and Module 16's Admin Panel (repository interface + Prisma
implementation + `compose.ts` factory functions, audit log on every
write).

### Why the evaluator is a pure function

`evaluateFeatureFlag(definition, context)` in
`domain/services/feature-flag-evaluator.ts` has no I/O, no provider
lookups, and cannot throw by construction. It is the single place every
rule (kill switch, environment scoping, deny/allow lists, role targeting,
percentage rollout) is applied, in a fixed, documented precedence order —
and it is exhaustively unit-testable without mocking anything.
`FeatureFlagService.evaluate()` is the only caller, and is the layer
responsible for I/O (fetching the definition from the provider), the
process-wide kill switch (which needs no definition to decide), and
catching anything unexpected.

### Provider abstraction

`FeatureFlagProvider` (`application/ports/feature-flag-provider.ts`) is
three methods: `getDefinition`, `listDefinitions`, `upsertDefinition`.
Today's only implementation, `ConfigFeatureFlagProvider`
(`infrastructure/feature-flags/config-feature-flag-provider.ts`), holds
definitions in a process-local `Map`, seeded from the code-defined
defaults (`feature-flag-definitions.ts`) merged with the optional
`FEATURE_FLAGS_CONFIG` env var.

This is a deliberate, documented starting point, not a hidden limitation:
a future database-backed provider (a `FeatureFlag` Prisma table) or a
remote-config-backed provider (LaunchDarkly, Unleash, ...) implements the
same three methods and is swapped in at
`infrastructure/feature-flags/compose.ts` alone. `FeatureFlagService`, the
evaluator, and every call site in the rest of the app are completely
unaffected by that change.

### Deterministic percentage rollout

`domain/services/feature-flag-rollout.ts` hashes
`` `${flagKey}:${salt}:${stableId}` `` with FNV-1a (32-bit, non-cryptographic
— nothing here needs to be unpredictable, only uniformly distributed) into
one of 10,000 buckets. `isInRolloutPercentage(flagKey, stableId,
percentage)` compares the bucket against the requested percentage. This
guarantees:

- **Determinism** — the same user always gets the same answer for the
  same flag, across requests and processes, with no session affinity or
  sticky state.
- **Independence across flags** — the same user's inclusion in one
  flag's rollout tells you nothing about another flag's rollout (the flag
  key is part of the hash input).
- **Monotonic rollout** — a user included at 20% stays included as the
  percentage grows toward 100%, because the bucket assignment never
  changes; only the threshold moves.

A second, independently-salted hash (`pickVariant`) selects a weighted
variant when a flag defines `variants`, so rollout inclusion and variant
assignment don't correlate with each other.

### Kill switches (two levels)

1. **Global** — `FEATURE_FLAGS_ENABLED=false` (env var,
   `infrastructure/config/env.ts`) forces *every* flag to evaluate as
   disabled, checked first in `FeatureFlagService.evaluate()` before any
   provider lookup even happens. This is the single "something's on fire,
   turn everything off" lever for an operator.
2. **Per-flag** — `FeatureFlagDefinition.killSwitch: true` force-disables
   one specific flag, checked first inside the evaluator, before
   `enabled`, environment scoping, or any targeting rule. It overrides
   even an explicit user allow-list.

Both are opt-out overrides: absent, everything behaves exactly as the
rest of a flag's configuration says.

### Fail-closed by design

- An **unknown flag key** evaluates to `{ enabled: false, reason:
  "UNKNOWN_FLAG" }` — never throws, never defaults to enabled.
- **Any exception** during evaluation (a provider error, for example) is
  caught in `FeatureFlagService.evaluate()`, logged via the existing
  structured logger (`logger.error("feature_flag.evaluation_failed",
  ...)`), and resolves to `{ enabled: false, reason: "ERROR_FALLBACK" }`.
- A **percentage rollout with no stable `userId`** in the evaluation
  context resolves to disabled rather than either enabling for everyone
  (defeating the rollout) or throwing.

A broken or misconfigured flag can never take down the feature it's
supposed to be gating.

### Role-based targeting

`FeatureFlagTargeting.roleAllowList` reuses the platform's existing role
system unchanged — `ROLES`/`RoleKey` from `infrastructure/auth/rbac.ts`
(`ADMIN`, `SUPER_ADMIN`, `SUPPORT`, `CUSTOMER`, `PROVIDER`, `MODERATOR`).
No new role concept, no new permission model. The domain layer itself
types this field as `readonly string[]` rather than `RoleKey[]`, because
domain code must not import from infrastructure (`rbac.ts` lives in
infrastructure, following this codebase's existing convention — see e.g.
`application/dto/admin.dto.ts`, which already imports `ROLES` from
there). The application/infrastructure layers, where `RoleKey` is
available, are where a caller supplies real role keys into
`FeatureFlagEvaluationContext.roles`.

### Environment scoping

`FeatureFlagDefinition.environments` restricts a flag to a subset of
`"development" | "test" | "production"` — the exact three values
`env.NODE_ENV` already takes (`infrastructure/config/env.ts`). No
separate environment concept was introduced. `FeatureFlagService`
defaults `context.environment` to the process's own `env.NODE_ENV` when a
caller's context doesn't specify one, so environment scoping "just works"
without every call site having to pass it explicitly.

### Audit logging

Flag **definition changes** (`FeatureFlagService.updateFlag`) are
recorded to the existing, append-only `AuditLog` trail via
`AdminAuditLogRepository` — the same infrastructure Module 16 (Admin
Panel) uses for every other admin mutation (`ChangeUserRoleUseCase`,
`SuspendCompanyUseCase`, ...). Two new `AdminAuditAction` values were
added to that shared union (`domain/repositories/admin-audit-log-repository.ts`):

- `FEATURE_FLAG_UPDATED` — any definition change.
- `FEATURE_FLAG_KILL_SWITCH_TOGGLED` — specifically when
  `killSwitch` changes value, so kill-switch activity is distinguishable
  in the audit trail without parsing metadata.

Both map onto the existing Prisma `AuditLogAction` enum
(`UPDATE`/`STATUS_CHANGE` respectively) in
`prisma-admin-audit-log-repository.ts`'s `ADMIN_ACTION_TO_LOG_ACTION`
table, the same "map to the closest existing enum value, keep the
concrete action name in `metadata.adminAction`" convention every other
module's audit actions already follow. No schema migration was needed.

**Evaluations are deliberately never audit-logged** — every `evaluate()`
call happening on essentially every request would be prohibitively
high-volume, low-value noise in an audit trail meant for "who changed
what." `evaluate()`'s only observability is the `error`-level log on the
fail-closed path above.

### Configuration integration

Two new env vars in `infrastructure/config/env.ts` (validated by the same
zod schema as every other env var, following the same "an invalid
operational setting degrades to its safe default, never fails startup"
convention as `SEARCH_PROVIDER`/`GEOCODING_PROVIDER`/`SMS_PROVIDER`):

| Var | Default | Purpose |
|---|---|---|
| `FEATURE_FLAGS_ENABLED` | `"true"` | Global kill switch. `"false"` disables every flag. An invalid value falls back to `"true"` (never an accidental outage). |
| `FEATURE_FLAGS_CONFIG` | unset | Optional JSON array of `FeatureFlagDefinition`s, validated against `featureFlagsConfigSchema`. Merged onto the code-defined defaults by `key` (an entry here fully replaces the matching default, never a partial merge). Malformed JSON or a schema-invalid entry is logged at `warn` and ignored — never a startup failure. |

Example `FEATURE_FLAGS_CONFIG`:

```json
[
  {
    "key": "new-dashboard-ui",
    "enabled": true,
    "environments": ["production"],
    "rollout": { "percentage": 25 },
    "targeting": { "roleAllowList": ["ADMIN"] }
  }
]
```

## 3. How to define a flag

**Preferred — code-defined default** (reviewed, versioned, deployed like
any other code change): add an entry to
`DEFAULT_FEATURE_FLAG_DEFINITIONS` in
`infrastructure/feature-flags/feature-flag-definitions.ts`.

**Operational override — env var**: set `FEATURE_FLAGS_CONFIG` to a JSON
array containing the flag. Useful for a same-day rollout percentage
change without a deploy, or a per-environment override.

**Future — admin UI/API**: call
`getFeatureFlagService().updateFlag(adminUserId, key, patch)` from a
Server Action/route once one exists (see §6 below). Creating a brand-new
flag this way requires `patch.enabled` to be present explicitly.

## 4. How to evaluate a flag

```ts
import { isFeatureEnabled, evaluateFlag } from "@/infrastructure/feature-flags/compose";

// Simple boolean gate:
const enabled = await isFeatureEnabled("new-dashboard-ui", {
  userId: currentUser.id,
  roles: currentUser.roles,
});

// When you also need the reason or a variant:
const result = await evaluateFlag("new-dashboard-ui", { userId: currentUser.id });
if (result.enabled) {
  // result.variant may be set if the flag defines `variants`
}
```

`evaluate()`/`isEnabled()` never throw — safe to call from a Server
Component render path, a use case, or a Server Action without wrapping in
`try/catch`.

## 5. Kill switch usage

- **Emergency, platform-wide**: set `FEATURE_FLAGS_ENABLED=false` (env var
  or your deployment platform's runtime config) and redeploy/restart. No
  code change.
- **Emergency, single flag**: set that flag's `killSwitch: true`, either
  via `FEATURE_FLAGS_CONFIG` (no deploy needed if your platform supports
  runtime env var changes) or via `updateFlag` once an admin API exists.
  This overrides even an explicit user allow-list — nobody sees the
  feature while the kill switch is on, no exceptions.

## 6. Rollout usage

```json
{ "key": "new-dashboard-ui", "enabled": true, "rollout": { "percentage": 10 } }
```

Ramp the percentage up over time (10 → 25 → 50 → 100) by editing the
definition (code change or `FEATURE_FLAGS_CONFIG` update) — every
previously-included user stays included as the percentage grows
(monotonic, see §2). Setting `percentage: 0` is a safe "paused" state,
distinct from `enabled: false` — it keeps the flag's targeting/metadata
in place while including nobody via the rollout path (explicit
allow-listed users/roles are still bypassed straight to enabled).

## 7. Extension points for a future admin UI

`FeatureFlagService` was deliberately given the same read/list/update
shape `AdminRepository` (Module 16) already has, so wiring an admin
surface later is a copy of an existing, well-understood pattern:

1. Add Zod schemas to `application/dto/feature-flag.dto.ts` for whatever
   the UI needs to submit (`updateFeatureFlagSchema` already covers the
   partial-patch shape).
2. Add a `"use server"` actions file (e.g.
   `src/app/(dashboard)/admin/feature-flags/actions.ts`), following
   `src/app/(dashboard)/admin/actions.ts`'s exact convention: resolve the
   actor via `requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN)`
   (`infrastructure/auth/rbac.ts`), parse input with the schema, call
   `getFeatureFlagService().listFlags()/getFlag()/updateFlag()`.
3. Build the page/table UI the same way the existing admin panel pages
   do.
4. Audit trail visibility: `ListAdminAuditLogsUseCase` (Module 16) already
   reads every `AuditLog` row — `FEATURE_FLAG_UPDATED`/
   `FEATURE_FLAG_KILL_SWITCH_TOGGLED` entries show up there with zero
   additional work.

No change to `FeatureFlagService`, the provider, or the evaluator is
needed to add this surface — that separation is the entire point of the
module/port boundaries above.

## 8. Testing

- **Unit — pure rollout hashing**
  (`tests/unit/core/domain/services/feature-flag-rollout.test.ts`):
  determinism, bucket range, 0%/100% edge cases, statistical distribution
  sanity, monotonic rollout, variant weighting.
- **Unit — evaluation rule engine**
  (`tests/unit/core/domain/services/feature-flag-evaluator.test.ts`): kill
  switch (flag-level), disabled flag, environment scoping (in/out/unset),
  deny-list precedence over allow-list, allow-list bypassing rollout,
  role targeting (match/no-match/missing roles), percentage rollout
  (determinism, no-userId fail-closed, 0%/100%), default-enabled
  fallback, variant resolution.
- **Unit — service orchestration**
  (`tests/unit/core/application/services/feature-flags/feature-flag-service.test.ts`):
  unknown flag, global kill switch, environment default injection, a
  throwing provider never propagating (`ERROR_FALLBACK`), `listFlags`
  sort order, `updateFlag` creation/merge/audit-action-selection
  (`FEATURE_FLAG_UPDATED` vs `FEATURE_FLAG_KILL_SWITCH_TOGGLED`), `null`
  actor support.
- **Unit — provider**
  (`tests/unit/core/infrastructure/feature-flags/config-feature-flag-provider.test.ts`):
  get/list/upsert against the in-memory store.
- **Unit — config parsing**
  (`tests/unit/core/infrastructure/feature-flags/feature-flag-definitions.test.ts`):
  malformed JSON, schema-invalid entries, valid config, default-merge
  override semantics.
- **Unit — env schema**
  (`tests/unit/core/infrastructure/config/env.test.ts`, "Feature Flags
  module" block): `FEATURE_FLAGS_ENABLED` default/invalid-value
  fallback/valid values, `FEATURE_FLAGS_CONFIG` pass-through.
- **Integration — composition wiring**
  (`tests/integration/feature-flags/feature-flag-flows.test.ts`):
  imports the real `infrastructure/feature-flags/compose.ts` under a
  controlled `process.env` (the same pattern
  `tests/integration/cache/cache-flows.test.ts` uses), proving
  `FEATURE_FLAGS_CONFIG`/`FEATURE_FLAGS_ENABLED` reach the real service,
  that config overrides replace matching defaults, that role targeting
  integrates with the real `ROLES` constant, and that environment scoping
  uses the process's real `NODE_ENV`.

## 9. Known gaps / future improvements

- **No persistence for runtime `updateFlag` calls.** `ConfigFeatureFlagProvider`
  is process-local and in-memory — a change made via a future admin UI is
  visible immediately within that process only, and is lost on restart
  and not shared across horizontally-scaled instances. This is the
  documented, deliberate v1 trade-off (see `application/ports/feature-flag-provider.ts`'s
  doc comment); the fix is a new `FeatureFlagProvider` implementation
  (Prisma-backed or remote-config-backed), not a change to any consumer.
- **No admin UI/API routes were built** — out of scope per the task's own
  constraints ("you do not need to build the UI or HTTP routes"). §7
  above documents exactly how to add them following this codebase's
  existing admin-module pattern.
- **No caching of evaluation results.** Every `evaluate()` call re-fetches
  the definition from the provider (an in-memory `Map.get`, so effectively
  free today) and re-runs the evaluator. This is fine for the in-memory
  provider; a future remote-config-backed provider should add its own
  caching (e.g. via the existing `CacheManager`, Module 46) inside that
  provider implementation — again, a provider-level concern, invisible to
  `FeatureFlagService`.
- **No bulk/streaming update API** (e.g. "replace every flag at once")
  beyond one `upsertDefinition` per call — not a requirement today, and
  easy to add to the `FeatureFlagProvider` port later if needed.
