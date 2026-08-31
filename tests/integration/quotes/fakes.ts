import type { CustomerProfileRecord, CustomerProfileRepository } from "@/domain/repositories/customer-profile-repository";
import type {
  CreateProfessionalData,
  ProfessionalRecord,
  ProfessionalRepository,
  ProfessionalStatusValue,
  UpdateProfessionalData,
} from "@/domain/repositories/professional-repository";
import type {
  ProfessionalDiscoveryCandidate,
  ProfessionalDiscoveryRepository,
  ProfessionalPublicProfileRecord,
  ProfessionalSearchFilter,
} from "@/domain/repositories/professional-discovery-repository";
import type {
  CreateQuoteData,
  QuoteItemRecord,
  QuoteMaterialRecord,
  QuoteRecord,
  QuoteRepository,
  QuoteStatusValue,
  UpdateQuoteFields,
} from "@/domain/repositories/quote-repository";
import type {
  ServiceRequestDiscoveryCandidate,
  ServiceRequestDiscoveryRepository,
} from "@/domain/repositories/service-request-discovery-repository";
import type {
  CreateServiceRequestData,
  RequestPhotoRecord,
  ServiceRequestRecord,
  ServiceRequestRepository,
  ServiceRequestStatusValue,
  UpdateServiceRequestFields,
} from "@/domain/repositories/service-request-repository";
import { OPEN_QUOTE_STATUSES } from "@/domain/services/quote-state";
import { DEFAULT_MATERIALS_STRATEGY } from "@/domain/value-objects/materials-strategy";
import type {
  AcceptQuoteJobRecord,
  AcceptQuoteResult,
  AppointmentRecord,
  QuoteAcceptanceRepository,
} from "@/domain/repositories/quote-acceptance-repository";
import type {
  TrustAutomatedActionRecord,
  TrustAutomatedActionRepository,
  TrustAutomatedActionTypeValue,
} from "@/domain/repositories/trust-automated-action-repository";
import { ConflictError } from "@/domain/errors/domain-error";
import { isAcceptableQuoteStatus } from "@/domain/services/quote-state";
import { isAcceptableStatus } from "@/domain/services/service-request-state";

/**
 * In-memory test doubles for the Offers/Quotes module integration tests,
 * following the same pattern as tests/integration/service-request/fakes.ts
 * and tests/integration/discovery/fakes.ts: implement the real interfaces so
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

/**
 * Independent from FakeProfessionalRepository, exactly like production:
 * ProfessionalDiscoveryRepository and ProfessionalRepository are two
 * distinct repositories reading the same underlying ProfessionalProfile/
 * Address rows through different queries — tests seed both with a matching
 * professional `id`, the same way PrismaProfessionalDiscoveryRepository and
 * PrismaProfessionalRepository both read ProfessionalProfile independently.
 */
export interface FakeDiscoveryCandidateSeed extends ProfessionalDiscoveryCandidate {
  status: ProfessionalStatusValue;
}

export class FakeProfessionalDiscoveryRepository implements ProfessionalDiscoveryRepository {
  candidates = new Map<string, FakeDiscoveryCandidateSeed>();

  seed(candidate: FakeDiscoveryCandidateSeed) {
    this.candidates.set(candidate.id, candidate);
    return candidate;
  }

  async findActiveCandidatesByCategory(categoryId: string): Promise<ProfessionalDiscoveryCandidate[]> {
    // Module 83 — Professional Verification Enforcement: mirrors
    // PrismaProfessionalDiscoveryRepository's ACTIVE-and-VERIFIED where
    // clause exactly.
    return [...this.candidates.values()]
      .filter((c) => c.status === "ACTIVE" && c.verificationStatus === "VERIFIED" && c.categoryIds.includes(categoryId))
      .map(({ status: _status, ...candidate }) => candidate);
  }

  async findCandidateById(professionalId: string): Promise<ProfessionalDiscoveryCandidate | null> {
    const candidate = this.candidates.get(professionalId);
    if (!candidate || candidate.status !== "ACTIVE" || candidate.verificationStatus !== "VERIFIED") return null;
    const { status: _status, ...rest } = candidate;
    return rest;
  }

  async findPublicProfileById(professionalId: string): Promise<ProfessionalPublicProfileRecord | null> {
    const c = this.candidates.get(professionalId);
    if (!c || c.status !== "ACTIVE") return null;
    return {
      id: c.id,
      displayName: c.displayName,
      businessName: c.businessName,
      headline: c.headline,
      bio: null,
      yearsExperience: c.yearsExperience,
      hourlyRate: c.hourlyRate,
      serviceRadiusKm: c.serviceRadiusKm,
      verificationStatus: c.verificationStatus,
      profileImageUrl: c.profileImageUrl,
      categoryIds: c.categoryIds,
      city: null,
      province: null,
    };
  }

  async searchCandidates(_filter: ProfessionalSearchFilter): Promise<ProfessionalDiscoveryCandidate[]> {
    // Not exercised by the Offers/Quotes tests — Module 19's search is a
    // distinct read path from CreateQuoteUseCase's own use of this fake.
    throw new Error("not used in quotes tests");
  }
}

export class FakeServiceRequestDiscoveryRepository implements ServiceRequestDiscoveryRepository {
  requests = new Map<string, ServiceRequestDiscoveryCandidate & { status: ServiceRequestStatusValue }>();

  seed(
    candidate: ServiceRequestDiscoveryCandidate,
    status: ServiceRequestStatusValue = "PUBLISHED",
  ): ServiceRequestDiscoveryCandidate {
    this.requests.set(candidate.id, { ...candidate, status });
    return candidate;
  }

  async findPublishedById(id: string): Promise<ServiceRequestDiscoveryCandidate | null> {
    const row = this.requests.get(id);
    if (!row || row.status !== "PUBLISHED") return null;
    const { status: _status, ...candidate } = row;
    return candidate;
  }

  async findPublishedByCategoryIds(categoryIds: string[]): Promise<ServiceRequestDiscoveryCandidate[]> {
    const unique = new Set(categoryIds);
    return [...this.requests.values()]
      .filter((r) => r.status === "PUBLISHED" && unique.has(r.categoryId))
      .map(({ status: _status, ...candidate }) => candidate);
  }
}

export class FakeQuoteRepository implements QuoteRepository {
  quotes = new Map<string, QuoteRecord>();
  private itemIdCounter = 0;
  private materialIdCounter = 0;

  private toItems(items: CreateQuoteData["items"]): QuoteItemRecord[] {
    return items.map((item, index) => {
      this.itemIdCounter += 1;
      return {
        id: `fake-quote-item-${this.itemIdCounter}`,
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        amount: Math.round(item.quantity * item.unitPrice * 100) / 100,
        sortOrder: index,
        category: item.category ?? "LABOR",
      };
    });
  }

  // Module 63 — Materials Procurement Workflow.
  private toMaterials(materials: CreateQuoteData["materials"]): QuoteMaterialRecord[] {
    return (materials ?? []).map((material, index) => {
      this.materialIdCounter += 1;
      return {
        id: `fake-quote-material-${this.materialIdCounter}`,
        name: material.name,
        brand: material.brand ?? null,
        model: material.model ?? null,
        quantity: material.quantity,
        notes: material.notes ?? null,
        sortOrder: index,
      };
    });
  }

  async findById(id: string) {
    return this.quotes.get(id) ?? null;
  }

  async findManyByProfessionalId(professionalProfileId: string, status?: QuoteStatusValue) {
    return [...this.quotes.values()]
      .filter((q) => q.professionalProfileId === professionalProfileId && (!status || q.status === status))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async findManyByServiceRequestId(serviceRequestId: string) {
    return [...this.quotes.values()]
      .filter((q) => q.serviceRequestId === serviceRequestId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async findActiveByServiceRequestAndProfessional(serviceRequestId: string, professionalProfileId: string) {
    return (
      [...this.quotes.values()].find(
        (q) =>
          q.serviceRequestId === serviceRequestId &&
          q.professionalProfileId === professionalProfileId &&
          OPEN_QUOTE_STATUSES.includes(q.status),
      ) ?? null
    );
  }

  async findByServiceRequestAndProfessional(serviceRequestId: string, professionalProfileId: string) {
    return (
      [...this.quotes.values()]
        .filter((q) => q.serviceRequestId === serviceRequestId && q.professionalProfileId === professionalProfileId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null
    );
  }

  async create(data: CreateQuoteData): Promise<QuoteRecord> {
    const now = new Date();
    const materialsStrategy = data.materialsStrategy ?? DEFAULT_MATERIALS_STRATEGY;
    const record: QuoteRecord = {
      id: nextId("fake-quote"),
      serviceRequestId: data.serviceRequestId,
      professionalProfileId: data.professionalProfileId,
      submittedByUserId: data.submittedByUserId,
      status: "SENT",
      totalAmount: data.totalAmount,
      currency: data.currency,
      validUntil: data.validUntil,
      notes: data.notes,
      items: this.toItems(data.items),
      materialsStrategy,
      materials: this.toMaterials(data.materials),
      materialsConfirmedAt: null,
      materialsConfirmedByUserId: null,
      createdAt: now,
      updatedAt: now,
    };
    this.quotes.set(record.id, record);
    return record;
  }

  async update(id: string, data: UpdateQuoteFields): Promise<QuoteRecord> {
    const existing = this.quotes.get(id);
    if (!existing) throw new Error(`No fake quote with id ${id}`);
    const updated: QuoteRecord = {
      ...existing,
      totalAmount: data.totalAmount,
      currency: data.currency,
      validUntil: data.validUntil,
      notes: data.notes,
      items: this.toItems(data.items),
      materialsStrategy: data.materialsStrategy ?? existing.materialsStrategy,
      materials: data.materials !== undefined ? this.toMaterials(data.materials) : existing.materials,
      updatedAt: new Date(),
    };
    this.quotes.set(id, updated);
    return updated;
  }

  async updateStatus(id: string, status: QuoteStatusValue): Promise<void> {
    const existing = this.quotes.get(id);
    if (existing) this.quotes.set(id, { ...existing, status, updatedAt: new Date() });
  }

  async findExpirable(now: Date): Promise<QuoteRecord[]> {
    return [...this.quotes.values()].filter(
      (q) =>
        (q.status === "PENDING" || q.status === "SENT" || q.status === "VIEWED") &&
        q.validUntil !== null &&
        q.validUntil.getTime() <= now.getTime(),
    );
  }

  // Module 63 — Materials Procurement Workflow.
  async confirmMaterialsPurchased(quoteId: string, confirmedByUserId: string): Promise<QuoteRecord> {
    const existing = this.quotes.get(quoteId);
    if (!existing) throw new Error(`No fake quote with id ${quoteId}`);
    if (existing.materialsConfirmedAt !== null) {
      throw new Error(`Fake quote ${quoteId} already has materials confirmed`);
    }
    const updated: QuoteRecord = {
      ...existing,
      materialsConfirmedAt: new Date(),
      materialsConfirmedByUserId: confirmedByUserId,
      updatedAt: new Date(),
    };
    this.quotes.set(quoteId, updated);
    return updated;
  }

  /** Test-only convenience — lets a test seed a Quote directly without
   *  going through CreateQuoteUseCase (mirrors FakeServiceRequestRepository.seed). */
  seed(record: QuoteRecord): QuoteRecord {
    this.quotes.set(record.id, record);
    return record;
  }
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

  // --- Module 88: GDPR Erasure Execution (test stub) ---
  async eraseForUser(_userId: string) {}
}

export class FakeServiceRequestRepository implements ServiceRequestRepository {
  requests = new Map<string, ServiceRequestRecord>();

  seed(record: ServiceRequestRecord): ServiceRequestRecord {
    this.requests.set(record.id, record);
    return record;
  }

  async findById(id: string) {
    return this.requests.get(id) ?? null;
  }

  async findManyByCustomerId(customerId: string) {
    return [...this.requests.values()].filter((r) => r.customerId === customerId);
  }

  async create(customerId: string, _userId: string, data: CreateServiceRequestData): Promise<ServiceRequestRecord> {
    const now = new Date();
    const record: ServiceRequestRecord = {
      id: nextId("fake-request"),
      customerId,
      categoryId: data.categoryId,
      categoryName: "Unknown",
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
    const updated = { ...existing, ...data, updatedAt: new Date() } as ServiceRequestRecord;
    this.requests.set(id, updated);
    return updated;
  }

  async updateStatus(id: string, status: ServiceRequestStatusValue): Promise<void> {
    const existing = this.requests.get(id);
    if (existing) this.requests.set(id, { ...existing, status, updatedAt: new Date() });
  }

  async addPhoto(): Promise<RequestPhotoRecord> {
    throw new Error("not used in quotes tests");
  }

  async removePhoto(): Promise<void> {
    throw new Error("not used in quotes tests");
  }

  async countPhotos(): Promise<number> {
    return 0;
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

/**
 * Module 89 — Fraud & Trust Signal Activation: minimal in-memory double for
 * the atomic "accept a Quote" transaction, just enough to exercise
 * AcceptQuoteUseCase's own pre-checks and its new BOOKING_RESTRICTION gate
 * (see that class's own doc comment) — mirrors the real
 * PrismaQuoteAcceptanceRepository's status re-checks and side effects
 * (Quote -> ACCEPTED, competing Quotes -> REJECTED, ServiceRequest ->
 * ACCEPTED, one Job + one Appointment created), without a real transaction.
 */
export class FakeQuoteAcceptanceRepository implements QuoteAcceptanceRepository {
  private jobIdCounter = 0;
  private appointmentIdCounter = 0;

  constructor(
    private readonly quotes: FakeQuoteRepository,
    private readonly serviceRequests: FakeServiceRequestRepository,
  ) {}

  async acceptQuote(params: { quoteId: string; serviceRequestId: string }): Promise<AcceptQuoteResult> {
    const quote = this.quotes.quotes.get(params.quoteId);
    const request = this.serviceRequests.requests.get(params.serviceRequestId);
    if (!quote || !request || quote.serviceRequestId !== params.serviceRequestId) {
      throw new ConflictError("Quote or ServiceRequest no longer exists.");
    }
    if (!isAcceptableQuoteStatus(quote.status)) {
      throw new ConflictError("This quote can no longer be accepted.");
    }
    if (!isAcceptableStatus(request.status)) {
      throw new ConflictError("This request can no longer accept a quote.");
    }

    await this.quotes.updateStatus(quote.id, "ACCEPTED");
    const siblings = await this.quotes.findManyByServiceRequestId(request.id);
    for (const sibling of siblings) {
      if (sibling.id !== quote.id && OPEN_QUOTE_STATUSES.includes(sibling.status)) {
        await this.quotes.updateStatus(sibling.id, "REJECTED");
      }
    }
    await this.serviceRequests.updateStatus(request.id, "ACCEPTED");

    this.jobIdCounter += 1;
    const job: AcceptQuoteJobRecord = {
      id: `fake-job-${this.jobIdCounter}`,
      serviceRequestId: request.id,
      quoteId: quote.id,
      customerId: request.customerId,
      professionalProfileId: quote.professionalProfileId,
      companyProfileId: null,
      status: "CREATED",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.appointmentIdCounter += 1;
    const appointment: AppointmentRecord = {
      id: `fake-appointment-${this.appointmentIdCounter}`,
      jobId: job.id,
      quoteId: quote.id,
      serviceRequestId: request.id,
      addressId: `fake-address-${request.id}`,
      professionalProfileId: quote.professionalProfileId,
      companyProfileId: null,
      status: "PENDING_SCHEDULE",
      scheduledStart: null,
      scheduledEnd: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    return { serviceRequestId: request.id, acceptedQuoteId: quote.id, job, appointment };
  }
}

/**
 * Module 89 — Fraud & Trust Signal Activation: same in-memory double as
 * tests/unit/core/application/use-cases/payments/fakes.ts's own
 * FakeTrustAutomatedActionRepository (the existing PAYOUT_HOLD test
 * pattern) — only `listActiveForUser` (and a `seedActive` helper covering
 * any TrustAutomatedActionTypeValue, not just PAYOUT_HOLD) are
 * meaningfully implemented, the only method AcceptQuoteUseCase's new
 * BOOKING_RESTRICTION gate reaches.
 */
export class FakeTrustAutomatedActionRepository implements TrustAutomatedActionRepository {
  activeByUser = new Map<string, TrustAutomatedActionRecord[]>();
  private actionIdCounter = 0;

  seedActive(userId: string, type: TrustAutomatedActionTypeValue): TrustAutomatedActionRecord {
    this.actionIdCounter += 1;
    const record: TrustAutomatedActionRecord = {
      id: `fake-trust-action-${this.actionIdCounter}`,
      userId,
      type,
      status: "ACTIVE",
      reason: "ADMIN_ADJUSTMENT",
      triggeringRiskScore: 0,
      detail: "Test-seeded restriction.",
      createdByUserId: "admin-1",
      expiresAt: null,
      reversedAt: null,
      reversedByUserId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const existing = this.activeByUser.get(userId) ?? [];
    this.activeByUser.set(userId, [...existing, record]);
    return record;
  }

  create(): Promise<TrustAutomatedActionRecord> {
    throw new Error("not implemented in this fake");
  }
  findById(): Promise<TrustAutomatedActionRecord | null> {
    throw new Error("not implemented in this fake");
  }
  listForUser(): Promise<TrustAutomatedActionRecord[]> {
    throw new Error("not implemented in this fake");
  }
  async listActiveForUser(userId: string, type?: TrustAutomatedActionTypeValue): Promise<TrustAutomatedActionRecord[]> {
    const all = this.activeByUser.get(userId) ?? [];
    return type ? all.filter((a) => a.type === type) : all;
  }
  countActiveForUser(): Promise<number> {
    throw new Error("not implemented in this fake");
  }
  reverse(): Promise<TrustAutomatedActionRecord> {
    throw new Error("not implemented in this fake");
  }
  expireDue(): Promise<number> {
    throw new Error("not implemented in this fake");
  }
  countAll(): Promise<number> {
    throw new Error("not implemented in this fake");
  }
  countByType(): Promise<number> {
    throw new Error("not implemented in this fake");
  }
  countActive(): Promise<number> {
    throw new Error("not implemented in this fake");
  }
}
