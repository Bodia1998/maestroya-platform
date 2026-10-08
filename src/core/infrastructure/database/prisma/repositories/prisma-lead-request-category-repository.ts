import { prisma } from "@/infrastructure/database/prisma/client";
import type {
  LeadRequestCategoryRecord,
  LeadRequestCategoryRepository,
} from "@/domain/repositories/lead-request-category-repository";

const select = { id: true, name: true, slug: true, parent: { select: { slug: true } } } as const;

function toRecord(row: { id: string; name: string; slug: string; parent: { slug: string } | null }): LeadRequestCategoryRecord {
  return { id: row.id, name: row.name, slug: row.slug, parentSlug: row.parent?.slug ?? null };
}

export class PrismaLeadRequestCategoryRepository implements LeadRequestCategoryRepository {
  async listActive(): Promise<LeadRequestCategoryRecord[]> {
    const rows = await prisma.serviceCategory.findMany({
      where: { status: "ACTIVE", deletedAt: null },
      select,
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    return rows.map(toRecord);
  }

  async findActiveById(id: string): Promise<LeadRequestCategoryRecord | null> {
    const row = await prisma.serviceCategory.findFirst({ where: { id, status: "ACTIVE", deletedAt: null }, select });
    return row ? toRecord(row) : null;
  }
}
