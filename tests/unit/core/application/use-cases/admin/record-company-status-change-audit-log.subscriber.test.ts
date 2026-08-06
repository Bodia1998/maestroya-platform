import { describe, expect, it } from "vitest";

import { RecordCompanyStatusChangeAuditLogSubscriber } from "@/application/use-cases/admin/record-company-status-change-audit-log.subscriber";
import { CompanyStatusChanged } from "@/domain/events/company-status-changed";
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

describe("application/use-cases/admin/record-company-status-change-audit-log.subscriber", () => {
  it("records a COMPANY_SUSPENDED audit entry when newStatus is SUSPENDED", async () => {
    const auditLog = new RecordingAuditLogRepository();
    const subscriber = new RecordCompanyStatusChangeAuditLogSubscriber(auditLog);

    await subscriber.handle(new CompanyStatusChanged("company-1", "owner-1", "ACTIVE", "SUSPENDED", "admin-1"));

    expect(auditLog.entries).toHaveLength(1);
    expect(auditLog.entries[0]).toMatchObject({
      adminUserId: "admin-1",
      action: "COMPANY_SUSPENDED",
      targetType: "Company",
      targetId: "company-1",
      metadata: { previousStatus: "ACTIVE" },
    });
  });

  it("records a COMPANY_REACTIVATED audit entry when newStatus is ACTIVE", async () => {
    const auditLog = new RecordingAuditLogRepository();
    const subscriber = new RecordCompanyStatusChangeAuditLogSubscriber(auditLog);

    await subscriber.handle(new CompanyStatusChanged("company-1", "owner-1", "SUSPENDED", "ACTIVE", "admin-2"));

    expect(auditLog.entries).toHaveLength(1);
    expect(auditLog.entries[0]).toMatchObject({
      adminUserId: "admin-2",
      action: "COMPANY_REACTIVATED",
      targetType: "Company",
      targetId: "company-1",
      metadata: { previousStatus: "SUSPENDED" },
    });
  });

  it("propagates a repository failure rather than swallowing it — the EventBus, not this subscriber, owns the failure contract", async () => {
    const subscriber = new RecordCompanyStatusChangeAuditLogSubscriber(new ThrowingAuditLogRepository());

    await expect(
      subscriber.handle(new CompanyStatusChanged("company-1", "owner-1", "ACTIVE", "SUSPENDED", "admin-1")),
    ).rejects.toThrow("database unreachable");
  });
});
