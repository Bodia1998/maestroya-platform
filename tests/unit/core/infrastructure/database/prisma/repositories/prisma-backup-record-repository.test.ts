import { describe, expect, it, vi } from "vitest";

vi.mock("@/infrastructure/database/prisma/client", () => ({
  prisma: {
    backupRecord: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

const now = new Date("2026-06-01T00:00:00.000Z");
const row = {
  id: "b1",
  target: "DATABASE",
  type: "FULL",
  status: "VERIFIED",
  retentionDays: 30,
  minRetainedBackups: 3,
  createdAt: now,
  startedAt: now,
  completedAt: now,
  expiresAt: new Date("2026-07-01T00:00:00.000Z"),
  sizeBytes: BigInt(2048),
  checksumSha256: "a".repeat(64),
  locationUri: "/tmp/db.dump",
  verifiedAt: now,
  restoredAt: null,
  failureReason: null,
  updatedAt: now,
};

describe("infrastructure/database/prisma/repositories/prisma-backup-record-repository", () => {
  it("maps a Prisma row to a BackupRecord, converting BigInt sizeBytes to a number", async () => {
    const { prisma } = await import("@/infrastructure/database/prisma/client");
    (prisma as unknown as { backupRecord: { findUnique: ReturnType<typeof vi.fn> } }).backupRecord.findUnique.mockResolvedValue(row);

    const { PrismaBackupRecordRepository } = await import(
      "@/infrastructure/database/prisma/repositories/prisma-backup-record-repository"
    );
    const record = await new PrismaBackupRecordRepository().findById("b1");

    expect(record).not.toBeNull();
    expect(record!.sizeBytes).toBe(2048);
    expect(typeof record!.sizeBytes).toBe("number");
    expect(record!.status).toBe("VERIFIED");
    expect(record!.retentionPolicy.retentionDays).toBe(30);
  });

  it("returns null when no row is found", async () => {
    const { prisma } = await import("@/infrastructure/database/prisma/client");
    (prisma as unknown as { backupRecord: { findUnique: ReturnType<typeof vi.fn> } }).backupRecord.findUnique.mockResolvedValue(null);

    const { PrismaBackupRecordRepository } = await import(
      "@/infrastructure/database/prisma/repositories/prisma-backup-record-repository"
    );
    expect(await new PrismaBackupRecordRepository().findById("missing")).toBeNull();
  });

  it("save() upserts, converting a numeric sizeBytes back to BigInt", async () => {
    const { prisma } = await import("@/infrastructure/database/prisma/client");
    const upsert = vi.fn().mockResolvedValue(row);
    (prisma as unknown as { backupRecord: { upsert: ReturnType<typeof vi.fn> } }).backupRecord.upsert = upsert;

    const { PrismaBackupRecordRepository } = await import(
      "@/infrastructure/database/prisma/repositories/prisma-backup-record-repository"
    );
    const { BackupRecord, RetentionPolicy } = await import("@/domain/entities/backup");

    const record = BackupRecord.schedule("b2", "DATABASE", "FULL", new RetentionPolicy(30, 3), now);
    record.markRunning(now);
    record.markCompleted({ sizeBytes: 4096, checksumSha256: "b".repeat(64), locationUri: "/tmp/y" }, now);

    await new PrismaBackupRecordRepository().save(record);

    expect(upsert).toHaveBeenCalledTimes(1);
    const firstCall = upsert.mock.calls.at(0);
    if (!firstCall) throw new Error("Expected upsert to have been called.");
    expect(firstCall[0].create.sizeBytes).toBe(BigInt(4096));
  });

  it("findLatestCompletedByTarget filters to COMPLETED/VERIFIED, ordered by completedAt desc", async () => {
    const { prisma } = await import("@/infrastructure/database/prisma/client");
    const findFirst = vi.fn().mockResolvedValue(row);
    (prisma as unknown as { backupRecord: { findFirst: ReturnType<typeof vi.fn> } }).backupRecord.findFirst = findFirst;

    const { PrismaBackupRecordRepository } = await import(
      "@/infrastructure/database/prisma/repositories/prisma-backup-record-repository"
    );
    await new PrismaBackupRecordRepository().findLatestCompletedByTarget("DATABASE");

    expect(findFirst).toHaveBeenCalledWith({
      where: { target: "DATABASE", status: { in: ["COMPLETED", "VERIFIED"] } },
      orderBy: { completedAt: "desc" },
    });
  });
});
