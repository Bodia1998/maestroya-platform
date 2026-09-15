import { describe, expect, it } from "vitest";

import {
  CapacityPersistenceBlockedError,
  assertCapacityPersistenceAllowed,
  classifyDatabaseUrl,
  evaluateCapacityPersistence,
} from "@/infrastructure/database/capacity-persistence-guard";

/**
 * Module 110 — Capacity Tool Safety & Environment Isolation.
 *
 * Regression coverage for the guard that fixes Module 109's Finding F1
 * (`PersistCapacityReportUseCase`/`GenerateCapacityReportUseCase` could
 * write synthetic `LoadTestRun`/`PerformanceBaseline` rows into whatever
 * `DATABASE_URL` happened to be active). Every test builds its own
 * `NodeJS.ProcessEnv`-shaped object and passes it explicitly to
 * `evaluateCapacityPersistence`/`assertCapacityPersistenceAllowed` —
 * never touching real `process.env` or a real database connection, per
 * this module's "no real Supabase/database writes performed by unit
 * tests" requirement.
 */

const SAFE_LOCAL_TEST_DB = "postgresql://postgres:postgres@localhost:5432/maestroya_test?schema=public";
const SAFE_LOCAL_CAPACITY_TEST_DB = "postgresql://postgres:postgres@localhost:5432/maestroya_capacity_test?schema=public";
const LOCAL_DEV_DB = "postgresql://postgres:postgres@localhost:5432/maestroya_dev?schema=public";
const SHARED_SUPABASE_DB = "postgresql://user:pass@aws-0-eu-west-1.pooler.supabase.com:5432/postgres?pgbouncer=true";
const STAGING_LOOKING_SUPABASE_DB = "postgresql://user:pass@db.staging-project.supabase.co:5432/postgres";
const UNKNOWN_HOST_DB = "postgresql://user:pass@10.0.4.17:5432/maestroya_test";

function envWith(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return { ...overrides } as NodeJS.ProcessEnv;
}

describe("infrastructure/database/capacity-persistence-guard — classifyDatabaseUrl", () => {
  it("classifies a local host with a disposable-looking name as disposable-test (safe)", () => {
    const result = classifyDatabaseUrl(SAFE_LOCAL_TEST_DB);
    expect(result.category).toBe("disposable-test");
    expect(result.safe).toBe(true);
    expect(result.host).toBe("localhost");
  });

  it("classifies a local host with a capacity-test-dedicated name as approved-capacity-test (safe)", () => {
    const result = classifyDatabaseUrl(SAFE_LOCAL_CAPACITY_TEST_DB);
    expect(result.category).toBe("approved-capacity-test");
    expect(result.safe).toBe(true);
  });

  it("classifies a local host with a normal development-looking name as development (unsafe)", () => {
    const result = classifyDatabaseUrl(LOCAL_DEV_DB);
    expect(result.category).toBe("development");
    expect(result.safe).toBe(false);
  });

  it("classifies a managed Supabase host as production-shared (unsafe), regardless of a test-sounding database name", () => {
    const result = classifyDatabaseUrl("postgresql://user:pass@aws-0-eu-west-1.pooler.supabase.com:5432/maestroya_test");
    expect(result.category).toBe("production-shared");
    expect(result.safe).toBe(false);
  });

  it("classifies a managed host whose own name suggests staging as staging (still unsafe)", () => {
    const result = classifyDatabaseUrl(STAGING_LOOKING_SUPABASE_DB);
    expect(result.category).toBe("staging");
    expect(result.safe).toBe(false);
  });

  it("classifies an unrecognized host (neither managed-provider marker nor local/CI host) as unknown (unsafe)", () => {
    const result = classifyDatabaseUrl(UNKNOWN_HOST_DB);
    expect(result.category).toBe("unknown");
    expect(result.safe).toBe(false);
  });

  it("classifies a malformed URL as unknown (unsafe), never throwing", () => {
    const result = classifyDatabaseUrl("not-a-url");
    expect(result.category).toBe("unknown");
    expect(result.safe).toBe(false);
    expect(result.host).toBeNull();
  });

  it("classifies an unset DATABASE_URL as unknown (unsafe)", () => {
    expect(classifyDatabaseUrl(undefined).category).toBe("unknown");
    expect(classifyDatabaseUrl("").category).toBe("unknown");
  });

  it("never echoes URL credentials in the reason string", () => {
    const result = classifyDatabaseUrl(SHARED_SUPABASE_DB);
    expect(result.reason).not.toContain("user:pass");
  });
});

describe("infrastructure/database/capacity-persistence-guard — evaluateCapacityPersistence / assertCapacityPersistenceAllowed", () => {
  it("Requirement 1: rejects by default (no ALLOW_CAPACITY_REPORT_PERSISTENCE) even with an otherwise-safe DATABASE_URL", () => {
    const env = envWith({ DATABASE_URL: SAFE_LOCAL_TEST_DB });
    const decision = evaluateCapacityPersistence(env);
    expect(decision.allowed).toBe(false);
    expect(decision.optedIn).toBe(false);
    expect(() => assertCapacityPersistenceAllowed(env)).toThrow(CapacityPersistenceBlockedError);
  });

  it("Requirement 2: a normal local development DATABASE_URL cannot be used for synthetic persistence, even with opt-in", () => {
    const env = envWith({ ALLOW_CAPACITY_REPORT_PERSISTENCE: "true", DATABASE_URL: LOCAL_DEV_DB });
    const decision = evaluateCapacityPersistence(env);
    expect(decision.allowed).toBe(false);
    expect(decision.database.category).toBe("development");
  });

  it("Requirement 3: a production/shared managed database is rejected, even with opt-in", () => {
    const env = envWith({ ALLOW_CAPACITY_REPORT_PERSISTENCE: "true", DATABASE_URL: SHARED_SUPABASE_DB });
    const decision = evaluateCapacityPersistence(env);
    expect(decision.allowed).toBe(false);
    expect(decision.database.category).toBe("production-shared");
  });

  it("Requirement 4: an unknown/unclassifiable database is rejected, even with opt-in", () => {
    const env = envWith({ ALLOW_CAPACITY_REPORT_PERSISTENCE: "true", DATABASE_URL: UNKNOWN_HOST_DB });
    const decision = evaluateCapacityPersistence(env);
    expect(decision.allowed).toBe(false);
    expect(decision.database.category).toBe("unknown");
  });

  it("Requirement 5: the opt-in flag alone is insufficient when DATABASE_URL is missing entirely", () => {
    const env = envWith({ ALLOW_CAPACITY_REPORT_PERSISTENCE: "true" });
    const decision = evaluateCapacityPersistence(env);
    expect(decision.allowed).toBe(false);
    expect(decision.database.category).toBe("unknown");
  });

  it("Requirement 6: an approved disposable/test database CAN persist once explicitly enabled", () => {
    const env = envWith({ ALLOW_CAPACITY_REPORT_PERSISTENCE: "true", DATABASE_URL: SAFE_LOCAL_TEST_DB });
    const decision = evaluateCapacityPersistence(env);
    expect(decision.allowed).toBe(true);
    expect(() => assertCapacityPersistenceAllowed(env)).not.toThrow();
  });

  it("also allows the explicitly-dedicated approved-capacity-test category once enabled", () => {
    const env = envWith({ ALLOW_CAPACITY_REPORT_PERSISTENCE: "true", DATABASE_URL: SAFE_LOCAL_CAPACITY_TEST_DB });
    expect(evaluateCapacityPersistence(env).allowed).toBe(true);
  });

  it("a safe DATABASE_URL alone, without the opt-in flag, is still rejected (both conditions required)", () => {
    const env = envWith({ DATABASE_URL: SAFE_LOCAL_TEST_DB });
    expect(evaluateCapacityPersistence(env).allowed).toBe(false);
  });

  it("only the exact string \"true\" opts in — a truthy-looking but different value stays disabled", () => {
    const env = envWith({ ALLOW_CAPACITY_REPORT_PERSISTENCE: "1", DATABASE_URL: SAFE_LOCAL_TEST_DB });
    expect(evaluateCapacityPersistence(env).allowed).toBe(false);
  });

  it("Requirement 8: every rejection carries a clear, human-readable reason explaining why", () => {
    const blockedByDefault = evaluateCapacityPersistence(envWith({ DATABASE_URL: SHARED_SUPABASE_DB }));
    expect(blockedByDefault.reason).toBeDefined();
    expect(blockedByDefault.reason!.length).toBeGreaterThan(20);

    const optedInButUnsafe = evaluateCapacityPersistence(envWith({ ALLOW_CAPACITY_REPORT_PERSISTENCE: "true", DATABASE_URL: SHARED_SUPABASE_DB }));
    expect(optedInButUnsafe.reason).toContain("production-shared");

    try {
      assertCapacityPersistenceAllowed(envWith({ DATABASE_URL: SHARED_SUPABASE_DB }));
      throw new Error("expected assertCapacityPersistenceAllowed to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(CapacityPersistenceBlockedError);
      expect((error as Error).message.length).toBeGreaterThan(20);
    }
  });

  it("defense in depth: rejects even a fully-opted-in, safe DATABASE_URL while NODE_ENV=production", () => {
    const env = envWith({ ALLOW_CAPACITY_REPORT_PERSISTENCE: "true", DATABASE_URL: SAFE_LOCAL_TEST_DB, NODE_ENV: "production" });
    const decision = evaluateCapacityPersistence(env);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("NODE_ENV=production");
  });

  it("bypass check: NODE_ENV=development alone (Module 109's exact concern) does not make an unsafe DATABASE_URL pass", () => {
    // The scenario Module 109's brief calls out explicitly: a developer
    // can have NODE_ENV=development while DATABASE_URL points at a real
    // shared Supabase database. This must stay blocked — the decision is
    // driven by DATABASE_URL's own shape, never by NODE_ENV alone.
    const env = envWith({ ALLOW_CAPACITY_REPORT_PERSISTENCE: "true", DATABASE_URL: SHARED_SUPABASE_DB, NODE_ENV: "development" });
    expect(evaluateCapacityPersistence(env).allowed).toBe(false);
  });
});
