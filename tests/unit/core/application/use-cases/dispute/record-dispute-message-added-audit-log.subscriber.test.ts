import { describe, expect, it } from "vitest";

import { RecordDisputeMessageAddedAuditLogSubscriber } from "@/application/use-cases/dispute/record-dispute-message-added-audit-log.subscriber";
import { DisputeMessageAdded } from "@/domain/events/dispute-message-added";
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

describe("application/use-cases/dispute/record-dispute-message-added-audit-log.subscriber", () => {
  it("records a DISPUTE_MESSAGE_ADDED entry with messageId metadata, no message body", async () => {
    const auditLog = new RecordingAuditLogRepository();
    const subscriber = new RecordDisputeMessageAddedAuditLogSubscriber(auditLog);

    await subscriber.handle(new DisputeMessageAdded("dispute-1", "DSP-2026-000001", "message-1", "user-1", ["user-2"]));

    expect(auditLog.entries).toHaveLength(1);
    expect(auditLog.entries[0]).toMatchObject({
      adminUserId: "user-1",
      action: "DISPUTE_MESSAGE_ADDED",
      targetType: "Dispute",
      targetId: "dispute-1",
      metadata: { messageId: "message-1" },
    });
  });

  it("records the entry even when recipientUserIds is empty", async () => {
    const auditLog = new RecordingAuditLogRepository();
    const subscriber = new RecordDisputeMessageAddedAuditLogSubscriber(auditLog);

    await subscriber.handle(new DisputeMessageAdded("dispute-1", "DSP-2026-000001", "message-1", "user-1", []));

    expect(auditLog.entries).toHaveLength(1);
  });

  it("propagates a repository failure rather than swallowing it — the EventBus, not this subscriber, owns the failure contract", async () => {
    const subscriber = new RecordDisputeMessageAddedAuditLogSubscriber(new ThrowingAuditLogRepository());

    await expect(
      subscriber.handle(new DisputeMessageAdded("dispute-1", "DSP-2026-000001", "message-1", "user-1", [])),
    ).rejects.toThrow("database unreachable");
  });
});
