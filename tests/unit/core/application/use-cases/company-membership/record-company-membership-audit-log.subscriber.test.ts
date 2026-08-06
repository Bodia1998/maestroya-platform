import { describe, expect, it } from "vitest";

import { RecordCompanyMembershipAuditLogSubscriber } from "@/application/use-cases/company-membership/record-company-membership-audit-log.subscriber";
import { CompanyMembershipChanged } from "@/domain/events/company-membership-changed";
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

describe("application/use-cases/company-membership/record-company-membership-audit-log.subscriber", () => {
  it("records a COMPANY_MEMBER_ROLE_CHANGED entry targeting the CompanyMember for a ROLE_CHANGED transition", async () => {
    const auditLog = new RecordingAuditLogRepository();
    const subscriber = new RecordCompanyMembershipAuditLogSubscriber(auditLog);

    await subscriber.handle(
      new CompanyMembershipChanged("company-1", "member-1", "user-1", "owner-1", "ROLE_CHANGED", "MEMBER", "MANAGER"),
    );

    expect(auditLog.entries).toHaveLength(1);
    expect(auditLog.entries[0]).toMatchObject({
      adminUserId: "owner-1",
      action: "COMPANY_MEMBER_ROLE_CHANGED",
      targetType: "CompanyMember",
      targetId: "member-1",
      metadata: { companyId: "company-1", fromRole: "MEMBER", toRole: "MANAGER" },
    });
  });

  it("records a COMPANY_MEMBER_REMOVED entry with role and selfRemoval metadata for a REMOVED transition", async () => {
    const auditLog = new RecordingAuditLogRepository();
    const subscriber = new RecordCompanyMembershipAuditLogSubscriber(auditLog);

    await subscriber.handle(
      new CompanyMembershipChanged("company-1", "member-1", "user-1", "owner-1", "REMOVED", "MANAGER", null, false),
    );

    expect(auditLog.entries[0]).toMatchObject({
      adminUserId: "owner-1",
      action: "COMPANY_MEMBER_REMOVED",
      targetType: "CompanyMember",
      targetId: "member-1",
      metadata: { companyId: "company-1", role: "MANAGER", selfRemoval: false },
    });
  });

  it("records selfRemoval true when the member removed themself", async () => {
    const auditLog = new RecordingAuditLogRepository();
    const subscriber = new RecordCompanyMembershipAuditLogSubscriber(auditLog);

    await subscriber.handle(
      new CompanyMembershipChanged("company-1", "member-1", "user-1", "user-1", "REMOVED", "MEMBER", null, true),
    );

    expect(auditLog.entries[0]).toMatchObject({ metadata: { selfRemoval: true } });
  });

  it("records a COMPANY_OWNERSHIP_TRANSFERRED entry targeting the Company with fromUserId/toUserId metadata", async () => {
    const auditLog = new RecordingAuditLogRepository();
    const subscriber = new RecordCompanyMembershipAuditLogSubscriber(auditLog);

    await subscriber.handle(
      new CompanyMembershipChanged("company-1", "member-2", "new-owner-1", "old-owner-1", "OWNERSHIP_TRANSFERRED"),
    );

    expect(auditLog.entries[0]).toMatchObject({
      adminUserId: "old-owner-1",
      action: "COMPANY_OWNERSHIP_TRANSFERRED",
      targetType: "Company",
      targetId: "company-1",
      metadata: { fromUserId: "old-owner-1", toUserId: "new-owner-1" },
    });
  });

  it("propagates a repository failure rather than swallowing it — the EventBus, not this subscriber, owns the failure contract", async () => {
    const subscriber = new RecordCompanyMembershipAuditLogSubscriber(new ThrowingAuditLogRepository());

    await expect(
      subscriber.handle(
        new CompanyMembershipChanged("company-1", "member-1", "user-1", "owner-1", "ROLE_CHANGED", "MEMBER", "MANAGER"),
      ),
    ).rejects.toThrow("database unreachable");
  });
});
