import { describe, expect, it } from "vitest";

import { RecordDisputeAssignedAuditLogSubscriber } from "@/application/use-cases/dispute/record-dispute-assigned-audit-log.subscriber";
import { DisputeAssigned } from "@/domain/events/dispute-assigned";
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

describe("application/use-cases/dispute/record-dispute-assigned-audit-log.subscriber", () => {
  it("records a DISPUTE_ASSIGNED entry with previous/new assignee metadata", async () => {
    const auditLog = new RecordingAuditLogRepository();
    const subscriber = new RecordDisputeAssignedAuditLogSubscriber(auditLog);

    await subscriber.handle(new DisputeAssigned("dispute-1", "DSP-2026-000001", "admin-old", "admin-new", "admin-1"));

    expect(auditLog.entries).toHaveLength(1);
    expect(auditLog.entries[0]).toMatchObject({
      adminUserId: "admin-1",
      action: "DISPUTE_ASSIGNED",
      targetType: "Dispute",
      targetId: "dispute-1",
      metadata: { previousAssignee: "admin-old", newAssignee: "admin-new" },
    });
  });

  it("records the entry even when unassigning (newAssignee null)", async () => {
    const auditLog = new RecordingAuditLogRepository();
    const subscriber = new RecordDisputeAssignedAuditLogSubscriber(auditLog);

    await subscriber.handle(new DisputeAssigned("dispute-1", "DSP-2026-000001", "admin-old", null, "admin-1"));

    expect(auditLog.entries[0]).toMatchObject({ metadata: { previousAssignee: "admin-old", newAssignee: null } });
  });

  it("propagates a repository failure rather than swallowing it — the EventBus, not this subscriber, owns the failure contract", async () => {
    const subscriber = new RecordDisputeAssignedAuditLogSubscriber(new ThrowingAuditLogRepository());

    await expect(
      subscriber.handle(new DisputeAssigned("dispute-1", "DSP-2026-000001", null, "admin-new", "admin-1")),
    ).rejects.toThrow("database unreachable");
  });
});
