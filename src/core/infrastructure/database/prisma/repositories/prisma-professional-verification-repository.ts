import type { Prisma } from "@prisma/client";

import { prisma } from "@/infrastructure/database/prisma/client";
import type { VerificationStatusValue } from "@/domain/repositories/professional-repository";
import type {
  AddVerificationDocumentData,
  AdminVerificationDetail,
  AdminVerificationListItem,
  ListAdminVerificationsOptions,
  ProfessionalVerificationRecord,
  ProfessionalVerificationRepository,
  ProfessionalVerificationWithDocuments,
  UpdateVerificationStatusData,
  VerificationDocumentRecord,
} from "@/domain/repositories/professional-verification-repository";
import type {
  ProfessionalVerificationStatusValue,
  VerificationDocumentStatusValue,
  VerificationDocumentTypeValue,
} from "@/domain/services/professional-verification-rules";

/**
 * Professional Verification module (Module 17): Prisma implementation of
 * ProfessionalVerificationRepository, backed by the `professional_
 * verifications` / `professional_verification_documents` tables added by
 * this module's migration. Same "narrow SELECT + toRecord mapper" convention
 * as every other Prisma repository in this codebase.
 */

const VERIFICATION_SELECT = {
  id: true,
  professionalProfileId: true,
  status: true,
  submittedAt: true,
  reviewedAt: true,
  reviewedByUserId: true,
  rejectionReason: true,
  resubmissionReason: true,
  expiresAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

const DOCUMENT_SELECT = {
  id: true,
  verificationId: true,
  type: true,
  status: true,
  fileUrl: true,
  originalFilename: true,
  mimeType: true,
  fileSizeBytes: true,
  rejectionReason: true,
  createdAt: true,
  updatedAt: true,
} as const;

type VerificationRow = {
  id: string;
  professionalProfileId: string;
  status: string;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  reviewedByUserId: string | null;
  rejectionReason: string | null;
  resubmissionReason: string | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type DocumentRow = {
  id: string;
  verificationId: string;
  type: string;
  status: string;
  fileUrl: string;
  originalFilename: string;
  mimeType: string;
  fileSizeBytes: number;
  rejectionReason: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function toVerificationRecord(row: VerificationRow): ProfessionalVerificationRecord {
  return {
    id: row.id,
    professionalProfileId: row.professionalProfileId,
    status: row.status as ProfessionalVerificationStatusValue,
    submittedAt: row.submittedAt,
    reviewedAt: row.reviewedAt,
    reviewedByUserId: row.reviewedByUserId,
    rejectionReason: row.rejectionReason,
    resubmissionReason: row.resubmissionReason,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toDocumentRecord(row: DocumentRow): VerificationDocumentRecord {
  return {
    id: row.id,
    verificationId: row.verificationId,
    type: row.type as VerificationDocumentTypeValue,
    status: row.status as VerificationDocumentStatusValue,
    fileUrl: row.fileUrl,
    originalFilename: row.originalFilename,
    mimeType: row.mimeType,
    fileSizeBytes: row.fileSizeBytes,
    rejectionReason: row.rejectionReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PrismaProfessionalVerificationRepository implements ProfessionalVerificationRepository {
  async create(professionalProfileId: string): Promise<ProfessionalVerificationRecord> {
    const row = await prisma.professionalVerification.create({
      data: { professionalProfileId, status: "DRAFT" },
      select: VERIFICATION_SELECT,
    });
    return toVerificationRecord(row);
  }

  async findActiveByProfessionalProfileId(
    professionalProfileId: string,
  ): Promise<ProfessionalVerificationRecord | null> {
    const row = await prisma.professionalVerification.findFirst({
      where: { professionalProfileId, status: { not: "EXPIRED" } },
      orderBy: { createdAt: "desc" },
      select: VERIFICATION_SELECT,
    });
    return row ? toVerificationRecord(row) : null;
  }

  async findActiveWithDocumentsByProfessionalProfileId(
    professionalProfileId: string,
  ): Promise<ProfessionalVerificationWithDocuments | null> {
    const row = await prisma.professionalVerification.findFirst({
      where: { professionalProfileId, status: { not: "EXPIRED" } },
      orderBy: { createdAt: "desc" },
      select: { ...VERIFICATION_SELECT, documents: { select: DOCUMENT_SELECT, orderBy: { createdAt: "asc" } } },
    });
    if (!row) return null;
    const { documents, ...verification } = row;
    return { ...toVerificationRecord(verification), documents: documents.map(toDocumentRecord) };
  }

  async findById(id: string): Promise<ProfessionalVerificationRecord | null> {
    const row = await prisma.professionalVerification.findUnique({ where: { id }, select: VERIFICATION_SELECT });
    return row ? toVerificationRecord(row) : null;
  }

  async updateStatus(id: string, data: UpdateVerificationStatusData): Promise<ProfessionalVerificationRecord> {
    const row = await prisma.professionalVerification.update({
      where: { id },
      data: {
        status: data.status,
        ...(data.submittedAt !== undefined ? { submittedAt: data.submittedAt } : {}),
        ...(data.reviewedAt !== undefined ? { reviewedAt: data.reviewedAt } : {}),
        ...(data.reviewedByUserId !== undefined ? { reviewedByUserId: data.reviewedByUserId } : {}),
        ...(data.rejectionReason !== undefined ? { rejectionReason: data.rejectionReason } : {}),
        ...(data.resubmissionReason !== undefined ? { resubmissionReason: data.resubmissionReason } : {}),
        ...(data.expiresAt !== undefined ? { expiresAt: data.expiresAt } : {}),
      },
      select: VERIFICATION_SELECT,
    });
    return toVerificationRecord(row);
  }

  async addDocument(data: AddVerificationDocumentData): Promise<VerificationDocumentRecord> {
    const row = await prisma.professionalVerificationDocument.create({
      data: {
        verificationId: data.verificationId,
        type: data.type,
        fileUrl: data.fileUrl,
        originalFilename: data.originalFilename,
        mimeType: data.mimeType,
        fileSizeBytes: data.fileSizeBytes,
      },
      select: DOCUMENT_SELECT,
    });
    return toDocumentRecord(row);
  }

  async findDocumentById(id: string): Promise<VerificationDocumentRecord | null> {
    const row = await prisma.professionalVerificationDocument.findUnique({ where: { id }, select: DOCUMENT_SELECT });
    return row ? toDocumentRecord(row) : null;
  }

  async listDocuments(verificationId: string): Promise<VerificationDocumentRecord[]> {
    const rows = await prisma.professionalVerificationDocument.findMany({
      where: { verificationId },
      orderBy: { createdAt: "asc" },
      select: DOCUMENT_SELECT,
    });
    return rows.map(toDocumentRecord);
  }

  async countDocuments(verificationId: string): Promise<number> {
    return prisma.professionalVerificationDocument.count({ where: { verificationId } });
  }

  async removeDocument(id: string): Promise<void> {
    await prisma.professionalVerificationDocument.delete({ where: { id } });
  }

  async setProfileVerificationStatus(
    professionalProfileId: string,
    status: VerificationStatusValue,
    verifiedAt: Date | null,
  ): Promise<void> {
    await prisma.professionalProfile.update({
      where: { id: professionalProfileId },
      data: { verificationStatus: status, verifiedAt },
    });
  }

  async listForAdmin(options: ListAdminVerificationsOptions): Promise<AdminVerificationListItem[]> {
    const where: Prisma.ProfessionalVerificationWhereInput = options.status ? { status: options.status } : {};
    const rows = await prisma.professionalVerification.findMany({
      where,
      orderBy: [{ submittedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }, { id: "desc" }],
      take: options.limit,
      skip: options.offset,
      select: {
        ...VERIFICATION_SELECT,
        professionalProfile: {
          select: { businessName: true, user: { select: { name: true, email: true } } },
        },
      },
    });
    return rows.map((row) => {
      const { professionalProfile, ...verification } = row;
      return {
        ...toVerificationRecord(verification),
        businessName: professionalProfile.businessName,
        professionalName: professionalProfile.user.name,
        professionalEmail: professionalProfile.user.email,
      } satisfies AdminVerificationListItem;
    });
  }

  async getDetailForAdmin(id: string): Promise<AdminVerificationDetail | null> {
    const row = await prisma.professionalVerification.findUnique({
      where: { id },
      select: {
        ...VERIFICATION_SELECT,
        documents: { select: DOCUMENT_SELECT, orderBy: { createdAt: "asc" } },
        professionalProfile: {
          select: { businessName: true, userId: true, user: { select: { name: true, email: true } } },
        },
      },
    });
    if (!row) return null;
    const { documents, professionalProfile, ...verification } = row;
    const record = toVerificationRecord(verification);
    return {
      ...record,
      businessName: professionalProfile.businessName,
      professionalName: professionalProfile.user.name,
      professionalEmail: professionalProfile.user.email,
      professionalUserId: professionalProfile.userId,
      documents: documents.map(toDocumentRecord),
    };
  }
}
