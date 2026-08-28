import { Prisma } from "@prisma/client";

import { prisma } from "@/infrastructure/database/prisma/client";
import type {
  CreateDiscrepancyData,
  DiscrepancyCategoryValue,
  DiscrepancyEntityTypeValue,
  DiscrepancyResolutionStatusValue,
  DiscrepancySeverityValue,
  ListDiscrepanciesForRunOptions,
  ListUnresolvedDiscrepanciesOptions,
  ReconciliationDiscrepancyRecord,
  ReconciliationDiscrepancyRepository,
  ResolveDiscrepancyData,
} from "@/domain/repositories/reconciliation-repository";

const SELECT = {
  id: true,
  detectedByRunId: true,
  lastSeenRunId: true,
  entityType: true,
  entityId: true,
  jobId: true,
  paymentId: true,
  invoiceId: true,
  payoutId: true,
  refundId: true,
  creditNoteId: true,
  category: true,
  severity: true,
  expectedValue: true,
  actualValue: true,
  differenceValue: true,
  currency: true,
  explanation: true,
  fingerprint: true,
  resolutionStatus: true,
  resolvedByUserId: true,
  resolvedAt: true,
  resolutionReason: true,
  resolutionMetadata: true,
  detectedAt: true,
  updatedAt: true,
} as const;

type Row = {
  id: string;
  detectedByRunId: string;
  lastSeenRunId: string;
  entityType: string;
  entityId: string | null;
  jobId: string | null;
  paymentId: string | null;
  invoiceId: string | null;
  payoutId: string | null;
  refundId: string | null;
  creditNoteId: string | null;
  category: string;
  severity: string;
  expectedValue: unknown;
  actualValue: unknown;
  differenceValue: unknown;
  currency: string | null;
  explanation: string;
  fingerprint: string;
  resolutionStatus: string;
  resolvedByUserId: string | null;
  resolvedAt: Date | null;
  resolutionReason: string | null;
  resolutionMetadata: unknown;
  detectedAt: Date;
  updatedAt: Date;
};

function toNumberOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function toRecord(row: Row): ReconciliationDiscrepancyRecord {
  return {
    id: row.id,
    detectedByRunId: row.detectedByRunId,
    lastSeenRunId: row.lastSeenRunId,
    entityType: row.entityType as DiscrepancyEntityTypeValue,
    entityId: row.entityId,
    jobId: row.jobId,
    paymentId: row.paymentId,
    invoiceId: row.invoiceId,
    payoutId: row.payoutId,
    refundId: row.refundId,
    creditNoteId: row.creditNoteId,
    category: row.category as DiscrepancyCategoryValue,
    severity: row.severity as DiscrepancySeverityValue,
    expectedValue: toNumberOrNull(row.expectedValue),
    actualValue: toNumberOrNull(row.actualValue),
    differenceValue: toNumberOrNull(row.differenceValue),
    currency: row.currency,
    explanation: row.explanation,
    fingerprint: row.fingerprint,
    resolutionStatus: row.resolutionStatus as DiscrepancyResolutionStatusValue,
    resolution:
      row.resolutionStatus === "RESOLVED" && row.resolvedByUserId && row.resolvedAt
        ? {
            resolvedByUserId: row.resolvedByUserId,
            resolvedAt: row.resolvedAt,
            reason: row.resolutionReason ?? "",
            metadata: (row.resolutionMetadata as Record<string, unknown> | null) ?? null,
          }
        : null,
    detectedAt: row.detectedAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Module 80 — Financial Reconciliation & Observability. Prisma
 * implementation of `ReconciliationDiscrepancyRepository` — the only
 * writer of the `reconciliation_discrepancies` table.
 */
export class PrismaReconciliationDiscrepancyRepository implements ReconciliationDiscrepancyRepository {
  async findById(id: string): Promise<ReconciliationDiscrepancyRecord | null> {
    const row = await prisma.reconciliationDiscrepancy.findUnique({ where: { id }, select: SELECT });
    return row ? toRecord(row) : null;
  }

  async findOpenByFingerprint(fingerprint: string): Promise<ReconciliationDiscrepancyRecord | null> {
    const row = await prisma.reconciliationDiscrepancy.findFirst({
      where: { fingerprint, resolutionStatus: "OPEN" },
      select: SELECT,
    });
    return row ? toRecord(row) : null;
  }

  async listForRun(options: ListDiscrepanciesForRunOptions): Promise<ReconciliationDiscrepancyRecord[]> {
    const rows = await prisma.reconciliationDiscrepancy.findMany({
      where: { detectedByRunId: options.runId },
      select: SELECT,
      orderBy: [{ severity: "desc" }, { detectedAt: "desc" }],
      take: options.limit,
      skip: options.offset,
    });
    return rows.map(toRecord);
  }

  async listUnresolved(options: ListUnresolvedDiscrepanciesOptions): Promise<ReconciliationDiscrepancyRecord[]> {
    const severityOrder: DiscrepancySeverityValue[] = ["INFO", "WARNING", "ERROR", "CRITICAL"];
    const minIndex = options.minSeverity ? severityOrder.indexOf(options.minSeverity) : 0;
    const allowedSeverities = severityOrder.slice(minIndex);

    const rows = await prisma.reconciliationDiscrepancy.findMany({
      where: { resolutionStatus: "OPEN", severity: { in: allowedSeverities } },
      select: SELECT,
      orderBy: [{ severity: "desc" }, { detectedAt: "desc" }],
      take: options.limit,
      skip: options.offset,
    });
    return rows.map(toRecord);
  }

  /**
   * See `ReconciliationDiscrepancyRepository.createOrTouch`'s own doc
   * comment for the full concurrency contract. The database's partial
   * unique index (`reconciliation_discrepancies_open_fingerprint_unique`,
   * see the migration) is what makes this safe: the fast path checks
   * `findOpenByFingerprint` first, but if a concurrent run's insert wins
   * the race between that check and this `create`, the P2002 this
   * `create` throws is caught and converted into the same touch-and-
   * return-existing path.
   */
  async createOrTouch(data: CreateDiscrepancyData): Promise<{ record: ReconciliationDiscrepancyRecord; created: boolean }> {
    const existing = await this.findOpenByFingerprint(data.fingerprint);
    if (existing) {
      const touched = await this.touch(existing.id, data.detectedByRunId);
      return { record: touched, created: false };
    }

    try {
      const row = await prisma.reconciliationDiscrepancy.create({
        data: {
          id: data.id,
          detectedByRunId: data.detectedByRunId,
          lastSeenRunId: data.detectedByRunId,
          entityType: data.entityType,
          entityId: data.entityId,
          jobId: data.jobId,
          paymentId: data.paymentId,
          invoiceId: data.invoiceId,
          payoutId: data.payoutId,
          refundId: data.refundId,
          creditNoteId: data.creditNoteId,
          category: data.category,
          severity: data.severity,
          expectedValue: data.expectedValue,
          actualValue: data.actualValue,
          differenceValue: data.differenceValue,
          currency: data.currency,
          explanation: data.explanation,
          fingerprint: data.fingerprint,
          resolutionStatus: "OPEN",
          detectedAt: data.detectedAt,
        },
        select: SELECT,
      });
      return { record: toRecord(row), created: true };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const raceWinner = await this.findOpenByFingerprint(data.fingerprint);
        if (raceWinner) {
          const touched = await this.touch(raceWinner.id, data.detectedByRunId);
          return { record: touched, created: false };
        }
      }
      throw error;
    }
  }

  private async touch(id: string, runId: string): Promise<ReconciliationDiscrepancyRecord> {
    const row = await prisma.reconciliationDiscrepancy.update({
      where: { id },
      data: { lastSeenRunId: runId },
      select: SELECT,
    });
    return toRecord(row);
  }

  async resolve(data: ResolveDiscrepancyData): Promise<ReconciliationDiscrepancyRecord> {
    const row = await prisma.reconciliationDiscrepancy.update({
      where: { id: data.id },
      data: {
        resolutionStatus: "RESOLVED",
        resolvedByUserId: data.resolvedByUserId,
        resolvedAt: data.resolvedAt,
        resolutionReason: data.reason,
        resolutionMetadata: data.metadata === null ? Prisma.JsonNull : (data.metadata as Prisma.InputJsonValue),
      },
      select: SELECT,
    });
    return toRecord(row);
  }
}
