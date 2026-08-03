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
  | "PORTFOLIO_ITEM_RESTORED"
  // Professional Verification module (Module 17). These reuse the same
  // append-only AuditLog trail as every action above (see this interface's
  // doc comment). A handful of them (SUBMITTED, RESUBMITTED, DOCUMENT_*) are
  // performed by the *professional*, not an admin — `actorUserId` on the
  // underlying AuditLog is a generic actor, so recording them here keeps a
  // single unified trail rather than introducing a second audit system. See
  // VERIFICATION_ACTION_LOG_LABEL below.
  | "VERIFICATION_SUBMITTED"
  | "VERIFICATION_RESUBMITTED"
  | "VERIFICATION_DOCUMENT_UPLOADED"
  | "VERIFICATION_DOCUMENT_REMOVED"
  | "VERIFICATION_REVIEW_STARTED"
  | "VERIFICATION_APPROVED"
  | "VERIFICATION_REJECTED"
  | "VERIFICATION_RESUBMISSION_REQUESTED"
  // Module 18 — Company Professional. COMPANY_CREATED/UPDATED and the
  // membership/invitation actions are performed by a company owner/admin
  // (not a platform admin) but reuse this same append-only trail, same
  // reasoning as VERIFICATION_SUBMITTED above. COMPANY_SUSPENDED/
  // COMPANY_REACTIVATED and the two company-verification review actions are
  // the only ones performed by a platform ADMIN/SUPER_ADMIN.
  | "COMPANY_CREATED"
  | "COMPANY_UPDATED"
  | "COMPANY_MEMBER_INVITED"
  | "COMPANY_INVITATION_CANCELLED"
  | "COMPANY_INVITATION_ACCEPTED"
  | "COMPANY_INVITATION_DECLINED"
  | "COMPANY_MEMBER_ROLE_CHANGED"
  | "COMPANY_MEMBER_REMOVED"
  | "COMPANY_OWNERSHIP_TRANSFERRED"
  | "COMPANY_VERIFICATION_SUBMITTED"
  | "COMPANY_VERIFICATION_RESUBMITTED"
  | "COMPANY_VERIFICATION_DOCUMENT_UPLOADED"
  | "COMPANY_VERIFICATION_DOCUMENT_REMOVED"
  | "COMPANY_VERIFICATION_REVIEW_STARTED"
  | "COMPANY_VERIFICATION_APPROVED"
  | "COMPANY_VERIFICATION_REJECTED"
  | "COMPANY_VERIFICATION_RESUBMISSION_REQUESTED"
  | "COMPANY_SUSPENDED"
  | "COMPANY_REACTIVATED"
  // Module 21 — Disputes & Support: DISPUTE_CREATED/DISPUTE_MESSAGE_ADDED/
  // DISPUTE_EVIDENCE_ADDED are performed by the customer/professional
  // opening or participating in the case (not an admin) but reuse this same
  // append-only trail, same reasoning as VERIFICATION_SUBMITTED above.
  // DISPUTE_ASSIGNED/DISPUTE_STATUS_CHANGED/DISPUTE_INTERNAL_NOTE_ADDED/
  // DISPUTE_RESOLVED/DISPUTE_REJECTED/DISPUTE_CLOSED are admin-only actions.
  | "DISPUTE_CREATED"
  | "DISPUTE_ASSIGNED"
  | "DISPUTE_STATUS_CHANGED"
  | "DISPUTE_MESSAGE_ADDED"
  | "DISPUTE_EVIDENCE_ADDED"
  | "DISPUTE_INTERNAL_NOTE_ADDED"
  | "DISPUTE_RESOLVED"
  | "DISPUTE_REJECTED"
  | "DISPUTE_CLOSED"
  // Module 21 — Disputes & Support: SupportTicket equivalents.
  | "SUPPORT_TICKET_CREATED"
  | "SUPPORT_TICKET_ASSIGNED"
  | "SUPPORT_TICKET_STATUS_CHANGED"
  | "SUPPORT_TICKET_RESOLVED"
  | "SUPPORT_TICKET_CLOSED"
  // Module 28 — Workflow Completion: recorded by the daily expiration
  // cron itself (no admin user — `adminUserId` is null on these entries,
  // same as any system-triggered audit entry; see
  // RunWorkflowExpirationsUseCase). One entry per expired record, plus one
  // summary entry for the whole cron run.
  | "SERVICE_REQUEST_EXPIRED"
  | "QUOTE_EXPIRED"
  | "VERIFICATION_EXPIRED"
  | "COMPANY_VERIFICATION_EXPIRED"
  | "WORKFLOW_EXPIRATION_RUN";

export interface RecordAdminAuditLogData {
  /** The authenticated admin who performed the action — always resolved
   *  server-side from the session (see requireRole()), never accepted as
   *  client input. `null` only for a system-triggered entry with no human
   *  actor at all — today that is exclusively the Module 28 workflow
   *  expiration cron (see RunWorkflowExpirationsUseCase); every
   *  human-initiated action still always supplies a real userId. */
  adminUserId: string | null;
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
