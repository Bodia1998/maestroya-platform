import { describe, expect, it } from "vitest";

import { RecordSupportTicketAuditLogSubscriber } from "@/application/use-cases/support-ticket/record-support-ticket-audit-log.subscriber";
import { SupportTicketStatusChanged } from "@/domain/events/support-ticket-status-changed";
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

describe("application/use-cases/support-ticket/record-support-ticket-audit-log.subscriber", () => {
  it("records a SUPPORT_TICKET_ASSIGNED entry with previousAssignee/newAssignee metadata for an ASSIGNED transition", async () => {
    const auditLog = new RecordingAuditLogRepository();
    const subscriber = new RecordSupportTicketAuditLogSubscriber(auditLog);

    await subscriber.handle(
      new SupportTicketStatusChanged(
        "ticket-1",
        "TCK-2026-000001",
        "admin-1",
        "assignee-1",
        "ASSIGNED",
        null,
        null,
        null,
        "assignee-1",
      ),
    );

    expect(auditLog.entries).toHaveLength(1);
    expect(auditLog.entries[0]).toMatchObject({
      adminUserId: "admin-1",
      action: "SUPPORT_TICKET_ASSIGNED",
      targetType: "SupportTicket",
      targetId: "ticket-1",
      metadata: { previousAssignee: null, newAssignee: "assignee-1" },
    });
  });

  it("records a SUPPORT_TICKET_STATUS_CHANGED entry with from/to metadata for a STATUS_CHANGED transition", async () => {
    const auditLog = new RecordingAuditLogRepository();
    const subscriber = new RecordSupportTicketAuditLogSubscriber(auditLog);

    await subscriber.handle(
      new SupportTicketStatusChanged(
        "ticket-1",
        "TCK-2026-000001",
        "admin-1",
        "opener-1",
        "STATUS_CHANGED",
        "OPEN",
        "IN_PROGRESS",
      ),
    );

    expect(auditLog.entries[0]).toMatchObject({
      action: "SUPPORT_TICKET_STATUS_CHANGED",
      metadata: { from: "OPEN", to: "IN_PROGRESS" },
    });
  });

  it("records a SUPPORT_TICKET_RESOLVED entry with empty metadata for a RESOLVED transition", async () => {
    const auditLog = new RecordingAuditLogRepository();
    const subscriber = new RecordSupportTicketAuditLogSubscriber(auditLog);

    await subscriber.handle(
      new SupportTicketStatusChanged(
        "ticket-1",
        "TCK-2026-000001",
        "admin-1",
        "opener-1",
        "RESOLVED",
        "IN_PROGRESS",
        "RESOLVED",
      ),
    );

    expect(auditLog.entries[0]).toMatchObject({ action: "SUPPORT_TICKET_RESOLVED", metadata: {} });
  });

  it("records a SUPPORT_TICKET_CLOSED entry with empty metadata for a CLOSED transition", async () => {
    const auditLog = new RecordingAuditLogRepository();
    const subscriber = new RecordSupportTicketAuditLogSubscriber(auditLog);

    await subscriber.handle(
      new SupportTicketStatusChanged(
        "ticket-1",
        "TCK-2026-000001",
        "admin-1",
        "opener-1",
        "CLOSED",
        "RESOLVED",
        "CLOSED",
      ),
    );

    expect(auditLog.entries[0]).toMatchObject({ action: "SUPPORT_TICKET_CLOSED", metadata: {} });
  });

  it("records the entry even when recipientUserId is null (the audit side must still fire)", async () => {
    const auditLog = new RecordingAuditLogRepository();
    const subscriber = new RecordSupportTicketAuditLogSubscriber(auditLog);

    await subscriber.handle(
      new SupportTicketStatusChanged(
        "ticket-1",
        "TCK-2026-000001",
        "admin-1",
        null,
        "ASSIGNED",
        null,
        null,
        "assignee-1",
        null,
      ),
    );

    expect(auditLog.entries).toHaveLength(1);
  });

  it("propagates a repository failure rather than swallowing it — the EventBus, not this subscriber, owns the failure contract", async () => {
    const subscriber = new RecordSupportTicketAuditLogSubscriber(new ThrowingAuditLogRepository());

    await expect(
      subscriber.handle(
        new SupportTicketStatusChanged(
          "ticket-1",
          "TCK-2026-000001",
          "admin-1",
          "opener-1",
          "RESOLVED",
          "IN_PROGRESS",
          "RESOLVED",
        ),
      ),
    ).rejects.toThrow("database unreachable");
  });
});
