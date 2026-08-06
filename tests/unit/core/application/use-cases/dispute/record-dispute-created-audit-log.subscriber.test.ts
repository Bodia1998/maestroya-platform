import { describe, expect, it } from "vitest";

import { RecordDisputeCreatedAuditLogSubscriber } from "@/application/use-cases/dispute/record-dispute-created-audit-log.subscriber";
import { DisputeCreated } from "@/domain/events/dispute-created";
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

describe("application/use-cases/dispute/record-dispute-created-audit-log.subscriber", () => {
  it("records a DISPUTE_CREATED entry with jobId/caseNumber/reason metadata", async () => {
    const auditLog = new RecordingAuditLogRepository();
    const subscriber = new RecordDisputeCreatedAuditLogSubscriber(auditLog);

    await subscriber.handle(
      new DisputeCreated("dispute-1", "DSP-2026-000001", "job-1", "SERVICE_QUALITY", "user-1", ["user-2"]),
    );

    expect(auditLog.entries).toHaveLength(1);
    expect(auditLog.entries[0]).toMatchObject({
      adminUserId: "user-1",
      action: "DISPUTE_CREATED",
      targetType: "Dispute",
      targetId: "dispute-1",
      metadata: { jobId: "job-1", caseNumber: "DSP-2026-000001", reason: "SERVICE_QUALITY" },
    });
  });

  it("records the entry even when recipientUserIds is empty", async () => {
    const auditLog = new RecordingAuditLogRepository();
    const subscriber = new RecordDisputeCreatedAuditLogSubscriber(auditLog);

    await subscriber.handle(new DisputeCreated("dispute-1", "DSP-2026-000001", "job-1", "OTHER", "user-1", []));

    expect(auditLog.entries).toHaveLength(1);
  });

  it("propagates a repository failure rather than swallowing it — the EventBus, not this subscriber, owns the failure contract", async () => {
    const subscriber = new RecordDisputeCreatedAuditLogSubscriber(new ThrowingAuditLogRepository());

    await expect(
      subscriber.handle(new DisputeCreated("dispute-1", "DSP-2026-000001", "job-1", "OTHER", "user-1", [])),
    ).rejects.toThrow("database unreachable");
  });
});
