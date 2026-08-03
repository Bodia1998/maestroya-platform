import type { CustomerProfileRecord, CustomerProfileRepository } from "@/domain/repositories/customer-profile-repository";
import type { CityGeocodeQuery, GeocodingProvider } from "@/domain/repositories/geocoding-provider";
import type {
  CreateServiceRequestData,
  RequestPhotoRecord,
  ServiceRequestRecord,
  ServiceRequestRepository,
  ServiceRequestStatusValue,
  UpdateServiceRequestFields,
} from "@/domain/repositories/service-request-repository";
import type { ServiceCategoryRecord, ServiceCategoryRepository } from "@/domain/repositories/service-category-repository";
import type { RequestPhotoUploadService } from "@/application/interfaces/request-photo-upload-service";

/**
 * In-memory test doubles for the Service Request Module integration tests,
 * following the same pattern as tests/integration/professional/fakes.ts:
 * implement the real interfaces so the use cases under test run their
 * genuine orchestration/authorization logic, with only storage swapped out.
 */

let idCounter = 0;
function nextId(prefix: string) {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

export class FakeCustomerProfileRepository implements CustomerProfileRepository {
  profiles = new Map<string, CustomerProfileRecord>();

  async findByUserId(userId: string) {
    return [...this.profiles.values()].find((p) => p.userId === userId) ?? null;
  }

  async findById(id: string) {
    return this.profiles.get(id) ?? null;
  }

  async findOrCreateByUserId(userId: string) {
    const existing = await this.findByUserId(userId);
    if (existing) return existing;
    const record: CustomerProfileRecord = { id: nextId("fake-customer"), userId };
    this.profiles.set(record.id, record);
    return record;
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

export class FakeServiceRequestRepository implements ServiceRequestRepository {
  requests = new Map<string, ServiceRequestRecord>();
  private photoIdCounter = 0;

  constructor(private readonly categories: FakeServiceCategoryRepository) {}

  async findById(id: string) {
    return this.requests.get(id) ?? null;
  }

  async findManyByCustomerId(customerId: string) {
    return [...this.requests.values()]
      .filter((r) => r.customerId === customerId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async create(customerId: string, _userId: string, data: CreateServiceRequestData): Promise<ServiceRequestRecord> {
    const category = this.categories.categories.get(data.categoryId);
    const now = new Date();
    const record: ServiceRequestRecord = {
      id: nextId("fake-request"),
      customerId,
      categoryId: data.categoryId,
      categoryName: category?.name ?? "Unknown",
      title: data.title,
      description: data.description,
      status: "PUBLISHED",
      urgency: data.urgency,
      budgetMin: data.budgetMin,
      budgetMax: data.budgetMax,
      location: { ...data.location },
      photos: [],
      createdAt: now,
      updatedAt: now,
    };
    this.requests.set(record.id, record);
    return record;
  }

  async update(id: string, data: UpdateServiceRequestFields): Promise<ServiceRequestRecord> {
    const existing = this.requests.get(id);
    if (!existing) throw new Error(`No fake service request with id ${id}`);
    const category = data.categoryId ? this.categories.categories.get(data.categoryId) : undefined;
    const updated: ServiceRequestRecord = {
      ...existing,
      ...(data.categoryId !== undefined
        ? { categoryId: data.categoryId, categoryName: category?.name ?? existing.categoryName }
        : {}),
      ...(data.title !== undefined ? { title: data.title } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
      ...(data.urgency !== undefined ? { urgency: data.urgency } : {}),
      ...(data.budgetMin !== undefined ? { budgetMin: data.budgetMin } : {}),
      ...(data.budgetMax !== undefined ? { budgetMax: data.budgetMax } : {}),
      ...(data.location !== undefined ? { location: { ...data.location } } : {}),
      updatedAt: new Date(),
    };
    this.requests.set(id, updated);
    return updated;
  }

  async updateStatus(id: string, status: ServiceRequestStatusValue): Promise<void> {
    const existing = this.requests.get(id);
    if (existing) {
      this.requests.set(id, { ...existing, status, updatedAt: new Date() });
    }
  }

  async addPhoto(serviceRequestId: string, url: string, caption: string | null): Promise<RequestPhotoRecord> {
    const existing = this.requests.get(serviceRequestId);
    if (!existing) throw new Error(`No fake service request with id ${serviceRequestId}`);
    this.photoIdCounter += 1;
    const photo: RequestPhotoRecord = {
      id: `fake-photo-${this.photoIdCounter}`,
      url,
      caption,
      sortOrder: existing.photos.length,
    };
    const updated = { ...existing, photos: [...existing.photos, photo], updatedAt: new Date() };
    this.requests.set(serviceRequestId, updated);
    return photo;
  }

  async removePhoto(serviceRequestId: string, photoId: string): Promise<void> {
    const existing = this.requests.get(serviceRequestId);
    if (!existing) return;
    const updated = {
      ...existing,
      photos: existing.photos.filter((p) => p.id !== photoId),
      updatedAt: new Date(),
    };
    this.requests.set(serviceRequestId, updated);
  }

  async countPhotos(serviceRequestId: string): Promise<number> {
    return this.requests.get(serviceRequestId)?.photos.length ?? 0;
  }

  async findExpirable(now: Date): Promise<ServiceRequestRecord[]> {
    return [...this.requests.values()].filter(
      (r) =>
        (r.status === "PUBLISHED" || r.status === "QUOTED") &&
        r.expiresAt != null &&
        r.expiresAt.getTime() <= now.getTime(),
    );
  }
}

// Mirrors tests/integration/professional/onboarding-flows.test.ts's own
// FakeGeocodingProvider exactly (same "point" field, same call-tracking
// convention) — kept here as a shared fake rather than duplicated again,
// since this module's use cases now depend on the same GeocodingProvider
// seam. Defaults to Gandia's real centroid so `VALID_LOCATION` below (city:
// "Gandia") resolves the same coordinate the real StaticCityGeocodingProvider
// would return, without these tests depending on that lookup table's
// contents.
export class FakeGeocodingProvider implements GeocodingProvider {
  calls: CityGeocodeQuery[] = [];
  point: { latitude: number; longitude: number } | null = { latitude: 38.9665, longitude: -0.1817 };

  async geocode(query: CityGeocodeQuery) {
    this.calls.push(query);
    return this.point;
  }
}

export class FakeRequestPhotoUploadService implements RequestPhotoUploadService {
  uploads: Array<{ serviceRequestId: string; contentType: string; size: number }> = [];

  async uploadRequestPhoto(serviceRequestId: string, fileBuffer: Buffer, contentType: string): Promise<string> {
    this.uploads.push({ serviceRequestId, contentType, size: fileBuffer.byteLength });
    return `https://res.cloudinary.com/fake/service-requests/${serviceRequestId}/${this.uploads.length}.jpg`;
  }
}

// Shape matches CreateServiceRequestInput["location"] (post-zod-parse), not
// the repository's ServiceRequestLocation (which uses `null` for absent
// optional fields) — these tests call the use cases directly with
// already-"parsed"-shaped input, bypassing the zod schema itself (that's
// covered separately in tests/unit/core/application/dto/service-request.dto.test.ts).
export const VALID_LOCATION = {
  line1: "Calle Mayor 1",
  city: "Gandia",
  postalCode: "46700",
  country: "ES",
};
