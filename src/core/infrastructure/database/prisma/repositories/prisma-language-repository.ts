import { prisma } from "@/infrastructure/database/prisma/client";
import type { LanguageRecord, LanguageRepository } from "@/domain/repositories/language-repository";

export class PrismaLanguageRepository implements LanguageRepository {
  async listActive(): Promise<LanguageRecord[]> {
    return prisma.language.findMany({
      where: { isActive: true },
      select: { id: true, name: true, nativeName: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
  }

  async findActiveByIds(ids: string[]): Promise<LanguageRecord[]> {
    if (ids.length === 0) return [];
    return prisma.language.findMany({
      where: { id: { in: ids }, isActive: true },
      select: { id: true, name: true, nativeName: true },
    });
  }
}
