import { describe, expect, it } from "vitest";

import { BackupRecord, RetentionPolicy } from "@/domain/entities/backup";
import { InvalidBackupTransitionError } from "@/domain/errors/domain-error";

describe("domain/entities/backup — RetentionPolicy", () => {
  it("computes an expiry date retentionDays after completion", () => {
    const policy = new RetentionPolicy(30, 3);
    const completedAt = new Date("2026-01-01T00:00:00.000Z");
    expect(policy.expiryDateFor(completedAt).toISOString()).toBe("2026-01-31T00:00:00.000Z");
  });

  it("rejects a non-positive retentionDays", () => {
    expect(() => new RetentionPolicy(0, 1)).toThrow(RangeError);
    expect(() => new RetentionPolicy(-5, 1)).toThrow(RangeError);
  });

  it("rejects a non-integer or zero minRetainedBackups", () => {
    expect(() => new RetentionPolicy(30, 0)).toThrow(RangeError);
    expect(() => new RetentionPolicy(30, 1.5)).toThrow(RangeError);
  });
});

describe("domain/entities/backup — BackupRecord lifecycle", () => {
  const policy = new RetentionPolicy(30, 3);
  const t0 = new Date("2026-01-01T00:00:00.000Z");

  it("starts PENDING and moves through RUNNING -> COMPLETED -> VERIFIED", () => {
    const record = BackupRecord.schedule("b1", "DATABASE", "FULL", policy, t0);
    expect(record.status).toBe("PENDING");

    record.markRunning(t0);
    expect(record.status).toBe("RUNNING");

    const completedAt = new Date("2026-01-01T01:00:00.000Z");
    record.markCompleted({ sizeBytes: 1024, checksumSha256: "a".repeat(64), locationUri: "/tmp/x.dump" }, completedAt);
    expect(record.status).toBe("COMPLETED");
    expect(record.sizeBytes).toBe(1024);
    expect(record.expiresAt?.toISOString()).toBe(new Date("2026-01-31T01:00:00.000Z").toISOString());

    record.markVerified(new Date("2026-01-01T01:05:00.000Z"));
    expect(record.status).toBe("VERIFIED");
  });

  it("rejects an illegal transition (e.g. RUNNING -> RUNNING)", () => {
    const record = BackupRecord.schedule("b2", "DATABASE", "FULL", policy, t0);
    record.markRunning(t0);
    expect(() => record.markRunning(t0)).toThrow(InvalidBackupTransitionError);
  });

  it("rejects verifying a backup that was never completed", () => {
    const record = BackupRecord.schedule("b3", "DATABASE", "FULL", policy, t0);
    expect(() => record.markVerified(t0)).toThrow(InvalidBackupTransitionError);
  });

  it("allows FAILED from COMPLETED (a post-completion integrity failure)", () => {
    const record = BackupRecord.schedule("b4", "DATABASE", "FULL", policy, t0);
    record.markRunning(t0);
    record.markCompleted({ sizeBytes: 1, checksumSha256: "a".repeat(64), locationUri: "/tmp/y" }, t0);
    record.markFailed("integrity check failed", t0);
    expect(record.status).toBe("FAILED");
    expect(record.failureReason).toBe("integrity check failed");
  });

  it("FAILED is terminal — no further transitions allowed", () => {
    const record = BackupRecord.schedule("b5", "DATABASE", "FULL", policy, t0);
    record.markFailed("provider unreachable", t0);
    expect(() => record.markRunning(t0)).toThrow(InvalidBackupTransitionError);
  });

  it("isExpired is false before expiresAt and true at/after it", () => {
    const record = BackupRecord.schedule("b6", "DATABASE", "FULL", policy, t0);
    record.markRunning(t0);
    record.markCompleted({ sizeBytes: 1, checksumSha256: "a".repeat(64), locationUri: "/tmp/z" }, t0);

    expect(record.isExpired(new Date("2026-01-15T00:00:00.000Z"))).toBe(false);
    expect(record.isExpired(record.expiresAt!)).toBe(true);
  });

  it("isRestorable is true only for COMPLETED/VERIFIED and not expired", () => {
    const record = BackupRecord.schedule("b7", "DATABASE", "FULL", policy, t0);
    expect(record.isRestorable(t0)).toBe(false);

    record.markRunning(t0);
    record.markCompleted({ sizeBytes: 1, checksumSha256: "a".repeat(64), locationUri: "/tmp/w" }, t0);
    expect(record.isRestorable(t0)).toBe(true);
    expect(record.isRestorable(record.expiresAt!)).toBe(false);
  });

  it("rehydrate round-trips every field", () => {
    const record = BackupRecord.rehydrate({
      id: "b8",
      target: "FILE_STORAGE",
      type: "INCREMENTAL",
      retentionPolicy: policy,
      status: "VERIFIED",
      createdAt: t0,
      startedAt: t0,
      completedAt: t0,
      expiresAt: policy.expiryDateFor(t0),
      sizeBytes: 42,
      checksumSha256: "b".repeat(64),
      locationUri: "/tmp/manifest.json",
      verifiedAt: t0,
      restoredAt: null,
      failureReason: null,
    });

    expect(record.target).toBe("FILE_STORAGE");
    expect(record.type).toBe("INCREMENTAL");
    expect(record.status).toBe("VERIFIED");
    expect(record.sizeBytes).toBe(42);
  });
});
