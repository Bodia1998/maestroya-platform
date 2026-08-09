import { describe, expect, it, vi } from "vitest";

import { GetBackupStatusUseCase } from "@/application/use-cases/backup/get-backup-status.use-case";
import type { BackupRecordRepository } from "@/domain/repositories/backup-record-repository";

describe("application/use-cases/backup/get-backup-status.use-case", () => {
  it("returns null fields, never throwing, when a target has no backups yet", async () => {
    const repository: BackupRecordRepository = {
      save: vi.fn(),
      findById: vi.fn(),
      findLatestByTarget: vi.fn(async () => null),
      findLatestCompletedByTarget: vi.fn(async () => null),
      listByTarget: vi.fn(async () => []),
    };

    const report = await new GetBackupStatusUseCase(repository).execute("DATABASE");
    expect(report).toEqual({ target: "DATABASE", latest: null, latestCompleted: null, history: [] });
  });
});
