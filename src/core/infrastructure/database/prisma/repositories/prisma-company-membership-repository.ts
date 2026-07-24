import { prisma } from "@/infrastructure/database/prisma/client";
import type {
  CompanyMemberRecord,
  CompanyMembershipRepository,
  CompanyMemberWithUser,
} from "@/domain/repositories/company-membership-repository";
import type { CompanyMemberRoleValue } from "@/domain/services/company-membership-rules";

const SELECT = {
  id: true,
  companyProfileId: true,
  userId: true,
  role: true,
  invitedAt: true,
  joinedAt: true,
  removedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

type Row = {
  id: string;
  companyProfileId: string;
  userId: string;
  role: string;
  invitedAt: Date;
  joinedAt: Date | null;
  removedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function toRecord(row: Row): CompanyMemberRecord {
  return {
    id: row.id,
    companyId: row.companyProfileId,
    userId: row.userId,
    role: row.role as CompanyMemberRoleValue,
    invitedAt: row.invitedAt,
    joinedAt: row.joinedAt,
    removedAt: row.removedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Module 18 — Company Professional: Prisma implementation of
 *  CompanyMembershipRepository, backed by the existing `company_members`
 *  table (Phase 1). */
export class PrismaCompanyMembershipRepository implements CompanyMembershipRepository {
  async findById(id: string): Promise<CompanyMemberRecord | null> {
    const row = await prisma.companyMember.findUnique({ where: { id }, select: SELECT });
    return row ? toRecord(row) : null;
  }

  async findByCompanyAndUser(companyId: string, userId: string): Promise<CompanyMemberRecord | null> {
    const row = await prisma.companyMember.findUnique({
      where: { companyProfileId_userId: { companyProfileId: companyId, userId } },
      select: SELECT,
    });
    return row ? toRecord(row) : null;
  }

  async listActiveCompaniesForUser(userId: string): Promise<CompanyMemberRecord[]> {
    const rows = await prisma.companyMember.findMany({
      where: { userId, joinedAt: { not: null }, removedAt: null },
      select: SELECT,
      orderBy: { createdAt: "asc" },
    });
    return rows.map(toRecord);
  }

  async listByCompany(companyId: string): Promise<CompanyMemberWithUser[]> {
    const rows = await prisma.companyMember.findMany({
      where: { companyProfileId: companyId },
      select: { ...SELECT, user: { select: { name: true, email: true } } },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    });
    return rows.map(({ user, ...row }) => ({ ...toRecord(row), userName: user.name, userEmail: user.email }));
  }

  async findOwner(companyId: string): Promise<CompanyMemberRecord | null> {
    const row = await prisma.companyMember.findFirst({
      where: { companyProfileId: companyId, role: "OWNER", removedAt: null },
      select: SELECT,
    });
    return row ? toRecord(row) : null;
  }

  async countActiveMembers(companyId: string): Promise<number> {
    return prisma.companyMember.count({
      where: { companyProfileId: companyId, joinedAt: { not: null }, removedAt: null },
    });
  }

  async createOwner(companyId: string, userId: string): Promise<CompanyMemberRecord> {
    const now = new Date();
    const row = await prisma.companyMember.create({
      data: { companyProfileId: companyId, userId, role: "OWNER", invitedAt: now, joinedAt: now },
      select: SELECT,
    });
    return toRecord(row);
  }

  async createFromAcceptedInvitation(
    companyId: string,
    userId: string,
    role: CompanyMemberRoleValue,
  ): Promise<CompanyMemberRecord> {
    const now = new Date();
    const row = await prisma.companyMember.create({
      data: { companyProfileId: companyId, userId, role, invitedAt: now, joinedAt: now },
      select: SELECT,
    });
    return toRecord(row);
  }

  async updateRole(id: string, role: CompanyMemberRoleValue): Promise<CompanyMemberRecord> {
    const row = await prisma.companyMember.update({ where: { id }, data: { role }, select: SELECT });
    return toRecord(row);
  }

  async remove(id: string, removedAt: Date): Promise<void> {
    await prisma.companyMember.update({ where: { id }, data: { removedAt } });
  }

  async transferOwnership(companyId: string, fromMemberId: string, toMemberId: string): Promise<void> {
    await prisma.$transaction([
      prisma.companyMember.update({ where: { id: fromMemberId }, data: { role: "ADMIN" } }),
      prisma.companyMember.update({ where: { id: toMemberId }, data: { role: "OWNER" } }),
    ]);
  }
}
