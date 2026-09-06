import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Module 54 — Backup & Disaster Recovery: end-to-end wiring coverage,
 * the same `vi.resetModules()` + controlled-env pattern
 * `tests/integration/config/config-flows.test.ts` uses for Module 53 —
 * proving `/api/health/ready` actually surfaces this module's two checks
 * via the real composition root, not just that the pure `collect*Health`
 * functions work in isolation (already covered by the unit tests).
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

describe("Module 54 — Backup & Disaster Recovery — /api/health/ready wiring", () => {
  afterEach(() => {
    delete (process.env as Record<string, string | undefined>).BACKUP_ENABLED;
    vi.doUnmock("@/infrastructure/database/prisma/client");
    vi.resetModules();
  });

  it("reports both checks as 'disabled' by default, without affecting overall readiness", async () => {
    vi.doMock("@/infrastructure/database/prisma/client", () => ({
      prisma: { $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]) },
    }));
    (process.env as Record<string, string | undefined>).BACKUP_ENABLED = "false";
    vi.resetModules();

    const { NextRequest } = await import("next/server");
    const { GET } = await import("@/app/api/health/ready/route");
    const response = await GET(new NextRequest("http://localhost:3000/api/health/ready"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("ok");
    expect(body.checks.backup.status).toBe("disabled");
    expect(body.checks.disasterRecovery.status).toBe("disabled");
  });

  it("getBackupHealth()/getRecoveryHealth() are directly importable and never throw with the pipeline disabled", async () => {
    (process.env as Record<string, string | undefined>).BACKUP_ENABLED = "false";
    vi.resetModules();

    const { getBackupHealth, getRecoveryHealth } = await import("@/infrastructure/backup/compose");
    await expect(getBackupHealth()).resolves.toMatchObject({ status: "disabled" });
    await expect(getRecoveryHealth()).resolves.toMatchObject({ status: "disabled" });
  });
});
