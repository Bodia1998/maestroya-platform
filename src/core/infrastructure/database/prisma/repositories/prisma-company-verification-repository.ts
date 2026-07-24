import type { Prisma } from "@prisma/client";

import { prisma } from "@/infrastructure/database/prisma/client";
import type {
  AddCompanyVerificationDocumentData,
  AdminCompanyVerificationDetail,
  AdminCompanyVerificationListItem,
  CompanyVerificationDocumentRecord,
  CompanyVerificationRecord,
  CompanyVerificationRepository,
  CompanyVerificationWithDocuments,
  ListAdminCompanyVerificationsOptions,
  UpdateCompanyVerificationStatusData,
} from "@/domain/repositories/company-verification-repository";
import type { CompanyVerificationDocumentTypeValue, VerificationCaseStatusValue } from "@/domain/services/company-verification-rules";
import type { VerificationDocumentStatusValue } from "@/domain/services/professional-verification-rules";

/** Module 18 — Company Professional: Prisma implementation of
 *  CompanyVerificationRepository, backed by the new `company_verifications`
 *  / `company_verification_documents` tables — mirrors
 *  PrismaProfessionalVerificationRepository exactly. */

const VERIFICATION_SELECT = {
  id: true,
  companyProfileId: true,
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
  companyProfileId: string;
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

function toVerificationRecord(row: VerificationRow): CompanyVerificationRecord {
  return {
    id: row.id,
    companyProfileId: row.companyProfileId,
    status: row.status as VerificationCaseStatusValue,
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

function toDocumentRecord(row: DocumentRow): CompanyVerificationDocumentRecord {
  return {
    id: row.id,
    verificationId: row.verificationId,
    type: row.type as CompanyVerificationDocumentTypeValue,
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

export class PrismaCompanyVerificationRepository implements CompanyVerificationRepository {
  async create(companyProfileId: string): Promise<CompanyVerificationRecord> {
    const row = await prisma.companyVerification.create({
      data: { companyProfileId, status: "DRAFT" },
      select: VERIFICATION_SELECT,
    });
    return toVerificationRecord(row);
  }

  async findActiveByCompanyProfileId(companyProfileId: string): Promise<CompanyVerificationRecord | null> {
    const row = await prisma.companyVerification.findFirst({
      where: { companyProfileId, status: { not: "EXPIRED" } },
      orderBy: { createdAt: "desc" },
      select: VERIFICATION_SELECT,
    });
    return row ? toVerificationRecord(row) : null;
  }

  async findActiveWithDocumentsByCompanyProfileId(
    companyProfileId: string,
  ): Promise<CompanyVerificationWithDocuments | null> {
    const row = await prisma.companyVerification.findFirst({
      where: { companyProfileId, status: { not: "EXPIRED" } },
      orderBy: { createdAt: "desc" },
      select: { ...VERIFICATION_SELECT, documents: { select: DOCUMENT_SELECT, orderBy: { createdAt: "asc" } } },
    });
    if (!row) return null;
    const { documents, ...verification } = row;
    return { ...toVerificationRecord(verification), documents: documents.map(toDocumentRecord) };
  }

  async findById(id: string): Promise<CompanyVerificationRecord | null> {
    const row = await prisma.companyVerification.findUnique({ where: { id }, select: VERIFICATION_SELECT });
    return row ? toVerificationRecord(row) : null;
  }

  async updateStatus(id: string, data: UpdateCompanyVerificationStatusData): Promise<CompanyVerificationRecord> {
    const row = await prisma.companyVerification.update({
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

  async addDocument(data: AddCompanyVerificationDocumentData): Promise<CompanyVerificationDocumentRecord> {
    const row = await prisma.companyVerificationDocument.create({
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

  async findDocumentById(id: string): Promise<CompanyVerificationDocumentRecord | null> {
    const row = await prisma.companyVerificationDocument.findUnique({ where: { id }, select: DOCUMENT_SELECT });
    return row ? toDocumentRecord(row) : null;
  }

  async listDocuments(verificationId: string): Promise<CompanyVerificationDocumentRecord[]> {
    const rows = await prisma.companyVerificationDocument.findMany({
      where: { verificationId },
      orderBy: { createdAt: "asc" },
      select: DOCUMENT_SELECT,
    });
    return rows.map(toDocumentRecord);
  }

  async countDocuments(verificationId: string): Promise<number> {
    return prisma.companyVerificationDocument.count({ where: { verificationId } });
  }

  async removeDocument(id: string): Promise<void> {
    await prisma.companyVerificationDocument.delete({ where: { id } });
  }

  async setCompanyVerifiedStatus(companyProfileId: string, isVerified: boolean, verifiedAt: Date | null): Promise<void> {
    await prisma.companyProfile.update({ where: { id: companyProfileId }, data: { isVerified, verifiedAt } });
  }

  async listForAdmin(options: ListAdminCompanyVerificationsOptions): Promise<AdminCompanyVerificationListItem[]> {
    const where: Prisma.CompanyVerificationWhereInput = options.status ? { status: options.status } : {};
    const rows = await prisma.companyVerification.findMany({
      where,
      orderBy: [{ submittedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }, { id: "desc" }],
      take: options.limit,
      skip: options.offset,
      select: {
        ...VERIFICATION_SELECT,
        companyProfile: { select: { legalName: true, owner: { select: { name: true, email: true } } } },
      },
    });
    return rows.map((row) => {
      const { companyProfile, ...verification } = row;
      return {
        ...toVerificationRecord(verification),
        companyLegalName: companyProfile.legalName,
        ownerName: companyProfile.owner.name,
        ownerEmail: companyProfile.owner.email,
      } satisfies AdminCompanyVerificationListItem;
    });
  }

  async getDetailForAdmin(id: string): Promise<AdminCompanyVerificationDetail | null> {
    const row = await prisma.companyVerification.findUnique({
      where: { id },
      select: {
        ...VERIFICATION_SELECT,
        documents: { select: DOCUMENT_SELECT, orderBy: { createdAt: "asc" } },
        companyProfile: { select: { legalName: true, owner: { select: { name: true, email: true } } } },
      },
    });
    if (!row) return null;
    const { documents, companyProfile, ...verification } = row;
    return {
      ...toVerificationRecord(verification),
      companyLegalName: companyProfile.legalName,
      ownerName: companyProfile.owner.name,
      ownerEmail: companyProfile.owner.email,
      documents: documents.map(toDocumentRecord),
    };
  }
}
