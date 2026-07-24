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
