import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Module 92 — Reconciliation Full-Ledger Coverage & Advancing Cursor.
 *
 * Unit coverage (mocked Prisma client — real-DB behavior of the actual
 * keyset query/index is covered separately under
 * `tests/integration-db/financial/reconciliation-schedule-cursor.test.ts`)
 * for `PrismaReconciliationDataSource.listJobIdsToInspectFromCursor`'s own
 * query-construction and pagination-boundary logic: the `(createdAt, id)`
 * `OR` keyset predicate, the `limit + 1` over-fetch, and the
 * `cycleCompleted` boundary condition.
 */

vi.mock("@/infrastructure/database/prisma/client", () => ({
  prisma: {
    job: { findMany: vi.fn() },
  },
}));

function row(id: string, createdAt: Date) {
  return { id, createdAt };
}

describe("PrismaReconciliationDataSource.listJobIdsToInspectFromCursor", () => {
  beforeEach(async () => {
    const { prisma } = await import("@/infrastructure/database/prisma/client");
    const mocked = prisma as unknown as { job: { findMany: ReturnType<typeof vi.fn> } };
    mocked.job.findMany.mockReset();
  });

  it("queries with no keyset predicate and ascending (createdAt, id) order when `after` is null", async () => {
    const { prisma } = await import("@/infrastructure/database/prisma/client");
    const { PrismaReconciliationDataSource } = await import(
      "@/infrastructure/database/prisma/repositories/prisma-reconciliation-data-source"
    );
    const mocked = prisma as unknown as { job: { findMany: ReturnType<typeof vi.fn> } };
    mocked.job.findMany.mockResolvedValueOnce([row("job-1", new Date("2026-01-01"))]);

    const dataSource = new PrismaReconciliationDataSource();
    await dataSource.listJobIdsToInspectFromCursor({ after: null, limit: 500 });

    const call = mocked.job.findMany.mock.calls[0]![0];
    expect(call.where.quote).toEqual({ payments: { some: {} } });
    expect(call.where.OR).toBeUndefined();
    expect(call.orderBy).toEqual([{ createdAt: "asc" }, { id: "asc" }]);
    expect(call.take).toBe(501); // limit + 1 over-fetch
  });

  it("builds a (createdAt, id) OR keyset predicate strictly-after `after`", async () => {
    const { prisma } = await import("@/infrastructure/database/prisma/client");
    const { PrismaReconciliationDataSource } = await import(
      "@/infrastructure/database/prisma/repositories/prisma-reconciliation-data-source"
    );
    const mocked = prisma as unknown as { job: { findMany: ReturnType<typeof vi.fn> } };
    mocked.job.findMany.mockResolvedValueOnce([]);

    const dataSource = new PrismaReconciliationDataSource();
    const after = { createdAt: new Date("2026-03-01T00:00:00.000Z"), id: "job-cursor" };
    await dataSource.listJobIdsToInspectFromCursor({ after, limit: 10 });

    const call = mocked.job.findMany.mock.calls[0]![0];
    expect(call.where.OR).toEqual([
      { createdAt: { gt: after.createdAt } },
      { createdAt: after.createdAt, id: { gt: after.id } },
    ]);
  });

  it("cycleCompleted is false and the extra over-fetched row is trimmed when more rows exist beyond `limit`", async () => {
    const { prisma } = await import("@/infrastructure/database/prisma/client");
    const { PrismaReconciliationDataSource } = await import(
      "@/infrastructure/database/prisma/repositories/prisma-reconciliation-data-source"
    );
    const mocked = prisma as unknown as { job: { findMany: ReturnType<typeof vi.fn> } };
    const rows = [
      row("job-1", new Date("2026-01-01")),
      row("job-2", new Date("2026-01-02")),
      row("job-3", new Date("2026-01-03")), // the limit+1 lookahead row
    ];
    mocked.job.findMany.mockResolvedValueOnce(rows);

    const dataSource = new PrismaReconciliationDataSource();
    const batch = await dataSource.listJobIdsToInspectFromCursor({ after: null, limit: 2 });

    expect(batch.jobIds).toEqual(["job-1", "job-2"]);
    expect(batch.cycleCompleted).toBe(false);
    expect(batch.nextCursor).toEqual({ createdAt: new Date("2026-01-02"), id: "job-2" });
  });

  it("cycleCompleted is true and nothing is trimmed when the returned rows are within `limit`", async () => {
    const { prisma } = await import("@/infrastructure/database/prisma/client");
    const { PrismaReconciliationDataSource } = await import(
      "@/infrastructure/database/prisma/repositories/prisma-reconciliation-data-source"
    );
    const mocked = prisma as unknown as { job: { findMany: ReturnType<typeof vi.fn> } };
    mocked.job.findMany.mockResolvedValueOnce([row("job-1", new Date("2026-01-01"))]);

    const dataSource = new PrismaReconciliationDataSource();
    const batch = await dataSource.listJobIdsToInspectFromCursor({ after: null, limit: 5 });

    expect(batch.jobIds).toEqual(["job-1"]);
    expect(batch.cycleCompleted).toBe(true);
  });

  it("an empty result is an empty, cycle-completed batch with a null nextCursor", async () => {
    const { prisma } = await import("@/infrastructure/database/prisma/client");
    const { PrismaReconciliationDataSource } = await import(
      "@/infrastructure/database/prisma/repositories/prisma-reconciliation-data-source"
    );
    const mocked = prisma as unknown as { job: { findMany: ReturnType<typeof vi.fn> } };
    mocked.job.findMany.mockResolvedValueOnce([]);

    const dataSource = new PrismaReconciliationDataSource();
    const batch = await dataSource.listJobIdsToInspectFromCursor({ after: null, limit: 5 });

    expect(batch.jobIds).toEqual([]);
    expect(batch.nextCursor).toBeNull();
    expect(batch.cycleCompleted).toBe(true);
  });
});
