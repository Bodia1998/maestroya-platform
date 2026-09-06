import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Module 55 — Read Replicas: end-to-end wiring coverage, the same
 * `vi.resetModules()` + controlled-env pattern
 * `tests/integration/backup/backup-health-route-wiring.test.ts` (Module
 * 54) uses — proving `/api/health/ready` actually surfaces
 * `checks.readReplicas` via the real composition root, not just that the
 * pure `collectReadReplicaHealth` function works in isolation (already
 * covered by its own unit test).
 *
 * ## Test-timing margin (see MODULE_78_HEALTH_TEST_TIMEOUT_AUDIT.md)
 * The first test below does a real `vi.resetModules()` followed by a
 * fresh dynamic `import()` of the actual `/api/health/ready` route —
 * deliberate end-to-end coverage of the real composition root, not a
 * mock. Re-transforming and re-evaluating that module graph measures
 * ~4.0-4.5s even on an idle machine (confirmed by direct measurement in
 * this sandbox), leaving almost no margin against Vitest's own default
 * 5000ms `testTimeout` once this file runs alongside the rest of a
 * large, CPU-contended parallel suite — the exact same pre-existing
 * timing-margin defect the Module 78 audit already root-caused and fixed
 * in `tests/integration/health/health-routes-wiring.test.ts` and
 * `tests/integration/observability/health-routes.test.ts`. This file
 * exercises the identical pattern against the identical route but was
 * added without that same file-scoped override, so it inherited the
 * identical failure mode ("Test timed out in 5000ms") the first time it
 * ran under real contention. Scoped to *this file only* — never
 * `vitest.config.ts`'s global `testTimeout` — so every other test file's
 * fast-failure timeout stays exactly as tight as it was before.
 */
vi.setConfig({ testTimeout: 20000 });

describe("Module 55 — Read Replicas — /api/health/ready wiring", () => {
  afterEach(() => {
    for (const key of ["READ_REPLICAS_ENABLED", "DATABASE_REPLICA_URLS"]) {
      delete (process.env as Record<string, string | undefined>)[key];
    }
    vi.doUnmock("@/infrastructure/database/prisma/client");
    vi.resetModules();
  });

  it("reports 'disabled' by default, without affecting overall readiness", async () => {
    vi.doMock("@/infrastructure/database/prisma/client", () => ({
      prisma: { $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]) },
    }));
    (process.env as Record<string, string | undefined>).READ_REPLICAS_ENABLED = "false";
    vi.resetModules();

    const { NextRequest } = await import("next/server");
    const { GET } = await import("@/app/api/health/ready/route");
    const response = await GET(new NextRequest("http://localhost:3000/api/health/ready"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("ok");
    expect(body.checks.readReplicas.status).toBe("disabled");
  });

  it("getReadReplicaHealth() is directly importable and never throws with the module disabled", async () => {
    (process.env as Record<string, string | undefined>).READ_REPLICAS_ENABLED = "false";
    vi.resetModules();

    const { getReadReplicaHealth } = await import("@/infrastructure/database/compose");
    await expect(getReadReplicaHealth()).resolves.toMatchObject({ status: "disabled" });
  });

  it("a 'true' READ_REPLICAS_ENABLED with no DATABASE_REPLICA_URLS still resolves to 'disabled', never throws", async () => {
    vi.doMock("@/infrastructure/database/prisma/client", () => ({
      prisma: { $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]) },
    }));
    (process.env as Record<string, string | undefined>).READ_REPLICAS_ENABLED = "true";
    (process.env as Record<string, string | undefined>).DATABASE_REPLICA_URLS = "";
    vi.resetModules();

    const { NextRequest } = await import("next/server");
    const { GET } = await import("@/app/api/health/ready/route");
    const response = await GET(new NextRequest("http://localhost:3000/api/health/ready"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.checks.readReplicas.status).toBe("disabled");
  });
});
