import { describe, expect, it } from "vitest";

import { RecordCompanyInvitationAuditLogSubscriber } from "@/application/use-cases/company-invitation/record-company-invitation-audit-log.subscriber";
import { CompanyInvitationStatusChanged } from "@/domain/events/company-invitation-status-changed";
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

describe("application/use-cases/company-invitation/record-company-invitation-audit-log.subscriber", () => {
  it("records a COMPANY_MEMBER_INVITED entry with companyId/email/role metadata for a CREATED transition", async () => {
    const auditLog = new RecordingAuditLogRepository();
    const subscriber = new RecordCompanyInvitationAuditLogSubscriber(auditLog);

    await subscriber.handle(
      new CompanyInvitationStatusChanged(
        "invitation-1",
        "company-1",
        "invitee-1",
        "owner-1",
        "PENDING",
        "CREATED",
        "MEMBER",
        "invitee@example.com",
      ),
    );

    expect(auditLog.entries).toHaveLength(1);
    expect(auditLog.entries[0]).toMatchObject({
      adminUserId: "owner-1",
      action: "COMPANY_MEMBER_INVITED",
      targetType: "CompanyInvitation",
      targetId: "invitation-1",
      metadata: { companyId: "company-1", email: "invitee@example.com", role: "MEMBER" },
    });
  });

  it("records a COMPANY_INVITATION_ACCEPTED entry with companyId/role metadata for an ACCEPTED transition", async () => {
    const auditLog = new RecordingAuditLogRepository();
    const subscriber = new RecordCompanyInvitationAuditLogSubscriber(auditLog);

    await subscriber.handle(
      new CompanyInvitationStatusChanged(
        "invitation-1",
        "company-1",
        "owner-1",
        "invitee-1",
        "ACCEPTED",
        "ACCEPTED",
        "MANAGER",
      ),
    );

    expect(auditLog.entries[0]).toMatchObject({
      adminUserId: "invitee-1",
      action: "COMPANY_INVITATION_ACCEPTED",
      metadata: { companyId: "company-1", role: "MANAGER" },
    });
  });

  it("records a COMPANY_INVITATION_DECLINED entry with only companyId metadata for a DECLINED transition", async () => {
    const auditLog = new RecordingAuditLogRepository();
    const subscriber = new RecordCompanyInvitationAuditLogSubscriber(auditLog);

    await subscriber.handle(
      new CompanyInvitationStatusChanged(
        "invitation-1",
        "company-1",
        "owner-1",
        "invitee-1",
        "DECLINED",
        "DECLINED",
      ),
    );

    expect(auditLog.entries[0]).toMatchObject({
      action: "COMPANY_INVITATION_DECLINED",
      metadata: { companyId: "company-1" },
    });
  });

  it("records the entry even when recipientUserId is null (the audit side must still fire)", async () => {
    const auditLog = new RecordingAuditLogRepository();
    const subscriber = new RecordCompanyInvitationAuditLogSubscriber(auditLog);

    await subscriber.handle(
      new CompanyInvitationStatusChanged(
        "invitation-1",
        "company-1",
        null,
        "owner-1",
        "PENDING",
        "CREATED",
        "MEMBER",
        "unregistered@example.com",
      ),
    );

    expect(auditLog.entries).toHaveLength(1);
  });

  it("propagates a repository failure rather than swallowing it — the EventBus, not this subscriber, owns the failure contract", async () => {
    const subscriber = new RecordCompanyInvitationAuditLogSubscriber(new ThrowingAuditLogRepository());

    await expect(
      subscriber.handle(
        new CompanyInvitationStatusChanged(
          "invitation-1",
          "company-1",
          "invitee-1",
          "owner-1",
          "PENDING",
          "CREATED",
          "MEMBER",
          "invitee@example.com",
        ),
      ),
    ).rejects.toThrow("database unreachable");
  });
});
