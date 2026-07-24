import type {
  CreateProfessionalData,
  ProfessionalRecord,
  ProfessionalRepository,
  ProfessionalStatusValue,
  UpdateProfessionalData,
} from "@/domain/repositories/professional-repository";
import type {
  CreatePortfolioItemData,
  ListPortfolioItemsOptions,
  PortfolioItemRecord,
  PortfolioRepository,
  UpdatePortfolioItemData,
} from "@/domain/repositories/portfolio-repository";
import type { ServiceCategoryRecord, ServiceCategoryRepository } from "@/domain/repositories/service-category-repository";

/**
 * In-memory test doubles for the Portfolio module (Module 14) integration
 * tests, following the same pattern as tests/integration/review/fakes.ts
 * and tests/integration/quotes/fakes.ts: implement the real interfaces so
 * the use cases under test run their genuine orchestration/authorization
 * logic, with only storage swapped out.
 */

let idCounter = 0;
function nextId(prefix: string) {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

export class FakeProfessionalRepository implements ProfessionalRepository {
  profiles = new Map<string, ProfessionalRecord>();

  seed(overrides: Partial<ProfessionalRecord> & { userId: string }): ProfessionalRecord {
    const now = new Date();
    const record: ProfessionalRecord = {
      id: nextId("fake-professional"),
      businessName: null,
      bio: null,
      headline: null,
      yearsExperience: null,
      hourlyRate: null,
      serviceRadiusKm: null,
      contactEmail: null,
      contactPhone: null,
      websiteUrl: null,
      taxId: null,
      status: "ACTIVE",
      verificationStatus: "UNVERIFIED",
      verifiedAt: null,
      isAcceptingRequests: true,
      categoryIds: [],
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
    this.profiles.set(record.id, record);
    return record;
  }

  async findById(id: string) {
    return this.profiles.get(id) ?? null;
  }

  async findByUserId(userId: string) {
    return [...this.profiles.values()].find((p) => p.userId === userId) ?? null;
  }

  async create(userId: string, data: CreateProfessionalData): Promise<ProfessionalRecord> {
    return this.seed({ userId, ...data });
  }

  async update(id: string, data: UpdateProfessionalData): Promise<ProfessionalRecord> {
    const existing = this.profiles.get(id);
    if (!existing) throw new Error(`No fake professional profile with id ${id}`);
    const updated = { ...existing, ...data, updatedAt: new Date() };
    this.profiles.set(id, updated);
    return updated;
  }

  async updateStatus(id: string, status: ProfessionalStatusValue): Promise<void> {
    const existing = this.profiles.get(id);
    if (existing) this.profiles.set(id, { ...existing, status, updatedAt: new Date() });
  }

  async updateCategories(id: string, categoryIds: string[]): Promise<ProfessionalRecord> {
    const existing = this.profiles.get(id);
    if (!existing) throw new Error(`No fake professional profile with id ${id}`);
    const updated = { ...existing, categoryIds: [...categoryIds], updatedAt: new Date() };
    this.profiles.set(id, updated);
    return updated;
  }
}

export class FakeServiceCategoryRepository implements ServiceCategoryRepository {
  categories = new Map<string, ServiceCategoryRecord>();

  seed(category: ServiceCategoryRecord) {
    this.categories.set(category.id, category);
    return category;
  }

  async listActive() {
    return [...this.categories.values()];
  }

  async findActiveByIds(ids: string[]) {
    const unique = new Set(ids);
    return [...this.categories.values()].filter((c) => unique.has(c.id));
  }
}

/**
 * Mirrors PrismaPortfolioRepository's two safety properties so tests
 * exercise real behavior, not a stub that always succeeds:
 *   1. Soft-deleted rows (`deletedAt` set) are excluded from every read
 *      (`findById`, `listByProfessionalId`) — same "a deleted row behaves
 *      like it never existed" contract as the real repository.
 *   2. `listByProfessionalId` is scoped to exactly one professionalProfileId
 *      and sorted newest-first, same as the real SQL query.
 */
export class FakePortfolioRepository implements PortfolioRepository {
  private items = new Map<string, PortfolioItemRecord & { deletedAt: Date | null }>();

  async findById(id: string): Promise<PortfolioItemRecord | null> {
    const row = this.items.get(id);
    if (!row || row.deletedAt) return null;
    const { deletedAt: _deletedAt, ...record } = row;
    return record;
  }

  async listByProfessionalId(
    professionalProfileId: string,
    options: ListPortfolioItemsOptions,
  ): Promise<PortfolioItemRecord[]> {
    return [...this.items.values()]
      .filter((r) => r.professionalProfileId === professionalProfileId && !r.deletedAt)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(options.offset, options.offset + options.limit)
      .map(({ deletedAt: _deletedAt, ...record }) => record);
  }

  /** Module 18 — Company Professional: same contract, scoped to a company. */
  async listByCompanyId(companyId: string, options: ListPortfolioItemsOptions): Promise<PortfolioItemRecord[]> {
    return [...this.items.values()]
      .filter((r) => r.companyProfileId === companyId && !r.deletedAt)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(options.offset, options.offset + options.limit)
      .map(({ deletedAt: _deletedAt, ...record }) => record);
  }

  async create(data: CreatePortfolioItemData): Promise<PortfolioItemRecord> {
    const now = new Date();
    const record: PortfolioItemRecord & { deletedAt: Date | null } = {
      id: nextId("fake-portfolio-item"),
      professionalProfileId: data.professionalProfileId ?? null,
      companyProfileId: data.companyProfileId ?? null,
      serviceCategoryId: data.serviceCategoryId,
      title: data.title,
      description: data.description,
      mediaUrl: data.mediaUrl,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    this.items.set(record.id, record);
    const { deletedAt: _deletedAt, ...toReturn } = record;
    return toReturn;
  }

  async update(id: string, data: UpdatePortfolioItemData): Promise<PortfolioItemRecord> {
    const existing = this.items.get(id);
    if (!existing) throw new Error(`No fake portfolio item with id ${id}`);
    const updated = { ...existing, ...data, updatedAt: new Date() };
    this.items.set(id, updated);
    const { deletedAt: _deletedAt, ...toReturn } = updated;
    return toReturn;
  }

  async softDelete(id: string): Promise<void> {
    const existing = this.items.get(id);
    if (existing) this.items.set(id, { ...existing, deletedAt: new Date(), updatedAt: new Date() });
  }
}
