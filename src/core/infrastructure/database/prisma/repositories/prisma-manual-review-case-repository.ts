import { prisma } from "@/infrastructure/database/prisma/client";
import type {
  ManualReviewCaseRepository,
  ManualReviewCaseRecord,
  CreateManualReviewCaseData,
} from "@/domain/repositories/manual-review-case-repository";
import type { ManualReviewCaseStateValue } from "@/domain/entities/manual-review-case";
import type { TrustRiskEventReasonValue } from "@/domain/services/trust-score-policy";

/** Module 65 — Trust & Integrity System: Prisma implementation backed by
 *  `trust_manual_review_cases`. */
function toRecord(row: {
  id: string;
  userId: string;
  state: string;
  reason: string;
  summary: string;
  assignedAdminId: string | null;
  resolvedAt: Date | null;
  resolvedByUserId: string | null;
  resolutionNotes: string | null;
  createdAt: Date;
  updatedAt: Date;
}): ManualReviewCaseRecord {
  return { ...row, state: row.state as ManualReviewCaseStateValue, reason: row.reason as TrustRiskEventReasonValue };
}

export class PrismaManualReviewCaseRepository implements ManualReviewCaseRepository {
  async create(data: CreateManualReviewCaseData): Promise<ManualReviewCaseRecord> {
    const row = await prisma.manualReviewCase.create({ data });
    return toRecord(row);
  }

  async findById(id: string): Promise<ManualReviewCaseRecord | null> {
    const row = await prisma.manualReviewCase.findUnique({ where: { id } });
    return row ? toRecord(row) : null;
  }

  async listForUser(userId: string): Promise<ManualReviewCaseRecord[]> {
    const rows = await prisma.manualReviewCase.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
    return rows.map(toRecord);
  }

  async listByState(state: ManualReviewCaseStateValue): Promise<ManualReviewCaseRecord[]> {
    const rows = await prisma.manualReviewCase.findMany({ where: { state }, orderBy: { createdAt: "asc" } });
    return rows.map(toRecord);
  }

  async assign(id: string, adminId: string): Promise<ManualReviewCaseRecord> {
    const row = await prisma.manualReviewCase.update({ where: { id }, data: { assignedAdminId: adminId } });
    return toRecord(row);
  }

  async transition(
    id: string,
    state: ManualReviewCaseStateValue,
    data?: { resolvedByUserId?: string; resolutionNotes?: string },
  ): Promise<ManualReviewCaseRecord> {
    const isTerminal = state === "RESOLVED" || state === "REJECTED";
    const row = await prisma.manualReviewCase.update({
      where: { id },
      data: {
        state,
        ...(isTerminal ? { resolvedAt: new Date() } : {}),
        ...(data?.resolvedByUserId ? { resolvedByUserId: data.resolvedByUserId } : {}),
        ...(data?.resolutionNotes ? { resolutionNotes: data.resolutionNotes } : {}),
      },
    });
    return toRecord(row);
  }

  async countByState(state: ManualReviewCaseStateValue): Promise<number> {
    return prisma.manualReviewCase.count({ where: { state } });
  }

  async countAll(): Promise<number> {
    return prisma.manualReviewCase.count();
  }
}
