import { prisma } from "@/infrastructure/database/prisma/client";
import type {
  CreatePortfolioItemData,
  ListPortfolioItemsOptions,
  PortfolioItemRecord,
  PortfolioRepository,
  UpdatePortfolioItemData,
} from "@/domain/repositories/portfolio-repository";

const DETAIL_SELECT = {
  id: true,
  professionalProfileId: true,
  companyProfileId: true,
  serviceCategoryId: true,
  title: true,
  description: true,
  mediaUrl: true,
  createdAt: true,
  updatedAt: true,
} as const;

type PrismaPortfolioItemRow = {
  id: string;
  professionalProfileId: string | null;
  companyProfileId: string | null;
  serviceCategoryId: string | null;
  title: string;
  description: string | null;
  mediaUrl: string;
  createdAt: Date;
  updatedAt: Date;
};

function toRecord(row: PrismaPortfolioItemRow): PortfolioItemRecord {
  return {
    id: row.id,
    professionalProfileId: row.professionalProfileId,
    companyProfileId: row.companyProfileId,
    serviceCategoryId: row.serviceCategoryId,
    title: row.title,
    description: row.description,
    mediaUrl: row.mediaUrl,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Portfolio module (Module 14, extended by Module 18): Prisma implementation
 * of PortfolioRepository. Follows the same shape as PrismaReviewRepository —
 * narrow SELECTs, plain-object mapping, no Prisma types leaking past this
 * file. Every read filters `deletedAt: null`, same convention as
 * PrismaAddressRepository/PrismaServiceRequestRepository.
 */
export class PrismaPortfolioRepository implements PortfolioRepository {
  async findById(id: string): Promise<PortfolioItemRecord | null> {
    const row = await prisma.portfolioItem.findFirst({
      where: { id, deletedAt: null },
      select: DETAIL_SELECT,
    });
    return row ? toRecord(row) : null;
  }

  async listByProfessionalId(
    professionalProfileId: string,
    options: ListPortfolioItemsOptions,
  ): Promise<PortfolioItemRecord[]> {
    // Admin Panel module (Module 16): also excludes admin-moderated items
    // (`moderatedAt` set) — this method serves both the public
    // professional-profile listing and the owner's own dashboard listing
    // (see this class's own doc comment), so a moderated item disappears
    // from both until an admin restores it. `moderatedAt` is otherwise
    // never null-checked anywhere else in Module 14's own code — this is
    // the one integration point Module 16 adds here.
    const rows = await prisma.portfolioItem.findMany({
      where: { professionalProfileId, deletedAt: null, moderatedAt: null },
      select: DETAIL_SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: options.limit,
      skip: options.offset,
    });
    return rows.map(toRecord);
  }

  /** Module 18 — Company Professional: same contract, scoped to a
   *  CompanyProfile's own portfolio instead. */
  async listByCompanyId(companyId: string, options: ListPortfolioItemsOptions): Promise<PortfolioItemRecord[]> {
    const rows = await prisma.portfolioItem.findMany({
      where: { companyProfileId: companyId, deletedAt: null, moderatedAt: null },
      select: DETAIL_SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: options.limit,
      skip: options.offset,
    });
    return rows.map(toRecord);
  }

  async create(data: CreatePortfolioItemData): Promise<PortfolioItemRecord> {
    const row = await prisma.portfolioItem.create({
      data: {
        professionalProfileId: data.professionalProfileId ?? null,
        companyProfileId: data.companyProfileId ?? null,
        serviceCategoryId: data.serviceCategoryId,
        title: data.title,
        description: data.description,
        mediaUrl: data.mediaUrl,
      },
      select: DETAIL_SELECT,
    });
    return toRecord(row);
  }

  async update(id: string, data: UpdatePortfolioItemData): Promise<PortfolioItemRecord> {
    const row = await prisma.portfolioItem.update({
      where: { id },
      data: {
        serviceCategoryId: data.serviceCategoryId,
        title: data.title,
        description: data.description,
        mediaUrl: data.mediaUrl,
      },
      select: DETAIL_SELECT,
    });
    return toRecord(row);
  }

  async softDelete(id: string): Promise<void> {
    await prisma.portfolioItem.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
