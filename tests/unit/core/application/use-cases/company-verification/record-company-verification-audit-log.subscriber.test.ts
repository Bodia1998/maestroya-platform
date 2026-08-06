import { describe, expect, it } from "vitest";

import { RecordCompanyVerificationAuditLogSubscriber } from "@/application/use-cases/company-verification/record-company-verification-audit-log.subscriber";
import { CompanyVerificationStatusChanged } from "@/domain/events/company-verification-status-changed";
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

describe("application/use-cases/company-verification/record-company-verification-audit-log.subscriber", () => {
  it("records a COMPANY_VERIFICATION_SUBMITTED entry with companyId/documentCount metadata for a SUBMITTED transition", async () => {
    const auditLog = new RecordingAuditLogRepository();
    const subscriber = new RecordCompanyVerificationAuditLogSubscriber(auditLog);

    await subscriber.handle(
      new CompanyVerificationStatusChanged("verification-1", "company-1", "owner-1", "DRAFT", "PENDING", "owner-1", "SUBMITTED", 3),
    );

    expect(auditLog.entries).toHaveLength(1);
    expect(auditLog.entries[0]).toMatchObject({
      adminUserId: "owner-1",
      action: "COMPANY_VERIFICATION_SUBMITTED",
      targetType: "CompanyVerification",
      targetId: "verification-1",
      metadata: { companyId: "company-1", documentCount: 3 },
    });
  });

  it("records a COMPANY_VERIFICATION_RESUBMITTED entry for a RESUBMITTED transition", async () => {
    const auditLog = new RecordingAuditLogRepository();
    const subscriber = new RecordCompanyVerificationAuditLogSubscriber(auditLog);

    await subscriber.handle(
      new CompanyVerificationStatusChanged("verification-1", "company-1", "owner-1", "REJECTED", "PENDING", "owner-1", "RESUBMITTED", 1),
    );

    expect(auditLog.entries[0]).toMatchObject({ action: "COMPANY_VERIFICATION_RESUBMITTED", metadata: { documentCount: 1 } });
  });

  it("records a COMPANY_VERIFICATION_APPROVED entry with companyProfileId metadata for an APPROVED transition", async () => {
    const auditLog = new RecordingAuditLogRepository();
    const subscriber = new RecordCompanyVerificationAuditLogSubscriber(auditLog);

    await subscriber.handle(
      new CompanyVerificationStatusChanged("verification-1", "company-1", "owner-1", "PENDING", "APPROVED", "admin-1", "APPROVED"),
    );

    expect(auditLog.entries[0]).toMatchObject({
      adminUserId: "admin-1",
      action: "COMPANY_VERIFICATION_APPROVED",
      metadata: { companyProfileId: "company-1" },
    });
  });

  it("records a COMPANY_VERIFICATION_REJECTED entry for a REJECTED transition", async () => {
    const auditLog = new RecordingAuditLogRepository();
    const subscriber = new RecordCompanyVerificationAuditLogSubscriber(auditLog);

    await subscriber.handle(
      new CompanyVerificationStatusChanged("verification-1", "company-1", "owner-1", "PENDING", "REJECTED", "admin-1", "REJECTED"),
    );

    expect(auditLog.entries[0]).toMatchObject({ action: "COMPANY_VERIFICATION_REJECTED" });
  });

  it("records a COMPANY_VERIFICATION_RESUBMISSION_REQUESTED entry for a RESUBMISSION_REQUESTED transition", async () => {
    const auditLog = new RecordingAuditLogRepository();
    const subscriber = new RecordCompanyVerificationAuditLogSubscriber(auditLog);

    await subscriber.handle(
      new CompanyVerificationStatusChanged(
        "verification-1",
        "company-1",
        "owner-1",
        "PENDING",
        "RESUBMISSION_REQUIRED",
        "admin-1",
        "RESUBMISSION_REQUESTED",
      ),
    );

    expect(auditLog.entries[0]).toMatchObject({ action: "COMPANY_VERIFICATION_RESUBMISSION_REQUESTED" });
  });

  it("records the entry even when recipientUserId is null (the audit side must still fire)", async () => {
    const auditLog = new RecordingAuditLogRepository();
    const subscriber = new RecordCompanyVerificationAuditLogSubscriber(auditLog);

    await subscriber.handle(
      new CompanyVerificationStatusChanged("verification-1", "company-1", null, "PENDING", "APPROVED", "admin-1", "APPROVED"),
    );

    expect(auditLog.entries).toHaveLength(1);
  });

  it("propagates a repository failure rather than swallowing it — the EventBus, not this subscriber, owns the failure contract", async () => {
    const subscriber = new RecordCompanyVerificationAuditLogSubscriber(new ThrowingAuditLogRepository());

    await expect(
      subscriber.handle(
        new CompanyVerificationStatusChanged("verification-1", "company-1", "owner-1", "DRAFT", "PENDING", "owner-1", "SUBMITTED", 1),
      ),
    ).rejects.toThrow("database unreachable");
  });
});
