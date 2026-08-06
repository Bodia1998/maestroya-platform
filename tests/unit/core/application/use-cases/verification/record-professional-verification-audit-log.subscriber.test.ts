import { describe, expect, it } from "vitest";

import { RecordProfessionalVerificationAuditLogSubscriber } from "@/application/use-cases/verification/record-professional-verification-audit-log.subscriber";
import { ProfessionalVerificationStatusChanged } from "@/domain/events/professional-verification-status-changed";
import type {
  AdminAuditLogRecord,
  AdminAuditLogRepository,
  ListAdminAuditLogsOptions,
  RecordAdminAuditLogData,
} from "@/domain/repositories/admin-audit-log-repository";

class RecordingAuditLogRepository implements AdminAuditLogRepository {
  entries: RecordAdminAuditLogData[] = [];

  async record(data: RecordAdminAuditLogData): Promise<AdminAuditLogRecord> {
    this.entries.push(data);
    return {
      id: `audit-${this.entries.length}`,
      adminUserId: data.adminUserId,
      action: data.action,
      targetType: data.targetType,
      targetId: data.targetId,
      metadata: data.metadata ?? null,
      createdAt: new Date(),
    };
  }

  async list(_options: ListAdminAuditLogsOptions): Promise<AdminAuditLogRecord[]> {
    return [];
  }
}

class ThrowingAuditLogRepository implements AdminAuditLogRepository {
  async record(): Promise<never> {
    throw new Error("database unreachable");
  }
  async list(): Promise<AdminAuditLogRecord[]> {
    return [];
  }
}

describe("application/use-cases/verification/record-professional-verification-audit-log.subscriber", () => {
  it("records a VERIFICATION_SUBMITTED entry with documentCount metadata for a SUBMITTED transition", async () => {
    const auditLog = new RecordingAuditLogRepository();
    const subscriber = new RecordProfessionalVerificationAuditLogSubscriber(auditLog);

    await subscriber.handle(
      new ProfessionalVerificationStatusChanged(
        "verification-1",
        "profile-1",
        "pro-1",
        "DRAFT",
        "PENDING",
        "pro-1",
        "SUBMITTED",
        3,
      ),
    );

    expect(auditLog.entries).toHaveLength(1);
    expect(auditLog.entries[0]).toMatchObject({
      adminUserId: "pro-1",
      action: "VERIFICATION_SUBMITTED",
      targetType: "ProfessionalVerification",
      targetId: "verification-1",
      metadata: { documentCount: 3 },
    });
  });

  it("records a VERIFICATION_RESUBMITTED entry with documentCount metadata for a RESUBMITTED transition", async () => {
    const auditLog = new RecordingAuditLogRepository();
    const subscriber = new RecordProfessionalVerificationAuditLogSubscriber(auditLog);

    await subscriber.handle(
      new ProfessionalVerificationStatusChanged(
        "verification-1",
        "profile-1",
        "pro-1",
        "REJECTED",
        "PENDING",
        "pro-1",
        "RESUBMITTED",
        1,
      ),
    );

    expect(auditLog.entries[0]).toMatchObject({ action: "VERIFICATION_RESUBMITTED", metadata: { documentCount: 1 } });
  });

  it("records a VERIFICATION_APPROVED entry with professionalProfileId metadata for an APPROVED transition", async () => {
    const auditLog = new RecordingAuditLogRepository();
    const subscriber = new RecordProfessionalVerificationAuditLogSubscriber(auditLog);

    await subscriber.handle(
      new ProfessionalVerificationStatusChanged(
        "verification-1",
        "profile-1",
        "pro-1",
        "PENDING",
        "APPROVED",
        "admin-1",
        "APPROVED",
      ),
    );

    expect(auditLog.entries[0]).toMatchObject({
      adminUserId: "admin-1",
      action: "VERIFICATION_APPROVED",
      metadata: { professionalProfileId: "profile-1" },
    });
  });

  it("records a VERIFICATION_REJECTED entry for a REJECTED transition", async () => {
    const auditLog = new RecordingAuditLogRepository();
    const subscriber = new RecordProfessionalVerificationAuditLogSubscriber(auditLog);

    await subscriber.handle(
      new ProfessionalVerificationStatusChanged(
        "verification-1",
        "profile-1",
        "pro-1",
        "PENDING",
        "REJECTED",
        "admin-1",
        "REJECTED",
      ),
    );

    expect(auditLog.entries[0]).toMatchObject({ action: "VERIFICATION_REJECTED" });
  });

  it("records a VERIFICATION_RESUBMISSION_REQUESTED entry for a RESUBMISSION_REQUESTED transition", async () => {
    const auditLog = new RecordingAuditLogRepository();
    const subscriber = new RecordProfessionalVerificationAuditLogSubscriber(auditLog);

    await subscriber.handle(
      new ProfessionalVerificationStatusChanged(
        "verification-1",
        "profile-1",
        "pro-1",
        "PENDING",
        "RESUBMISSION_REQUIRED",
        "admin-1",
        "RESUBMISSION_REQUESTED",
      ),
    );

    expect(auditLog.entries[0]).toMatchObject({ action: "VERIFICATION_RESUBMISSION_REQUESTED" });
  });

  it("records the entry even when professionalUserId is null (the audit side must still fire)", async () => {
    const auditLog = new RecordingAuditLogRepository();
    const subscriber = new RecordProfessionalVerificationAuditLogSubscriber(auditLog);

    await subscriber.handle(
      new ProfessionalVerificationStatusChanged(
        "verification-1",
        "profile-1",
        null,
        "PENDING",
        "APPROVED",
        "admin-1",
        "APPROVED",
      ),
    );

    expect(auditLog.entries).toHaveLength(1);
  });

  it("propagates a repository failure rather than swallowing it — the EventBus, not this subscriber, owns the failure contract", async () => {
    const subscriber = new RecordProfessionalVerificationAuditLogSubscriber(new ThrowingAuditLogRepository());

    await expect(
      subscriber.handle(
        new ProfessionalVerificationStatusChanged(
          "verification-1",
          "profile-1",
          "pro-1",
          "DRAFT",
          "PENDING",
          "pro-1",
          "SUBMITTED",
          1,
        ),
      ),
    ).rejects.toThrow("database unreachable");
  });
});
