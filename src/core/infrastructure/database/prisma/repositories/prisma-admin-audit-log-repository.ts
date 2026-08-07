import type { Prisma } from "@prisma/client";

import { prisma } from "@/infrastructure/database/prisma/client";
import type {
  AdminAuditAction,
  AdminAuditLogRecord,
  AdminAuditLogRepository,
  ListAdminAuditLogsOptions,
  RecordAdminAuditLogData,
} from "@/domain/repositories/admin-audit-log-repository";

/** See admin-audit-log-repository.ts's own doc comment for why each admin
 *  action maps to the closest existing AuditLogAction enum value instead of
 *  widening that enum. */
const ADMIN_ACTION_TO_LOG_ACTION: Record<AdminAuditAction, Prisma.AuditLogCreateInput["action"]> = {
  USER_SUSPENDED: "STATUS_CHANGE",
  USER_REACTIVATED: "STATUS_CHANGE",
  USER_ROLE_CHANGED: "UPDATE",
  REVIEW_MODERATED: "UPDATE",
  REVIEW_RESTORED: "UPDATE",
  PORTFOLIO_ITEM_MODERATED: "UPDATE",
  PORTFOLIO_ITEM_RESTORED: "UPDATE",
  // Professional Verification module (Module 17): the existing AuditLogAction
  // enum already has a dedicated `VERIFICATION` value — every verification
  // action maps to it (the concrete action name is preserved in
  // metadata.adminAction, same as every other admin action).
  VERIFICATION_SUBMITTED: "VERIFICATION",
  VERIFICATION_RESUBMITTED: "VERIFICATION",
  VERIFICATION_DOCUMENT_UPLOADED: "VERIFICATION",
  VERIFICATION_DOCUMENT_REMOVED: "VERIFICATION",
  VERIFICATION_REVIEW_STARTED: "VERIFICATION",
  VERIFICATION_APPROVED: "VERIFICATION",
  VERIFICATION_REJECTED: "VERIFICATION",
  VERIFICATION_RESUBMISSION_REQUESTED: "VERIFICATION",
  // Module 18 — Company Professional: same "map to the closest existing
  // AuditLogAction value, preserve the concrete action in metadata.adminAction"
  // convention. Company profile/membership/invitation actions map to
  // CREATE/UPDATE/STATUS_CHANGE as appropriate; verification review actions
  // reuse VERIFICATION, same as Module 17's own actions.
  COMPANY_CREATED: "CREATE",
  COMPANY_UPDATED: "UPDATE",
  COMPANY_MEMBER_INVITED: "CREATE",
  COMPANY_INVITATION_CANCELLED: "UPDATE",
  COMPANY_INVITATION_ACCEPTED: "UPDATE",
  COMPANY_INVITATION_DECLINED: "UPDATE",
  COMPANY_MEMBER_ROLE_CHANGED: "UPDATE",
  COMPANY_MEMBER_REMOVED: "UPDATE",
  COMPANY_OWNERSHIP_TRANSFERRED: "UPDATE",
  COMPANY_VERIFICATION_SUBMITTED: "VERIFICATION",
  COMPANY_VERIFICATION_RESUBMITTED: "VERIFICATION",
  COMPANY_VERIFICATION_DOCUMENT_UPLOADED: "VERIFICATION",
  COMPANY_VERIFICATION_DOCUMENT_REMOVED: "VERIFICATION",
  COMPANY_VERIFICATION_REVIEW_STARTED: "VERIFICATION",
  COMPANY_VERIFICATION_APPROVED: "VERIFICATION",
  COMPANY_VERIFICATION_REJECTED: "VERIFICATION",
  COMPANY_VERIFICATION_RESUBMISSION_REQUESTED: "VERIFICATION",
  COMPANY_SUSPENDED: "STATUS_CHANGE",
  COMPANY_REACTIVATED: "STATUS_CHANGE",
  // Module 21 — Disputes & Support: same "map to the closest existing
  // AuditLogAction value, preserve the concrete action name in
  // metadata.adminAction" convention.
  DISPUTE_CREATED: "CREATE",
  DISPUTE_ASSIGNED: "UPDATE",
  DISPUTE_STATUS_CHANGED: "STATUS_CHANGE",
  DISPUTE_MESSAGE_ADDED: "CREATE",
  DISPUTE_EVIDENCE_ADDED: "CREATE",
  DISPUTE_INTERNAL_NOTE_ADDED: "CREATE",
  DISPUTE_RESOLVED: "STATUS_CHANGE",
  DISPUTE_REJECTED: "STATUS_CHANGE",
  DISPUTE_CLOSED: "STATUS_CHANGE",
  SUPPORT_TICKET_CREATED: "CREATE",
  SUPPORT_TICKET_ASSIGNED: "UPDATE",
  SUPPORT_TICKET_STATUS_CHANGED: "STATUS_CHANGE",
  SUPPORT_TICKET_RESOLVED: "STATUS_CHANGE",
  SUPPORT_TICKET_CLOSED: "STATUS_CHANGE",
  // Module 28 — Workflow Completion: each per-record expiry is a status
  // change; the cron's own summary entry has no closer existing value than
  // OTHER.
  SERVICE_REQUEST_EXPIRED: "STATUS_CHANGE",
  QUOTE_EXPIRED: "STATUS_CHANGE",
  VERIFICATION_EXPIRED: "VERIFICATION",
  COMPANY_VERIFICATION_EXPIRED: "VERIFICATION",
  WORKFLOW_EXPIRATION_RUN: "OTHER",
  // Module 38 — GDPR Compliance: same "map to the closest existing
  // AuditLogAction value, preserve the concrete action name in
  // metadata.adminAction" convention. None of these are a status change on
  // an existing entity or a create/update of one — "OTHER" is the closest
  // fit for all five, same reasoning as WORKFLOW_EXPIRATION_RUN above.
  GDPR_EXPORT_REQUESTED: "OTHER",
  GDPR_EXPORT_PREPARED: "OTHER",
  GDPR_DELETION_REQUESTED: "OTHER",
  GDPR_CONSENT_GRANTED: "OTHER",
  GDPR_CONSENT_WITHDRAWN: "OTHER",
  // Module 41 — Reviews & Ratings: same "map to the closest existing
  // AuditLogAction value, preserve the concrete action name in
  // metadata.adminAction" convention.
  REVIEW_CREATED: "CREATE",
  REVIEW_UPDATED: "UPDATE",
  REVIEW_DELETED: "DELETE",
  REVIEW_RESPONSE_ADDED: "CREATE",
};

const SELECT = {
  id: true,
  actorUserId: true,
  action: true,
  entityType: true,
  entityId: true,
  metadata: true,
  createdAt: true,
} as const;

type Row = {
  id: string;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Prisma.JsonValue | null;
  createdAt: Date;
};

function toRecord(row: Row): AdminAuditLogRecord {
  const metadata = (row.metadata as Record<string, unknown> | null) ?? null;
  return {
    id: row.id,
    adminUserId: row.actorUserId,
    // `adminAction` is always present on rows this repository itself wrote
    // (see `record` below) — falls back to the raw enum value for any
    // pre-existing/foreign AuditLog row this read path might encounter.
    action: (metadata?.adminAction as string | undefined) ?? row.action,
    targetType: row.entityType,
    targetId: row.entityId,
    metadata,
    createdAt: row.createdAt,
  };
}

/**
 * Admin Panel module (Module 16): Prisma implementation of
 * AdminAuditLogRepository, backed by the existing `AuditLog` model (see
 * this interface's own doc comment for why no new table was introduced).
 */
export class PrismaAdminAuditLogRepository implements AdminAuditLogRepository {
  async record(data: RecordAdminAuditLogData): Promise<AdminAuditLogRecord> {
    const row = await prisma.auditLog.create({
      data: {
        actorUserId: data.adminUserId,
        action: ADMIN_ACTION_TO_LOG_ACTION[data.action],
        entityType: data.targetType,
        entityId: data.targetId,
        metadata: {
          adminAction: data.action,
          ...(data.metadata ?? {}),
        } as Prisma.InputJsonValue,
      },
      select: SELECT,
    });
    return toRecord(row);
  }

  async list(options: ListAdminAuditLogsOptions): Promise<AdminAuditLogRecord[]> {
    const rows = await prisma.auditLog.findMany({
      select: SELECT,
      // `createdAt` alone does not guarantee a deterministic "newest
      // first" order: two rows created in the same request (or the same
      // millisecond under load) tie, and Postgres does not promise any
      // particular order among tied rows. `id desc` breaks ties
      // deterministically. `id` is a random UUID (see schema.prisma) so it
      // doesn't itself encode creation order, but it keeps repeated reads
      // of the same page stable and consistent with the in-memory fake
      // (tests/integration/admin/fakes.ts), which tiebreaks on true
      // insertion order for the same reason.
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: options.limit,
      skip: options.offset,
    });
    return rows.map(toRecord);
  }
}
