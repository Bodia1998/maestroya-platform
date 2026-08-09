import type { BackupRecord as PrismaBackupRecordRow } from "@prisma/client";

import { BackupRecord, RetentionPolicy, type BackupTarget } from "@/domain/entities/backup";
import type { BackupRecordRepository } from "@/domain/repositories/backup-record-repository";
import { prisma } from "@/infrastructure/database/prisma/client";

/**
 * Module 54 — Backup & Disaster Recovery: Prisma-backed
 * `BackupRecordRepository`. Maps between the `BackupRecord` aggregate
 * (which encapsulates its own lifecycle transitions) and the
 * `backup_records` table row — the only place either direction of that
 * mapping happens, mirroring every other `Prisma*Repository` in this
 * codebase.
 */
export class PrismaBackupRecordRepository implements BackupRecordRepository {
  async save(record: BackupRecord): Promise<void> {
    const data = {
      target: record.target,
      type: record.type,
      status: record.status,
      retentionDays: record.retentionPolicy.retentionDays,
      minRetainedBackups: record.retentionPolicy.minRetainedBackups,
      startedAt: record.startedAt,
      completedAt: record.completedAt,
      expiresAt: record.expiresAt,
      sizeBytes: record.sizeBytes === null ? null : BigInt(record.sizeBytes),
      checksumSha256: record.checksumSha256,
      locationUri: record.locationUri,
      verifiedAt: record.verifiedAt,
      restoredAt: record.restoredAt,
      failureReason: record.failureReason,
    };

    await prisma.backupRecord.upsert({
      where: { id: record.id },
      create: { id: record.id, ...data, createdAt: record.createdAt },
      update: data,
    });
  }

  async findById(id: string): Promise<BackupRecord | null> {
    const row = await prisma.backupRecord.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findLatestByTarget(target: BackupTarget): Promise<BackupRecord | null> {
    const row = await prisma.backupRecord.findFirst({
      where: { target },
      orderBy: { createdAt: "desc" },
    });
    return row ? toDomain(row) : null;
  }

  async findLatestCompletedByTarget(target: BackupTarget): Promise<BackupRecord | null> {
    const row = await prisma.backupRecord.findFirst({
      where: { target, status: { in: ["COMPLETED", "VERIFIED"] } },
      orderBy: { completedAt: "desc" },
    });
    return row ? toDomain(row) : null;
  }

  async listByTarget(target: BackupTarget): Promise<BackupRecord[]> {
    const rows = await prisma.backupRecord.findMany({
      where: { target },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toDomain);
  }
}

function toDomain(row: PrismaBackupRecordRow): BackupRecord {
  return BackupRecord.rehydrate({
    id: row.id,
    target: row.target as BackupTarget,
    type: row.type as BackupRecord["type"],
    retentionPolicy: new RetentionPolicy(row.retentionDays, row.minRetainedBackups),
    status: row.status as BackupRecord["status"],
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    expiresAt: row.expiresAt,
    sizeBytes: row.sizeBytes === null ? null : Number(row.sizeBytes),
    checksumSha256: row.checksumSha256,
    locationUri: row.locationUri,
    verifiedAt: row.verifiedAt,
    restoredAt: row.restoredAt,
    failureReason: row.failureReason,
  });
}
