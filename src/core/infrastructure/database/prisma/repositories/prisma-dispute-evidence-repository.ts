import { prisma } from "@/infrastructure/database/prisma/client";
import type {
  CreateDisputeEvidenceData,
  DisputeEvidenceRecord,
  DisputeEvidenceRepository,
} from "@/domain/repositories/dispute-evidence-repository";

const SELECT = {
  id: true,
  disputeId: true,
  submittedByUserId: true,
  fileUrl: true,
  fileName: true,
  fileType: true,
  fileSizeBytes: true,
  description: true,
  createdAt: true,
} as const;

type Row = {
  id: string;
  disputeId: string;
  submittedByUserId: string;
  fileUrl: string;
  fileName: string | null;
  fileType: string | null;
  fileSizeBytes: number | null;
  description: string | null;
  createdAt: Date;
};

function toRecord(row: Row): DisputeEvidenceRecord {
  return { ...row };
}

/** Module 21 — Disputes & Support: Prisma implementation of
 *  DisputeEvidenceRepository. */
export class PrismaDisputeEvidenceRepository implements DisputeEvidenceRepository {
  async listByDisputeId(disputeId: string): Promise<DisputeEvidenceRecord[]> {
    const rows = await prisma.disputeEvidence.findMany({
      where: { disputeId },
      select: SELECT,
      orderBy: [{ createdAt: "asc" }],
    });
    return rows.map(toRecord);
  }

  async create(data: CreateDisputeEvidenceData): Promise<DisputeEvidenceRecord> {
    const row = await prisma.disputeEvidence.create({
      data: {
        disputeId: data.disputeId,
        submittedByUserId: data.submittedByUserId,
        fileUrl: data.fileUrl,
        fileName: data.fileName,
        fileType: data.fileType,
        fileSizeBytes: data.fileSizeBytes,
        description: data.description,
      },
      select: SELECT,
    });
    return toRecord(row);
  }
}
