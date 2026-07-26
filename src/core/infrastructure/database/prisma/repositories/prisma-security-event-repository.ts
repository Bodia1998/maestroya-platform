import type { Prisma } from "@prisma/client";

import { prisma } from "@/infrastructure/database/prisma/client";
import type {
  ListSecurityEventsOptions,
  RecordSecurityEventData,
  SecurityEventRecord,
  SecurityEventRepository,
  SecurityEventType,
} from "@/domain/repositories/security-event-repository";

const SELECT = {
  id: true,
  type: true,
  userId: true,
  ipHash: true,
  userAgent: true,
  metadata: true,
  createdAt: true,
} as const;

type Row = {
  id: string;
  type: string;
  userId: string | null;
  ipHash: string | null;
  userAgent: string | null;
  metadata: Prisma.JsonValue | null;
  createdAt: Date;
};

function toRecord(row: Row): SecurityEventRecord {
  return {
    id: row.id,
    type: row.type as SecurityEventType,
    userId: row.userId,
    ipHash: row.ipHash,
    userAgent: row.userAgent,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    createdAt: row.createdAt,
  };
}

/**
 * Security & Anti-Abuse module (Module 24): Prisma implementation of
 * SecurityEventRepository, backed by the new `SecurityEvent` model (see
 * schema.prisma's doc comment for why it's a dedicated table rather than
 * reusing AuditLog).
 */
export class PrismaSecurityEventRepository implements SecurityEventRepository {
  async record(data: RecordSecurityEventData): Promise<SecurityEventRecord> {
    const row = await prisma.securityEvent.create({
      data: {
        type: data.type,
        userId: data.userId ?? null,
        ipHash: data.ipHash ?? null,
        userAgent: data.userAgent ?? null,
        metadata: (data.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      },
      select: SELECT,
    });
    return toRecord(row);
  }

  async list(options: ListSecurityEventsOptions): Promise<SecurityEventRecord[]> {
    const rows = await prisma.securityEvent.findMany({
      where: {
        type: options.type,
        userId: options.userId,
      },
      select: SELECT,
      // Same deterministic tie-break as PrismaAdminAuditLogRepository.list.
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: options.limit,
      skip: options.offset,
    });
    return rows.map(toRecord);
  }
}
