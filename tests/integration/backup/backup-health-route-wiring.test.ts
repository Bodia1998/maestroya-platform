import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Module 54 — Backup & Disaster Recovery: end-to-end wiring coverage,
 * the same `vi.resetModules()` + controlled-env pattern
 * `tests/integration/config/config-flows.test.ts` uses for Module 53 —
 * proving `/api/health/ready` actually surfaces this module's two checks
 * via the real composition root, not just that the pure `collect*Health`
 * functions work in isolation (already covered by the unit tests).
 */
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
