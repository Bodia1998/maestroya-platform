import { describe, expect, it } from "vitest";

import { BackupValidationService } from "@/application/services/backup/backup-validation-service";
import { BackupValidationError } from "@/domain/errors/domain-error";

describe("application/services/backup/backup-validation-service", () => {
  const service = new BackupValidationService();
  const validArtifact = { locationUri: "/tmp/db.dump", sizeBytes: 1024, checksumSha256: "a".repeat(64) };

  it("accepts a well-formed artifact", () => {
    expect(() => service.validate(validArtifact, "DATABASE")).not.toThrow();
  });

  it("rejects an empty locationUri", () => {
    expect(() => service.validate({ ...validArtifact, locationUri: "" }, "DATABASE")).toThrow(BackupValidationError);
  });

  it("rejects a zero-byte artifact", () => {
    expect(() => service.validate({ ...validArtifact, sizeBytes: 0 }, "DATABASE")).toThrow(BackupValidationError);
  });

  it("rejects a negative size", () => {
    expect(() => service.validate({ ...validArtifact, sizeBytes: -1 }, "DATABASE")).toThrow(BackupValidationError);
  });

  it("rejects a malformed checksum (wrong length)", () => {
    expect(() => service.validate({ ...validArtifact, checksumSha256: "abc123" }, "DATABASE")).toThrow(BackupValidationError);
  });

  it("rejects an uppercase checksum (must be lowercase hex)", () => {
    expect(() => service.validate({ ...validArtifact, checksumSha256: "A".repeat(64) }, "DATABASE")).toThrow(BackupValidationError);
  });
});
