import { prisma } from "@/infrastructure/database/prisma/client";
import type {
  ServiceCategoryRecord,
  ServiceCategoryRepository,
} from "@/domain/repositories/service-category-repository";

export class PrismaServiceCategoryRepository implements ServiceCategoryRepository {
  async listActive(): Promise<ServiceCategoryRecord[]> {
    return prisma.serviceCategory.findMany({
      where: { status: "ACTIVE", deletedAt: null },
      select: { id: true, name: true, slug: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
  }

  async findActiveByIds(ids: string[]): Promise<ServiceCategoryRecord[]> {
    if (ids.length === 0) return [];
    return prisma.serviceCategory.findMany({
      where: { id: { in: ids }, status: "ACTIVE", deletedAt: null },
      select: { id: true, name: true, slug: true },
    });
  }
}
