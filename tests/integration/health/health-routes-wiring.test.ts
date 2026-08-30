import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Test-timing note (investigated while diagnosing Module 78's `npm test`
 * run — see MODULE_78_HEALTH_TEST_TIMEOUT_AUDIT.md for the full audit;
 * Module 78 itself does not touch health/observability/circuit-breaker
 * code and is not the cause of the underlying timing margin):
 *
 * Nearly every test below does a real `vi.resetModules()` followed by a
 * fresh dynamic `import()` of the actual health/observability route
 * composition root — deliberate end-to-end coverage of the real wiring,
 * not a mock. Re-transforming and re-evaluating that module graph, plus
 * (for the diagnostics/full-readiness-aggregation tests specifically)
 * dependency checks bounded by `CIRCUIT_BREAKER_TIMEOUT_MS` (defaults to
 * 5000ms — see `@/infrastructure/config/env.ts`), already measured 4.0-4.5s
 * on an otherwise idle machine — leaving almost no margin against Vitest's
 * own default 5000ms `testTimeout` once this file runs alongside the rest
 * of a large, CPU-contended parallel suite. That race (two independent
 * ~5s budgets, near-zero margin) is the actual root cause of the
 * intermittent "Test timed out in 5000ms" failures, not a functional
 * defect in these routes. Scoped to *this file only* — never
 * `vitest.config.ts`'s global `testTimeout` — so every other test file's
 * fast-failure timeout stays exactly as tight as it was before.
 */
vi.setConfig({ testTimeout: 20000 });


/**
 * Module 56 — Health Checks & Circuit Breakers: end-to-end wiring
 * coverage, the same `vi.doMock` + `vi.resetModules()` pattern
 * `tests/integration/backup/backup-health-route-wiring.test.ts` uses —
 * proving the new routes actually work through the real composition
 * root (`infrastructure/health/compose.ts`), not just that the pure
 * domain/application pieces work in isolation (already covered by unit
 * tests).
 */
describe("Module 56 — health routes wiring", () => {
  afterEach(() => {
    vi.doUnmock("@/infrastructure/database/prisma/client");
    vi.doUnmock("@/lib/auth");
    vi.doUnmock("@/infrastructure/database/prisma/repositories/prisma-user-repository");
    vi.resetModules();
  });

  it("/api/health/startup reports 'started' when the database is reachable", async () => {
    vi.doMock("@/infrastructure/database/prisma/client", () => ({
      prisma: { $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]) },
    }));
    vi.resetModules();

    const { NextRequest } = await import("next/server");
    const { GET } = await import("@/app/api/health/startup/route");
    const response = await GET(new NextRequest("http://localhost:3000/api/health/startup"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("started");
  });

  it("/api/health/startup returns 503 with status 'starting' when the database is unreachable", async () => {
    vi.doMock("@/infrastructure/database/prisma/client", () => ({
      prisma: { $queryRaw: vi.fn().mockRejectedValue(new Error("connection refused")) },
    }));
    vi.resetModules();

    const { NextRequest } = await import("next/server");
    const { GET } = await import("@/app/api/health/startup/route");
    const response = await GET(new NextRequest("http://localhost:3000/api/health/startup"));

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.status).toBe("starting");
  });

  it("/api/health/diagnostics aggregates every registered subsystem into one platform report", async () => {
    vi.doMock("@/infrastructure/database/prisma/client", () => ({
      prisma: { $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]) },
    }));
    // Module 70.1 — Pre-Stripe Security & Integration Hardening: this
    // route now requires ADMIN/SUPER_ADMIN (see that route's own doc
    // comment) — every test below that exercises it now authenticates as
    // an ADMIN via the same vi.doMock pattern this file already uses for
    // the Prisma client.
    vi.doMock("@/lib/auth", () => ({
      auth: vi.fn().mockResolvedValue({ user: { id: "admin-1", email: "admin@test.example", roles: ["ADMIN"], signupIntent: null } }),
    }));
    // Module 82 — Admin RBAC & Production Auth Hardening: requireRole() now
    // re-verifies status/roles fresh from the DB for admin-tier checks (see
    // rbac.ts's own doc comment), so the fake session above is no longer
    // sufficient on its own — mock the one collaborator it queries, the same
    // way tests/unit/app/api/health/diagnostics-route.test.ts and
    // tests/unit/core/infrastructure/auth/rbac.test.ts already do.
    vi.doMock("@/infrastructure/database/prisma/repositories/prisma-user-repository", () => ({
      PrismaUserRepository: vi.fn().mockImplementation(() => ({
        findById: vi.fn().mockResolvedValue({ id: "admin-1", status: "ACTIVE" }),
        getRoleKeys: vi.fn().mockResolvedValue(["ADMIN"]),
      })),
    }));
    vi.resetModules();

    const { NextRequest } = await import("next/server");
    const { GET } = await import("@/app/api/health/diagnostics/route");
    const response = await GET(new NextRequest("http://localhost:3000/api/health/diagnostics"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(["HEALTHY", "DEGRADED", "UNHEALTHY"]).toContain(body.status);
    expect(Array.isArray(body.subsystems)).toBe(true);
    expect(body.subsystems.length).toBeGreaterThan(0);
    expect(Array.isArray(body.dependencies)).toBe(true);
    expect(Array.isArray(body.circuitBreakers)).toBe(true);

    const postgres = body.subsystems.find((c: { component: string }) => c.component === "postgres-primary");
    expect(postgres?.status).toBe("HEALTHY");
  });

  it("/api/health/diagnostics reports a failing postgres check as UNHEALTHY without affecting other subsystems", async () => {
    vi.doMock("@/infrastructure/database/prisma/client", () => ({
      prisma: { $queryRaw: vi.fn().mockRejectedValue(new Error("connection refused")) },
    }));
    vi.doMock("@/lib/auth", () => ({
      auth: vi.fn().mockResolvedValue({ user: { id: "admin-1", email: "admin@test.example", roles: ["ADMIN"], signupIntent: null } }),
    }));
    // Module 82 — Admin RBAC & Production Auth Hardening: requireRole() now
    // re-verifies status/roles fresh from the DB for admin-tier checks (see
    // rbac.ts's own doc comment), so the fake session above is no longer
    // sufficient on its own — mock the one collaborator it queries, the same
    // way tests/unit/app/api/health/diagnostics-route.test.ts and
    // tests/unit/core/infrastructure/auth/rbac.test.ts already do.
    vi.doMock("@/infrastructure/database/prisma/repositories/prisma-user-repository", () => ({
      PrismaUserRepository: vi.fn().mockImplementation(() => ({
        findById: vi.fn().mockResolvedValue({ id: "admin-1", status: "ACTIVE" }),
        getRoleKeys: vi.fn().mockResolvedValue(["ADMIN"]),
      })),
    }));
    vi.resetModules();

    const { NextRequest } = await import("next/server");
    const { GET } = await import("@/app/api/health/diagnostics/route");
    const response = await GET(new NextRequest("http://localhost:3000/api/health/diagnostics"));

    const body = await response.json();
    expect(body.status).toBe("UNHEALTHY");
    const postgres = body.subsystems.find((c: { component: string }) => c.component === "postgres-primary");
    expect(postgres?.status).toBe("UNHEALTHY");
    // A dependency configured to have no external backend by default
    // (e.g. Stripe requires credentials, present in the fixture env) —
    // failure isolation means unrelated subsystems are unaffected.
    const backup = body.subsystems.find((c: { component: string }) => c.component === "backup");
    expect(backup?.status).not.toBe("UNHEALTHY");
  });

  it("/api/health/circuit-breakers GET returns a snapshot for every registered breaker after diagnostics has run once", async () => {
    vi.doMock("@/infrastructure/database/prisma/client", () => ({
      prisma: { $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]) },
    }));
    vi.doMock("@/lib/auth", () => ({
      auth: vi.fn().mockResolvedValue({ user: { id: "admin-1", email: "admin@test.example", roles: ["ADMIN"], signupIntent: null } }),
    }));
    // Module 82 — Admin RBAC & Production Auth Hardening: requireRole() now
    // re-verifies status/roles fresh from the DB for admin-tier checks (see
    // rbac.ts's own doc comment), so the fake session above is no longer
    // sufficient on its own — mock the one collaborator it queries, the same
    // way tests/unit/app/api/health/diagnostics-route.test.ts and
    // tests/unit/core/infrastructure/auth/rbac.test.ts already do.
    vi.doMock("@/infrastructure/database/prisma/repositories/prisma-user-repository", () => ({
      PrismaUserRepository: vi.fn().mockImplementation(() => ({
        findById: vi.fn().mockResolvedValue({ id: "admin-1", status: "ACTIVE" }),
        getRoleKeys: vi.fn().mockResolvedValue(["ADMIN"]),
      })),
    }));
    vi.resetModules();

    const { NextRequest } = await import("next/server");
    const { GET: getDiagnostics } = await import("@/app/api/health/diagnostics/route");
    await getDiagnostics(new NextRequest("http://localhost:3000/api/health/diagnostics"));

    const { GET } = await import("@/app/api/health/circuit-breakers/route");
    const response = await GET(new NextRequest("http://localhost:3000/api/health/circuit-breakers"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.circuitBreakers.length).toBeGreaterThan(0);
    expect(body.dependencies.length).toBe(body.circuitBreakers.length);
    const postgres = body.circuitBreakers.find((b: { name: string }) => b.name === "postgres-primary");
    expect(postgres?.state).toBe("CLOSED");
  });

  it("/api/health/circuit-breakers POST resets a named breaker", async () => {
    vi.doMock("@/infrastructure/database/prisma/client", () => ({
      prisma: { $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]) },
    }));
    vi.doMock("@/lib/auth", () => ({
      auth: vi.fn().mockResolvedValue({ user: { id: "admin-1", email: "admin@test.example", roles: ["ADMIN"], signupIntent: null } }),
    }));
    // Module 82 — Admin RBAC & Production Auth Hardening: requireRole() now
    // re-verifies status/roles fresh from the DB for admin-tier checks (see
    // rbac.ts's own doc comment), so the fake session above is no longer
    // sufficient on its own — mock the one collaborator it queries, the same
    // way tests/unit/app/api/health/diagnostics-route.test.ts and
    // tests/unit/core/infrastructure/auth/rbac.test.ts already do.
    vi.doMock("@/infrastructure/database/prisma/repositories/prisma-user-repository", () => ({
      PrismaUserRepository: vi.fn().mockImplementation(() => ({
        findById: vi.fn().mockResolvedValue({ id: "admin-1", status: "ACTIVE" }),
        getRoleKeys: vi.fn().mockResolvedValue(["ADMIN"]),
      })),
    }));
    vi.resetModules();

    const { NextRequest } = await import("next/server");
    const { GET: getDiagnostics } = await import("@/app/api/health/diagnostics/route");
    await getDiagnostics(new NextRequest("http://localhost:3000/api/health/diagnostics"));

    const { POST } = await import("@/app/api/health/circuit-breakers/route");
    const response = await POST(
      new NextRequest("http://localhost:3000/api/health/circuit-breakers", {
        method: "POST",
        body: JSON.stringify({ name: "postgres-primary" }),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.reset).toEqual(["postgres-primary"]);
  });

  it("/api/health/circuit-breakers POST returns 404 for an unregistered breaker name", async () => {
    vi.doMock("@/infrastructure/database/prisma/client", () => ({
      prisma: { $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]) },
    }));
    vi.doMock("@/lib/auth", () => ({
      auth: vi.fn().mockResolvedValue({ user: { id: "admin-1", email: "admin@test.example", roles: ["ADMIN"], signupIntent: null } }),
    }));
    // Module 82 — Admin RBAC & Production Auth Hardening: requireRole() now
    // re-verifies status/roles fresh from the DB for admin-tier checks (see
    // rbac.ts's own doc comment), so the fake session above is no longer
    // sufficient on its own — mock the one collaborator it queries, the same
    // way tests/unit/app/api/health/diagnostics-route.test.ts and
    // tests/unit/core/infrastructure/auth/rbac.test.ts already do.
    vi.doMock("@/infrastructure/database/prisma/repositories/prisma-user-repository", () => ({
      PrismaUserRepository: vi.fn().mockImplementation(() => ({
        findById: vi.fn().mockResolvedValue({ id: "admin-1", status: "ACTIVE" }),
        getRoleKeys: vi.fn().mockResolvedValue(["ADMIN"]),
      })),
    }));
    vi.resetModules();

    const { NextRequest } = await import("next/server");
    const { POST } = await import("@/app/api/health/circuit-breakers/route");
    const response = await POST(
      new NextRequest("http://localhost:3000/api/health/circuit-breakers", {
        method: "POST",
        body: JSON.stringify({ name: "does-not-exist" }),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(response.status).toBe(404);
  });

  it("/api/health and /api/health/ready remain unmodified — untouched by Module 56", async () => {
    vi.doMock("@/infrastructure/database/prisma/client", () => ({
      prisma: { $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]) },
    }));
    vi.resetModules();

    const { NextRequest } = await import("next/server");
    const { GET: liveness } = await import("@/app/api/health/route");
    const livenessResponse = await liveness(new NextRequest("http://localhost:3000/api/health"));
    expect(livenessResponse.status).toBe(200);
    const livenessBody = await livenessResponse.json();
    expect(livenessBody).toEqual({ status: "ok", timestamp: expect.any(String) });

    const { GET: readiness } = await import("@/app/api/health/ready/route");
    const readinessResponse = await readiness(new NextRequest("http://localhost:3000/api/health/ready"));
    expect(readinessResponse.status).toBe(200);
  });
});
