import type {
  CreateProfessionalData,
  ProfessionalRecord,
  ProfessionalRepository,
  ProfessionalStatusValue,
  UpdateProfessionalData,
} from "@/domain/repositories/professional-repository";
import type {
  ServiceCategoryRecord,
  ServiceCategoryRepository,
} from "@/domain/repositories/service-category-repository";

/**
 * In-memory test doubles for the Professional Module integration tests,
 * following the same pattern as tests/integration/profile/fakes.ts and
 * tests/integration/auth/fakes.ts: implement the real interfaces so the
 * use cases under test run their genuine orchestration/authorization
 * logic, with only the storage swapped out.
 */

let idCounter = 0;
function nextId(prefix: string) {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

export class FakeProfessionalRepository implements ProfessionalRepository {
  profiles = new Map<string, ProfessionalRecord>();

  async findById(id: string) {
    return this.profiles.get(id) ?? null;
  }

  async findByUserId(userId: string) {
    return [...this.profiles.values()].find((p) => p.userId === userId) ?? null;
  }

  async create(userId: string, data: CreateProfessionalData): Promise<ProfessionalRecord> {
    const now = new Date();
    const record: ProfessionalRecord = {
      id: nextId("fake-professional"),
      userId,
      businessName: data.businessName ?? null,
      bio: data.bio ?? null,
      headline: data.headline ?? null,
      yearsExperience: data.yearsExperience ?? null,
      hourlyRate: data.hourlyRate ?? null,
      serviceRadiusKm: data.serviceRadiusKm ?? null,
      contactEmail: data.contactEmail ?? null,
      contactPhone: data.contactPhone ?? null,
      websiteUrl: data.websiteUrl ?? null,
      taxId: data.taxId ?? null,
      status: "ACTIVE",
      verificationStatus: "UNVERIFIED",
      verifiedAt: null,
      isAcceptingRequests: true,
      categoryIds: [...(data.categoryIds ?? [])],
      createdAt: now,
      updatedAt: now,
    };
    this.profiles.set(record.id, record);
    return record;
  }

  async update(id: string, data: UpdateProfessionalData): Promise<ProfessionalRecord> {
    const existing = this.profiles.get(id);
    if (!existing) throw new Error(`No fake professional profile with id ${id}`);
    const updated: ProfessionalRecord = {
      ...existing,
      ...(data.businessName !== undefined ? { businessName: data.businessName } : {}),
      ...(data.bio !== undefined ? { bio: data.bio } : {}),
      ...(data.headline !== undefined ? { headline: data.headline } : {}),
      ...(data.yearsExperience !== undefined ? { yearsExperience: data.yearsExperience } : {}),
      ...(data.hourlyRate !== undefined ? { hourlyRate: data.hourlyRate } : {}),
      ...(data.serviceRadiusKm !== undefined ? { serviceRadiusKm: data.serviceRadiusKm } : {}),
      ...(data.contactEmail !== undefined ? { contactEmail: data.contactEmail } : {}),
      ...(data.contactPhone !== undefined ? { contactPhone: data.contactPhone } : {}),
      ...(data.websiteUrl !== undefined ? { websiteUrl: data.websiteUrl } : {}),
      ...(data.taxId !== undefined ? { taxId: data.taxId } : {}),
      ...(data.isAcceptingRequests !== undefined
        ? { isAcceptingRequests: data.isAcceptingRequests }
        : {}),
      updatedAt: new Date(),
    };
    this.profiles.set(id, updated);
    return updated;
  }

  async updateStatus(id: string, status: ProfessionalStatusValue): Promise<void> {
    const existing = this.profiles.get(id);
    if (existing) {
      this.profiles.set(id, { ...existing, status, updatedAt: new Date() });
    }
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
