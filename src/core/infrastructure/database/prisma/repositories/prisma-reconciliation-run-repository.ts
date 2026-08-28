import { prisma } from "@/infrastructure/database/prisma/client";
import type {
  CompleteReconciliationRunData,
  FailReconciliationRunData,
  ListReconciliationRunsOptions,
  ReconciliationRunRecord,
  ReconciliationRunRepository,
  ReconciliationRunStatusValue,
  ReconciliationScopeValue,
  StartReconciliationRunData,
} from "@/domain/repositories/reconciliation-repository";

const SELECT = {
  id: true,
  scope: true,
  status: true,
  startedAt: true,
  completedAt: true,
  durationMs: true,
  recordsInspected: true,
  discrepancyCount: true,
  errorMessage: true,
  parametersHash: true,
  triggeredByUserId: true,
  createdAt: true,
} as const;

type Row = {
  id: string;
  scope: string;
  status: string;
  startedAt: Date;
  completedAt: Date | null;
  durationMs: number | null;
  recordsInspected: number;
  discrepancyCount: number;
  errorMessage: string | null;
  parametersHash: string;
  triggeredByUserId: string | null;
  createdAt: Date;
};

function toRecord(row: Row): ReconciliationRunRecord {
  return {
    id: row.id,
    scope: row.scope as ReconciliationScopeValue,
    status: row.status as ReconciliationRunStatusValue,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    durationMs: row.durationMs,
    recordsInspected: row.recordsInspected,
    discrepancyCount: row.discrepancyCount,
    errorMessage: row.errorMessage,
    parametersHash: row.parametersHash,
    triggeredByUserId: row.triggeredByUserId,
    createdAt: row.createdAt,
  };
}

/**
 * Module 80 — Financial Reconciliation & Observability. Prisma
 * implementation of `ReconciliationRunRepository` — the only writer of
 * the `reconciliation_runs` table.
 */
export class PrismaReconciliationRunRepository implements ReconciliationRunRepository {
  async findById(id: string): Promise<ReconciliationRunRecord | null> {
    const row = await prisma.reconciliationRun.findUnique({ where: { id }, select: SELECT });
    return row ? toRecord(row) : null;
  }

  async list(options: ListReconciliationRunsOptions): Promise<ReconciliationRunRecord[]> {
    const rows = await prisma.reconciliationRun.findMany({
      where: options.status ? { status: options.status } : undefined,
      select: SELECT,
      orderBy: { startedAt: "desc" },
      take: options.limit,
      skip: options.offset,
    });
    return rows.map(toRecord);
  }

  async start(data: StartReconciliationRunData): Promise<ReconciliationRunRecord> {
    const row = await prisma.reconciliationRun.create({
      data: {
        id: data.id,
        scope: data.scope,
        status: "RUNNING",
        startedAt: data.startedAt,
        recordsInspected: 0,
        discrepancyCount: 0,
        parametersHash: data.parametersHash,
        triggeredByUserId: data.triggeredByUserId,
      },
      select: SELECT,
    });
    return toRecord(row);
  }

  // Compare-and-swap: only a RUNNING row transitions — same "fold the
  // guard into the write itself" convention as PrismaPayoutRepository.markPaid.
  // A single run is driven end-to-end by one process, so a lost race here
  // would indicate a genuine bug (e.g. execute() called twice concurrently
  // for the identical runId), not a normal concurrent-runs scenario —
  // concurrent *runs* each have their own id and never contend on this
  // guard; only the discrepancy layer needs cross-run concurrency safety
  // (see ReconciliationDiscrepancyRepository.createOrTouch).
  async complete(data: CompleteReconciliationRunData): Promise<ReconciliationRunRecord> {
    await prisma.reconciliationRun.updateMany({
      where: { id: data.id, status: "RUNNING" },
      data: {
        status: "COMPLETED",
        completedAt: data.completedAt,
        durationMs: data.durationMs,
        recordsInspected: data.recordsInspected,
        discrepancyCount: data.discrepancyCount,
      },
    });
    const row = await prisma.reconciliationRun.findUniqueOrThrow({ where: { id: data.id }, select: SELECT });
    return toRecord(row);
  }

  async fail(data: FailReconciliationRunData): Promise<ReconciliationRunRecord> {
    await prisma.reconciliationRun.updateMany({
      where: { id: data.id, status: "RUNNING" },
      data: {
        status: "FAILED",
        completedAt: data.completedAt,
        durationMs: data.durationMs,
        recordsInspected: data.recordsInspected,
        errorMessage: data.errorMessage,
      },
    });
    const row = await prisma.reconciliationRun.findUniqueOrThrow({ where: { id: data.id }, select: SELECT });
    return toRecord(row);
  }
}
