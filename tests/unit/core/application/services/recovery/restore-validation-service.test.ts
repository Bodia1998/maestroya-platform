import { describe, expect, it } from "vitest";

import { RestoreValidationService } from "@/application/services/recovery/restore-validation-service";
import { BackupRecord, RetentionPolicy } from "@/domain/entities/backup";
import { RestoreValidationError } from "@/domain/errors/domain-error";

const policy = new RetentionPolicy(30, 3);
const now = new Date("2026-06-01T00:00:00.000Z");

function completedRecord(): BackupRecord {
  const record = BackupRecord.schedule("r1", "DATABASE", "FULL", policy, now);
  record.markRunning(now);
  record.markCompleted({ sizeBytes: 10, checksumSha256: "a".repeat(64), locationUri: "/tmp/x" }, now);
  return record;
}

describe("application/services/recovery/restore-validation-service", () => {
  const service = new RestoreValidationService();

  it("accepts a COMPLETED backup matching the requested target", () => {
    expect(() => service.validate(completedRecord(), "DATABASE", now)).not.toThrow();
  });

  it("rejects a target mismatch", () => {
    expect(() => service.validate(completedRecord(), "FILE_STORAGE", now)).toThrow(RestoreValidationError);
  });

  it("rejects a PENDING (never-run) backup", () => {
    const record = BackupRecord.schedule("r2", "DATABASE", "FULL", policy, now);
    expect(() => service.validate(record, "DATABASE", now)).toThrow(RestoreValidationError);
  });

  it("rejects a FAILED backup", () => {
    const record = BackupRecord.schedule("r3", "DATABASE", "FULL", policy, now);
    record.markFailed("boom", now);
    expect(() => service.validate(record, "DATABASE", now)).toThrow(RestoreValidationError);
  });

  it("rejects an expired backup", () => {
    const record = completedRecord();
    expect(() => service.validate(record, "DATABASE", record.expiresAt!)).toThrow(RestoreValidationError);
  });

  it("accepts a VERIFIED backup", () => {
    const record = completedRecord();
    record.markVerified(now);
    expect(() => service.validate(record, "DATABASE", now)).not.toThrow();
  });
});
