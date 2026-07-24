/**
 * Admin Panel module (Module 16): repository interface for recording
 * admin actions to the audit trail.
 *
 * Reuses the existing `AuditLog` model (see schema.prisma's "Platform /
 * Audit" section) rather than introducing a parallel `AdminAuditLog`
 * table — AuditLog was already a general-purpose, append-only,
 * polymorphic (`entityType`/`entityId`) audit trail with exactly the
 * shape the module spec asks for (id, actor, action, target, metadata,
 * createdAt), just with no repository/use case ever writing to it yet.
 * `AuditLogAction` (the existing Prisma enum) does not have Admin-Panel-
 * specific values like "USER_SUSPENDED" — rather than widen that enum
 * (a broader, riskier schema change touching a model no other module
 * writes to yet), each admin action is recorded as the closest existing
 * enum value (STATUS_CHANGE for suspend/reactivate, UPDATE for role
 * changes and moderation) with the concrete action name preserved in
 * `metadata.adminAction`. See ADMIN_ACTION_TO_LOG_ACTION below.
 *
 * Deliberately append-only: no `update`/`delete` method exists on this
 * interface, matching AuditLog's own "no updatedAt, no soft delete" design
 * (see its doc comment) — an audit log entry that could be edited or
 * hidden after the fact would defeat its purpose. `list` is read-only.
 */

export type AdminAuditAction =
  | "USER_SUSPENDED"
  | "USER_REACTIVATED"
  | "USER_ROLE_CHANGED"
  | "REVIEW_MODERATED"
  | "REVIEW_RESTORED"
  | "PORTFOLIO_ITEM_MODERATED"
  | "PORTFOLIO_ITEM_RESTORED";

export interface RecordAdminAuditLogData {
  /** The authenticated admin who performed the action — always resolved
   *  server-side from the session (see requireRole()), never accepted as
   *  client input. */
  adminUserId: string;
  action: AdminAuditAction;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown> | null;
}

export interface AdminAuditLogRecord {
  id: string;
  adminUserId: string | null;
  action: AdminAuditAction | string;
  targetType: string;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

export interface ListAdminAuditLogsOptions {
  limit: number;
  offset: number;
}

export interface AdminAuditLogRepository {
  record(data: RecordAdminAuditLogData): Promise<AdminAuditLogRecord>;
  /**
   * Newest first, read-only, paginated — see ListAdminAuditLogsUseCase.
   * Ordered by `createdAt` descending; implementations must break ties
   * (entries created in the same millisecond) deterministically and in a
   * way that still surfaces the more-recently-created entry first — see
   * PrismaAdminAuditLogRepository's `id desc` tiebreaker and the in-memory
   * test fake's insertion-order tiebreaker.
   */
  list(options: ListAdminAuditLogsOptions): Promise<AdminAuditLogRecord[]>;
}
