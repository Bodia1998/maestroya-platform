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
  serviceCategoryId: true,
  title: true,
  description: true,
  mediaUrl: true,
  createdAt: true,
  updatedAt: true,
} as const;

type PrismaPortfolioItemRow = {
  id: string;
  professionalProfileId: string;
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
    serviceCategoryId: row.serviceCategoryId,
    title: row.title,
    description: row.description,
    mediaUrl: row.mediaUrl,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Portfolio module (Module 14): Prisma implementation of
 * PortfolioRepository. Follows the same shape as PrismaReviewRepository —
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
    const rows = await prisma.portfolioItem.findMany({
      where: { professionalProfileId, deletedAt: null },
      select: DETAIL_SELECT,
      orderBy: [{ createdAt: "desc" }],
      take: options.limit,
      skip: options.offset,
    });
    return rows.map(toRecord);
  }

  async create(data: CreatePortfolioItemData): Promise<PortfolioItemRecord> {
    const row = await prisma.portfolioItem.create({
      data: {
        professionalProfileId: data.professionalProfileId,
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
