import { describe, expect, it, vi } from "vitest";

import { IntegrityCheckService } from "@/application/services/backup/integrity-check-service";
import { IntegrityCheckError } from "@/domain/errors/domain-error";

const artifact = { locationUri: "/tmp/db.dump", sizeBytes: 1024, checksumSha256: "a".repeat(64) };

describe("application/services/backup/integrity-check-service", () => {
  const service = new IntegrityCheckService();

  it("resolves when the provider reports the artifact intact", async () => {
    const verifier = { verifyBackup: vi.fn().mockResolvedValue({ intact: true }) };
    await expect(service.assertIntact(verifier, artifact)).resolves.toBeUndefined();
  });

  it("throws IntegrityCheckError with the provider's reason when not intact", async () => {
    const verifier = { verifyBackup: vi.fn().mockResolvedValue({ intact: false, reason: "checksum mismatch" }) };
    await expect(service.assertIntact(verifier, artifact)).rejects.toThrow(IntegrityCheckError);
    await expect(service.assertIntact(verifier, artifact)).rejects.toThrow(/checksum mismatch/);
  });

  it("propagates a provider rejection as-is (not wrapped)", async () => {
    const verifier = { verifyBackup: vi.fn().mockRejectedValue(new Error("provider unreachable")) };
    await expect(service.assertIntact(verifier, artifact)).rejects.toThrow("provider unreachable");
  });
});
