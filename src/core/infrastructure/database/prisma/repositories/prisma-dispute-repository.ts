import { Prisma } from "@prisma/client";

import { prisma } from "@/infrastructure/database/prisma/client";
import { ConflictError } from "@/domain/errors/domain-error";
import type {
  CreateDisputeData,
  DisputePriorityValue,
  DisputeReasonValue,
  DisputeRecord,
  DisputeRepository,
  DisputeResolutionValue,
  DisputeStatusValue,
  ListAdminDisputesOptions,
  ListDisputesOptions,
} from "@/domain/repositories/dispute-repository";

const DETAIL_SELECT = {
  id: true,
  caseNumber: true,
  title: true,
  jobId: true,
  serviceRequestId: true,
  raisedByUserId: true,
  respondentProfessionalProfileId: true,
  respondentCompanyProfileId: true,
  reason: true,
  status: true,
  priority: true,
  description: true,
  assignedAdminUserId: true,
  resolution: true,
  resolutionNote: true,
  resolvedAt: true,
  resolvedByUserId: true,
  closedAt: true,
  closedByUserId: true,
  createdAt: true,
  updatedAt: true,
} as const;

type PrismaDisputeRow = {
  id: string;
  caseNumber: string;
  title: string;
  jobId: string;
  serviceRequestId: string;
  raisedByUserId: string;
  respondentProfessionalProfileId: string | null;
  respondentCompanyProfileId: string | null;
  reason: string;
  status: string;
  priority: string;
  description: string;
  assignedAdminUserId: string | null;
  resolution: string | null;
  resolutionNote: string | null;
  resolvedAt: Date | null;
  resolvedByUserId: string | null;
  closedAt: Date | null;
  closedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function toRecord(row: PrismaDisputeRow): DisputeRecord {
  return {
    id: row.id,
    caseNumber: row.caseNumber,
    title: row.title,
    jobId: row.jobId,
    serviceRequestId: row.serviceRequestId,
    raisedByUserId: row.raisedByUserId,
    respondentProfessionalProfileId: row.respondentProfessionalProfileId,
    respondentCompanyProfileId: row.respondentCompanyProfileId,
    reason: row.reason as DisputeReasonValue,
    status: row.status as DisputeStatusValue,
    priority: row.priority as DisputePriorityValue,
    description: row.description,
    assignedAdminUserId: row.assignedAdminUserId,
    resolution: row.resolution as DisputeResolutionValue | null,
    resolutionNote: row.resolutionNote,
    resolvedAt: row.resolvedAt,
    resolvedByUserId: row.resolvedByUserId,
    closedAt: row.closedAt,
    closedByUserId: row.closedByUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Module 21 — Disputes & Support: Prisma implementation of
 * DisputeRepository. Follows the same shape as PrismaReviewRepository —
 * narrow SELECTs, plain-object mapping, no Prisma types leaking past this
 * file.
 */
export class PrismaDisputeRepository implements DisputeRepository {
  async findById(id: string): Promise<DisputeRecord | null> {
    const row = await prisma.dispute.findUnique({ where: { id }, select: DETAIL_SELECT });
    return row ? toRecord(row) : null;
  }

  async listByJobId(jobId: string): Promise<DisputeRecord[]> {
    const rows = await prisma.dispute.findMany({
      where: { jobId },
      select: DETAIL_SELECT,
      orderBy: [{ createdAt: "desc" }],
    });
    return rows.map(toRecord);
  }

  async listRaisedByUser(userId: string, options: ListDisputesOptions): Promise<DisputeRecord[]> {
    const rows = await prisma.dispute.findMany({
      where: { raisedByUserId: userId, ...(options.status ? { status: options.status } : {}) },
      select: DETAIL_SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: options.limit,
      skip: options.offset,
    });
    return rows.map(toRecord);
  }

  async listForAdmin(options: ListAdminDisputesOptions): Promise<DisputeRecord[]> {
    const rows = await prisma.dispute.findMany({
      where: {
        ...(options.status ? { status: options.status } : {}),
        ...(options.priority ? { priority: options.priority } : {}),
        ...(options.reason ? { reason: options.reason } : {}),
        ...(options.assignedAdminUserId ? { assignedAdminUserId: options.assignedAdminUserId } : {}),
        ...(options.search
          ? {
              OR: [
                { caseNumber: { contains: options.search, mode: "insensitive" } },
                { title: { contains: options.search, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      select: DETAIL_SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: options.limit,
      skip: options.offset,
    });
    return rows.map(toRecord);
  }

  /**
   * Creates the Dispute. Two unique constraints can fail concurrently: the
   * `caseNumber` unique index (extremely unlikely — see
   * dispute-rules.ts's formatCaseNumber doc comment on the count-based
   * numbering's known race window) and the partial unique index enforcing
   * "at most one OPEN dispute per (job, opener)" (see the migration's
   * `disputes_open_per_job_per_opener_unique`) — CreateDisputeUseCase
   * already checks the latter before calling this, but the DB constraint is
   * the final guarantee under real concurrency, same "check in the use
   * case, the DB is the final guarantee" convention as
   * PrismaReviewRepository.create. Both surface as Prisma P2002 and are
   * translated into a ConflictError here rather than a raw Prisma error.
   */
  async create(data: CreateDisputeData): Promise<DisputeRecord> {
    try {
      const row = await prisma.dispute.create({
        data: {
          caseNumber: data.caseNumber,
          title: data.title,
          jobId: data.jobId,
          serviceRequestId: data.serviceRequestId,
          raisedByUserId: data.raisedByUserId,
          respondentProfessionalProfileId: data.respondentProfessionalProfileId,
          respondentCompanyProfileId: data.respondentCompanyProfileId,
          reason: data.reason,
          priority: data.priority,
          description: data.description,
        },
        select: DETAIL_SELECT,
      });
      return toRecord(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictError(
          "You already have an open dispute for this job, or the case number collided — please retry.",
        );
      }
      throw error;
    }
  }

  async updateStatus(
    id: string,
    expectedStatus: DisputeStatusValue,
    data: {
      status: DisputeStatusValue;
      resolution?: DisputeResolutionValue | null;
      resolutionNote?: string | null;
      resolvedAt?: Date | null;
      resolvedByUserId?: string | null;
      closedAt?: Date | null;
      closedByUserId?: string | null;
    },
  ): Promise<DisputeRecord> {
    // Optimistic-concurrency guard: `updateMany` with a `where` clause that
    // includes the expected current status only touches a row still in
    // that status, same convention as PrismaJobRepository's mutating
    // methods. A count of 0 means either the dispute doesn't exist or lost
    // a race — both surface as ConflictError so the caller (already holding
    // a freshly-loaded DisputeRecord) can decide whether to reload and
    // retry or surface the conflict to the user.
    const result = await prisma.dispute.updateMany({
      where: { id, status: expectedStatus },
      data: {
        status: data.status,
        resolution: data.resolution,
        resolutionNote: data.resolutionNote,
        resolvedAt: data.resolvedAt,
        resolvedByUserId: data.resolvedByUserId,
        closedAt: data.closedAt,
        closedByUserId: data.closedByUserId,
      },
    });
    if (result.count === 0) {
      throw new ConflictError("This dispute's status changed before this update could be applied.");
    }
    const row = await prisma.dispute.findUniqueOrThrow({ where: { id }, select: DETAIL_SELECT });
    return toRecord(row);
  }

  async assign(id: string, assignedAdminUserId: string | null): Promise<DisputeRecord> {
    const row = await prisma.dispute.update({
      where: { id },
      data: { assignedAdminUserId },
      select: DETAIL_SELECT,
    });
    return toRecord(row);
  }

  async setPriority(id: string, priority: DisputePriorityValue): Promise<DisputeRecord> {
    const row = await prisma.dispute.update({
      where: { id },
      data: { priority },
      select: DETAIL_SELECT,
    });
    return toRecord(row);
  }
}
