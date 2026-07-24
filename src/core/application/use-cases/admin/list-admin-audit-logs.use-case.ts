import type {
  AdminAuditLogRecord,
  AdminAuditLogRepository,
  ListAdminAuditLogsOptions,
} from "@/domain/repositories/admin-audit-log-repository";

/** Admin Panel module (Module 16): read-only, paginated access to the
 *  append-only admin audit trail. No admin-facing mutation of these
 *  records exists anywhere in this module — see AdminAuditLogRepository's
 *  own doc comment. */
export class ListAdminAuditLogsUseCase {
  constructor(private readonly auditLog: AdminAuditLogRepository) {}

  async execute(options: ListAdminAuditLogsOptions): Promise<AdminAuditLogRecord[]> {
    return this.auditLog.list(options);
  }
}
