import { prisma } from "@/infrastructure/database/prisma/client";
import type {
  CompanyInvitationRecord,
  CompanyInvitationRepository,
  CreateCompanyInvitationData,
} from "@/domain/repositories/company-invitation-repository";
import type { CompanyInvitationStatusValue } from "@/domain/services/company-invitation-rules";
import type { CompanyMemberRoleValue } from "@/domain/services/company-membership-rules";

const SELECT = {
  id: true,
  companyId: true,
  email: true,
  invitedUserId: true,
  invitedByUserId: true,
  role: true,
  status: true,
  tokenHash: true,
  expiresAt: true,
  acceptedAt: true,
  declinedAt: true,
  cancelledAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

type Row = {
  id: string;
  companyId: string;
  email: string;
  invitedUserId: string | null;
  invitedByUserId: string;
  role: string;
  status: string;
  tokenHash: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  declinedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function toRecord(row: Row): CompanyInvitationRecord {
  return {
    id: row.id,
    companyId: row.companyId,
    email: row.email,
    invitedUserId: row.invitedUserId,
    invitedByUserId: row.invitedByUserId,
    role: row.role as CompanyMemberRoleValue,
    status: row.status as CompanyInvitationStatusValue,
    tokenHash: row.tokenHash,
    expiresAt: row.expiresAt,
    acceptedAt: row.acceptedAt,
    declinedAt: row.declinedAt,
    cancelledAt: row.cancelledAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Module 18 — Company Professional: Prisma implementation of
 *  CompanyInvitationRepository, backed by the new `company_invitations`
 *  table. */
export class PrismaCompanyInvitationRepository implements CompanyInvitationRepository {
  async findById(id: string): Promise<CompanyInvitationRecord | null> {
    const row = await prisma.companyInvitation.findUnique({ where: { id }, select: SELECT });
    return row ? toRecord(row) : null;
  }

  async findByTokenHash(tokenHash: string): Promise<CompanyInvitationRecord | null> {
    const row = await prisma.companyInvitation.findUnique({ where: { tokenHash }, select: SELECT });
    return row ? toRecord(row) : null;
  }

  async findPendingByCompanyAndEmail(companyId: string, email: string): Promise<CompanyInvitationRecord | null> {
    const row = await prisma.companyInvitation.findFirst({
      where: { companyId, email, status: "PENDING" },
      select: SELECT,
    });
    return row ? toRecord(row) : null;
  }

  async listByCompany(companyId: string): Promise<CompanyInvitationRecord[]> {
    const rows = await prisma.companyInvitation.findMany({
      where: { companyId },
      orderBy: { createdAt: "desc" },
      select: SELECT,
    });
    return rows.map(toRecord);
  }

  async listForInvitedUser(userId: string): Promise<CompanyInvitationRecord[]> {
    const rows = await prisma.companyInvitation.findMany({
      where: { invitedUserId: userId },
      orderBy: { createdAt: "desc" },
      select: SELECT,
    });
    return rows.map(toRecord);
  }

  async create(data: CreateCompanyInvitationData): Promise<CompanyInvitationRecord> {
    const row = await prisma.companyInvitation.create({
      data: {
        companyId: data.companyId,
        email: data.email,
        invitedUserId: data.invitedUserId,
        invitedByUserId: data.invitedByUserId,
        role: data.role,
        tokenHash: data.tokenHash,
        expiresAt: data.expiresAt,
      },
      select: SELECT,
    });
    return toRecord(row);
  }

  async updateStatus(
    id: string,
    data: {
      status: CompanyInvitationStatusValue;
      acceptedAt?: Date | null;
      declinedAt?: Date | null;
      cancelledAt?: Date | null;
    },
  ): Promise<CompanyInvitationRecord> {
    const row = await prisma.companyInvitation.update({
      where: { id },
      data: {
        status: data.status,
        ...(data.acceptedAt !== undefined ? { acceptedAt: data.acceptedAt } : {}),
        ...(data.declinedAt !== undefined ? { declinedAt: data.declinedAt } : {}),
        ...(data.cancelledAt !== undefined ? { cancelledAt: data.cancelledAt } : {}),
      },
      select: SELECT,
    });
    return toRecord(row);
  }
}
