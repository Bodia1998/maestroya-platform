import { afterEach, describe, expect, it, vi } from "vitest";

import { VALID_BASE_ENV } from "../../unit/core/infrastructure/config/env-fixture";

/**
 * Feature Flags module — end-to-end wiring/composition coverage.
 *
 * Unlike the unit tests (`tests/unit/core/domain/services/feature-flag-*`,
 * `tests/unit/core/application/services/feature-flags/`, which exercise
 * the pure evaluator and `FeatureFlagService` against hand-built fakes),
 * this suite imports the real composition root
 * (`infrastructure/feature-flags/compose.ts`) under a controlled
 * `process.env`, the same `vi.resetModules()` + re-import pattern
 * `tests/integration/cache/cache-flows.test.ts` and
 * `tests/integration/tracing/trace-propagation.test.ts` use for
 * env-driven wiring — proving `FEATURE_FLAGS_CONFIG`/`FEATURE_FLAGS_ENABLED`
 * actually reach the real `ConfigFeatureFlagProvider`/`FeatureFlagService`
 * instances the rest of the app would get via `getFeatureFlagService()`.
 *
 * Deliberately exercises only the read/evaluate path
 * (`evaluateFlag`/`isFeatureEnabled`/`getFeatureFlagService().listFlags()`),
 * never `updateFlag` — the composition root wires a real
 * `PrismaAdminAuditLogRepository`, which requires a live database
 * connection this test environment doesn't have. `updateFlag`'s audit-log
 * behaviour is already fully covered against a fake
 * `AdminAuditLogRepository` in
 * `tests/unit/core/application/services/feature-flags/feature-flag-service.test.ts`.
 *
 * The real Prisma client is mocked out entirely (never queried by any
 * assertion here anyway), the same way
 * `tests/unit/core/infrastructure/search/compose.test.ts`/
 * `tests/integration/observability/health-routes.test.ts` already do for
 * their own compose-root tests — this keeps the suite from depending on a
 * real database or on the native query-engine binary matching whatever
 * OS/arch happens to run the tests.
 */
vi.mock("@/infrastructure/database/prisma/client", () => ({ prisma: {} }));

async function loadFeatureFlagsModule(overrides: Record<string, string | undefined> = {}) {
  const mutableEnv = process.env as Record<string, string | undefined>;
  for (const [key, value] of Object.entries(VALID_BASE_ENV)) mutableEnv[key] = value;
  mutableEnv.NODE_ENV = "test";
  delete mutableEnv.FEATURE_FLAGS_ENABLED;
  delete mutableEnv.FEATURE_FLAGS_CONFIG;
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete mutableEnv[key];
    else mutableEnv[key] = value;
  }

  vi.resetModules();
  return import("@/infrastructure/feature-flags/compose");
}

describe("Feature Flags module — composition wiring", () => {
  afterEach(() => {
    const mutableEnv = process.env as Record<string, string | undefined>;
    delete mutableEnv.FEATURE_FLAGS_ENABLED;
    delete mutableEnv.FEATURE_FLAGS_CONFIG;
    delete mutableEnv.NODE_ENV;
  });

  it("evaluates a flag defined via FEATURE_FLAGS_CONFIG", async () => {
    const config = JSON.stringify([{ key: "config-flag", enabled: true, environments: ["test"] }]);
    const { evaluateFlag } = await loadFeatureFlagsModule({ FEATURE_FLAGS_CONFIG: config });

    const result = await evaluateFlag("config-flag", { userId: "u1" });

    expect(result.enabled).toBe(true);
    expect(result.reason).toBe("DEFAULT_ENABLED");
  });

  it("FEATURE_FLAGS_CONFIG overrides a code-defined default with the same key", async () => {
    const config = JSON.stringify([{ key: "example-feature-flag", enabled: false }]);
    const { evaluateFlag } = await loadFeatureFlagsModule({ FEATURE_FLAGS_CONFIG: config });

    const result = await evaluateFlag("example-feature-flag", { userId: "u1", environment: "production" });

    expect(result.enabled).toBe(false);
    expect(result.reason).toBe("FLAG_DISABLED");
  });

  it("an unknown flag key fails closed (disabled) end-to-end", async () => {
    const { isFeatureEnabled } = await loadFeatureFlagsModule();
    await expect(isFeatureEnabled("totally-unknown-flag")).resolves.toBe(false);
  });

  it("FEATURE_FLAGS_ENABLED=false forces every flag off, overriding an otherwise fully-enabled flag", async () => {
    const config = JSON.stringify([{ key: "config-flag", enabled: true, rollout: { percentage: 100 } }]);
    const { evaluateFlag } = await loadFeatureFlagsModule({
      FEATURE_FLAGS_CONFIG: config,
      FEATURE_FLAGS_ENABLED: "false",
    });

    const result = await evaluateFlag("config-flag", { userId: "u1" });

    expect(result.enabled).toBe(false);
    expect(result.reason).toBe("GLOBAL_KILL_SWITCH");
  });

  it("percentage rollout is deterministic across independently-loaded module instances", async () => {
    const config = JSON.stringify([{ key: "rollout-flag", enabled: true, rollout: { percentage: 50 } }]);

    const first = await loadFeatureFlagsModule({ FEATURE_FLAGS_CONFIG: config });
    const firstResult = await first.evaluateFlag("rollout-flag", { userId: "stable-user-id" });

    const second = await loadFeatureFlagsModule({ FEATURE_FLAGS_CONFIG: config });
    const secondResult = await second.evaluateFlag("rollout-flag", { userId: "stable-user-id" });

    expect(firstResult.enabled).toBe(secondResult.enabled);
  });

  it("role targeting integrates with the platform's real role keys (infrastructure/auth/rbac.ts ROLES)", async () => {
    const { ROLES } = await import("@/infrastructure/auth/rbac");
    const config = JSON.stringify([
      {
        key: "admin-only-flag",
        enabled: true,
        rollout: { percentage: 0 },
        targeting: { roleAllowList: [ROLES.ADMIN] },
      },
    ]);
    const { evaluateFlag } = await loadFeatureFlagsModule({ FEATURE_FLAGS_CONFIG: config });

    const asAdmin = await evaluateFlag("admin-only-flag", { userId: "u1", roles: [ROLES.ADMIN] });
    const asCustomer = await evaluateFlag("admin-only-flag", { userId: "u2", roles: [ROLES.CUSTOMER] });

    expect(asAdmin.enabled).toBe(true);
    expect(asAdmin.reason).toBe("ROLE_TARGETED");
    expect(asCustomer.enabled).toBe(false);
  });

  it("environment scoping uses the process's own NODE_ENV as the evaluation default", async () => {
    const config = JSON.stringify([{ key: "prod-only-flag", enabled: true, environments: ["production"] }]);
    const { evaluateFlag } = await loadFeatureFlagsModule({ FEATURE_FLAGS_CONFIG: config });

    // No explicit `environment` in context — the service defaults it from
    // env.NODE_ENV, which this test fixture sets to "test", not "production".
    const result = await evaluateFlag("prod-only-flag", { userId: "u1" });

    expect(result.enabled).toBe(false);
    expect(result.reason).toBe("ENVIRONMENT_SCOPED");
  });

  it("listFlags() surfaces both code-defined defaults and config-provided flags together", async () => {
    const config = JSON.stringify([{ key: "extra-flag", enabled: true }]);
    const { getFeatureFlagService } = await loadFeatureFlagsModule({ FEATURE_FLAGS_CONFIG: config });

    const flags = await getFeatureFlagService().listFlags();

    expect(flags.some((f) => f.key === "extra-flag")).toBe(true);
    expect(flags.some((f) => f.key === "example-feature-flag")).toBe(true);
  });

  it("malformed FEATURE_FLAGS_CONFIG never breaks composition — falls back to the code-defined defaults", async () => {
    const { getFeatureFlagService } = await loadFeatureFlagsModule({ FEATURE_FLAGS_CONFIG: "{not valid json" });

    const flags = await getFeatureFlagService().listFlags();

    expect(flags.some((f) => f.key === "example-feature-flag")).toBe(true);
  });
});
