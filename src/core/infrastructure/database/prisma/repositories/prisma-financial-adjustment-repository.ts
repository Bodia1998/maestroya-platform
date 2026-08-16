import { prisma } from "@/infrastructure/database/prisma/client";
import { ConflictError } from "@/domain/errors/domain-error";
import type {
  CreateFinancialAdjustmentData,
  FinancialAdjustmentRecord,
  FinancialAdjustmentRepository,
  FinancialAdjustmentStatusValue,
  FinancialAdjustmentTypeValue,
} from "@/domain/repositories/financial-adjustment-repository";

const SELECT = {
  id: true,
  jobId: true,
  disputeId: true,
  paymentId: true,
  type: true,
  status: true,
  amount: true,
  currency: true,
  reason: true,
  requestedByUserId: true,
  idempotencyKey: true,
  transactionId: true,
  resolutionDecisionId: true,
  appliedAt: true,
  createdAt: true,
} as const;

type Row = {
  id: string;
  jobId: string;
  disputeId: string | null;
  paymentId: string | null;
  type: string;
  status: string;
  amount: unknown;
  currency: string;
  reason: string | null;
  requestedByUserId: string;
  idempotencyKey: string;
  transactionId: string | null;
  resolutionDecisionId: string | null;
  appliedAt: Date | null;
  createdAt: Date;
};

function toRecord(row: Row): FinancialAdjustmentRecord {
  return {
    id: row.id,
    jobId: row.jobId,
    disputeId: row.disputeId,
    paymentId: row.paymentId,
    type: row.type as FinancialAdjustmentTypeValue,
    status: row.status as FinancialAdjustmentStatusValue,
    amount: Number(row.amount),
    currency: row.currency,
    reason: row.reason,
    requestedByUserId: row.requestedByUserId,
    idempotencyKey: row.idempotencyKey,
    transactionId: row.transactionId,
    resolutionDecisionId: row.resolutionDecisionId,
    appliedAt: row.appliedAt,
    createdAt: row.createdAt,
  };
}

export class PrismaFinancialAdjustmentRepository implements FinancialAdjustmentRepository {
  async findByIdempotencyKey(idempotencyKey: string): Promise<FinancialAdjustmentRecord | null> {
    const row = await prisma.financialAdjustment.findUnique({ where: { idempotencyKey }, select: SELECT });
    return row ? toRecord(row) : null;
  }

  async findById(id: string): Promise<FinancialAdjustmentRecord | null> {
    const row = await prisma.financialAdjustment.findUnique({ where: { id }, select: SELECT });
    return row ? toRecord(row) : null;
  }

  async create(data: CreateFinancialAdjustmentData): Promise<FinancialAdjustmentRecord> {
    const row = await prisma.financialAdjustment.create({
      data: {
        jobId: data.jobId,
        disputeId: data.disputeId,
        paymentId: data.paymentId,
        type: data.type,
        amount: data.amount,
        reason: data.reason,
        requestedByUserId: data.requestedByUserId,
        idempotencyKey: data.idempotencyKey,
        resolutionDecisionId: data.resolutionDecisionId ?? null,
      },
      select: SELECT,
    });
    return toRecord(row);
  }

  async markApplied(id: string, transactionId: string): Promise<FinancialAdjustmentRecord> {
    const updated = await prisma.financialAdjustment.updateMany({
      where: { id, status: "PENDING" },
      data: { status: "APPLIED", transactionId, appliedAt: new Date() },
    });
    if (updated.count === 0) {
      throw new ConflictError("This financial adjustment is no longer pending.");
    }
    const row = await prisma.financialAdjustment.findUniqueOrThrow({ where: { id }, select: SELECT });
    return toRecord(row);
  }

  async markFailed(id: string): Promise<FinancialAdjustmentRecord> {
    const updated = await prisma.financialAdjustment.updateMany({
      where: { id, status: "PENDING" },
      data: { status: "FAILED" },
    });
    if (updated.count === 0) {
      throw new ConflictError("This financial adjustment is no longer pending.");
    }
    const row = await prisma.financialAdjustment.findUniqueOrThrow({ where: { id }, select: SELECT });
    return toRecord(row);
  }

  async listForJob(jobId: string): Promise<FinancialAdjustmentRecord[]> {
    const rows = await prisma.financialAdjustment.findMany({
      where: { jobId },
      select: SELECT,
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toRecord);
  }
}
