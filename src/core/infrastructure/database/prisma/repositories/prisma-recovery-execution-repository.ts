import type { RecoveryExecution as PrismaRecoveryExecutionRow } from "@prisma/client";

import type { RecoveryCheckpoint, RecoveryStatus } from "@/domain/entities/disaster-recovery";
import { RecoveryExecution } from "@/domain/entities/disaster-recovery";
import type { RecoveryExecutionRepository } from "@/domain/repositories/recovery-execution-repository";
import { prisma } from "@/infrastructure/database/prisma/client";

/**
 * Module 54 — Backup & Disaster Recovery: Prisma-backed
 * `RecoveryExecutionRepository`. Checkpoints are stored as a single JSON
 * column (`checkpoints`) rather than a child table — see
 * schema.prisma's own comment on `RecoveryExecution.checkpoints` for why
 * that is the correct shape here.
 */
export class PrismaRecoveryExecutionRepository implements RecoveryExecutionRepository {
  async save(execution: RecoveryExecution): Promise<void> {
    const data = {
      planId: execution.planId,
      triggeredBy: execution.triggeredBy,
      isDrill: execution.isDrill,
      status: execution.status,
      completedAt: execution.completedAt,
      checkpoints: serializeCheckpoints(execution.checkpoints),
      failureReason: execution.failureReason,
    };

    await prisma.recoveryExecution.upsert({
      where: { id: execution.id },
      create: { id: execution.id, ...data, startedAt: execution.startedAt },
      update: data,
    });
  }

  async findById(id: string): Promise<RecoveryExecution | null> {
    const row = await prisma.recoveryExecution.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findLatestByPlanId(planId: string): Promise<RecoveryExecution | null> {
    const row = await prisma.recoveryExecution.findFirst({
      where: { planId },
      orderBy: { startedAt: "desc" },
    });
    return row ? toDomain(row) : null;
  }

  async findLatestSuccessfulDrillByPlanId(planId: string): Promise<RecoveryExecution | null> {
    const row = await prisma.recoveryExecution.findFirst({
      where: { planId, isDrill: true, status: "COMPLETED" },
      orderBy: { completedAt: "desc" },
    });
    return row ? toDomain(row) : null;
  }
}

function serializeCheckpoints(checkpoints: readonly RecoveryCheckpoint[]): object {
  return checkpoints.map((checkpoint) => ({
    stepId: checkpoint.stepId,
    status: checkpoint.status,
    reachedAt: checkpoint.reachedAt.toISOString(),
    notes: checkpoint.notes,
  }));
}

function deserializeCheckpoints(raw: unknown): RecoveryCheckpoint[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => ({
    stepId: String((entry as { stepId: unknown }).stepId),
    status: (entry as { status: RecoveryCheckpoint["status"] }).status,
    reachedAt: new Date((entry as { reachedAt: string }).reachedAt),
    notes: (entry as { notes: string | null }).notes ?? null,
  }));
}

function toDomain(row: PrismaRecoveryExecutionRow): RecoveryExecution {
  return RecoveryExecution.rehydrate({
    id: row.id,
    planId: row.planId,
    triggeredBy: row.triggeredBy,
    isDrill: row.isDrill,
    status: row.status as RecoveryStatus,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    checkpoints: deserializeCheckpoints(row.checkpoints),
    failureReason: row.failureReason,
  });
}
