import { describe, expect, it } from "vitest";

import { RecordDisputeStatusChangeAuditLogSubscriber } from "@/application/use-cases/dispute/record-dispute-status-change-audit-log.subscriber";
import { DisputeStatusChanged } from "@/domain/events/dispute-status-changed";
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

describe("application/use-cases/dispute/record-dispute-status-change-audit-log.subscriber", () => {
  it("records a DISPUTE_RESOLVED entry with resolution metadata for a RESOLVED transition", async () => {
    const auditLog = new RecordingAuditLogRepository();
    const subscriber = new RecordDisputeStatusChangeAuditLogSubscriber(auditLog);

    await subscriber.handle(
      new DisputeStatusChanged(
        "dispute-1",
        "DSP-2026-000001",
        "UNDER_REVIEW",
        "RESOLVED",
        "admin-1",
        "RESOLVED",
        ["user-1", "user-2"],
        "NO_ACTION",
      ),
    );

    expect(auditLog.entries).toHaveLength(1);
    expect(auditLog.entries[0]).toMatchObject({
      adminUserId: "admin-1",
      action: "DISPUTE_RESOLVED",
      targetType: "Dispute",
      targetId: "dispute-1",
      metadata: { resolution: "NO_ACTION" },
    });
  });

  it("records a DISPUTE_REJECTED entry with empty metadata for a REJECTED transition", async () => {
    const auditLog = new RecordingAuditLogRepository();
    const subscriber = new RecordDisputeStatusChangeAuditLogSubscriber(auditLog);

    await subscriber.handle(
      new DisputeStatusChanged("dispute-1", "DSP-2026-000001", "UNDER_REVIEW", "REJECTED", "admin-1", "REJECTED", []),
    );

    expect(auditLog.entries[0]).toMatchObject({ action: "DISPUTE_REJECTED", metadata: {} });
  });

  it("records a DISPUTE_CLOSED entry with empty metadata for a CLOSED transition", async () => {
    const auditLog = new RecordingAuditLogRepository();
    const subscriber = new RecordDisputeStatusChangeAuditLogSubscriber(auditLog);

    await subscriber.handle(
      new DisputeStatusChanged("dispute-1", "DSP-2026-000001", "RESOLVED", "CLOSED", "admin-1", "CLOSED", []),
    );

    expect(auditLog.entries[0]).toMatchObject({ action: "DISPUTE_CLOSED", metadata: {} });
  });

  it("records a DISPUTE_STATUS_CHANGED entry with from/to metadata for a STATUS_CHANGED transition", async () => {
    const auditLog = new RecordingAuditLogRepository();
    const subscriber = new RecordDisputeStatusChangeAuditLogSubscriber(auditLog);

    await subscriber.handle(
      new DisputeStatusChanged(
        "dispute-1",
        "DSP-2026-000001",
        "OPEN",
        "UNDER_REVIEW",
        "admin-1",
        "STATUS_CHANGED",
        [],
      ),
    );

    expect(auditLog.entries[0]).toMatchObject({
      action: "DISPUTE_STATUS_CHANGED",
      metadata: { from: "OPEN", to: "UNDER_REVIEW" },
    });
  });

  it("records the entry even when recipientUserIds is empty (the audit side must still fire)", async () => {
    const auditLog = new RecordingAuditLogRepository();
    const subscriber = new RecordDisputeStatusChangeAuditLogSubscriber(auditLog);

    await subscriber.handle(
      new DisputeStatusChanged("dispute-1", "DSP-2026-000001", "UNDER_REVIEW", "CLOSED", "admin-1", "CLOSED", []),
    );

    expect(auditLog.entries).toHaveLength(1);
  });

  it("propagates a repository failure rather than swallowing it — the EventBus, not this subscriber, owns the failure contract", async () => {
    const subscriber = new RecordDisputeStatusChangeAuditLogSubscriber(new ThrowingAuditLogRepository());

    await expect(
      subscriber.handle(
        new DisputeStatusChanged("dispute-1", "DSP-2026-000001", "UNDER_REVIEW", "RESOLVED", "admin-1", "RESOLVED", []),
      ),
    ).rejects.toThrow("database unreachable");
  });
});
