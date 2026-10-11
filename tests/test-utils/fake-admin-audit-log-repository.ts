import type {
  AdminAuditLogRecord,
  AdminAuditLogRepository,
  ListAdminAuditLogsOptions,
  RecordAdminAuditLogData,
} from "@/domain/repositories/admin-audit-log-repository";

/** Module 154 test double (tests only): an append-only in-memory audit trail (no update, no delete). `failNext` simulates a failing audit write. */
export class FakeAdminAuditLogRepository implements AdminAuditLogRepository {
  readonly entries: AdminAuditLogRecord[] = [];
  failNext = false;

  async record(data: RecordAdminAuditLogData): Promise<AdminAuditLogRecord> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("audit store unavailable");
    }
    const entry: AdminAuditLogRecord = {
      id: `audit-${this.entries.length + 1}`,
      adminUserId: data.adminUserId,
      action: data.action,
      targetType: data.targetType,
      targetId: data.targetId,
      metadata: data.metadata ? { ...data.metadata } : null,
      createdAt: new Date(),
    };
    this.entries.push(entry);
    return entry;
  }

  async list(options: ListAdminAuditLogsOptions): Promise<AdminAuditLogRecord[]> {
    return [...this.entries].reverse().slice(options.offset, options.offset + options.limit);
  }
}
