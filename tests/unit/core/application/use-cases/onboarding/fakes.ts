import type { AddressRecord, AddressRepository, UpsertAddressData } from "@/domain/repositories/address-repository";
import type {
  AdminAuditLogRecord,
  AdminAuditLogRepository,
  ListAdminAuditLogsOptions,
  RecordAdminAuditLogData,
} from "@/domain/repositories/admin-audit-log-repository";
import type { ConsentRecord, ConsentRepository, CreateConsentData } from "@/domain/repositories/consent-repository";
import type { ConsentTypeValue } from "@/domain/value-objects/consent-type";
import type {
  CreatePayoutAccountData,
  ProfessionalOnboardingRecord,
  ProfessionalOnboardingRepository,
  ProfessionalPayoutAccountRecord,
  UpdateStripeConnectAccountData,
} from "@/domain/repositories/professional-onboarding-repository";
import type {
  CreateProfessionalData,
  ProfessionalRecord,
  ProfessionalRepository,
  ProfessionalStatusValue,
  UpdateProfessionalData,
} from "@/domain/repositories/professional-repository";
import type {
  AddVerificationDocumentData,
  AdminVerificationDetail,
  AdminVerificationListItem,
  ListAdminVerificationsOptions,
  ProfessionalVerificationRecord,
  ProfessionalVerificationRepository,
  ProfessionalVerificationWithDocuments,
  UpdateVerificationStatusData,
  VerificationDocumentRecord,
} from "@/domain/repositories/professional-verification-repository";
import type {
  PayoutProvider,
  RegisterPayoutDestinationRequest,
  RegisterPayoutDestinationResult,
} from "@/application/ports/payout-provider";

/**
 * Module 62 — Professional Onboarding: in-memory fakes shared by this
 * module's unit/integration tests — same "one fakes.ts per module's test
 * directory" convention as `tests/integration/verification/fakes.ts`.
 */

let nextIdCounter = 0;
function nextId(prefix: string): string {
  nextIdCounter += 1;
  return `${prefix}-${nextIdCounter}`;
}

export class FakeProfessionalRepository implements ProfessionalRepository {
  byId = new Map<string, ProfessionalRecord>();

  seed(overrides: Partial<ProfessionalRecord> & { userId: string }): ProfessionalRecord {
    const record: ProfessionalRecord = {
      id: overrides.id ?? nextId("profile"),
      userId: overrides.userId,
      businessName: overrides.businessName ?? null,
      bio: overrides.bio ?? null,
      headline: overrides.headline ?? null,
      yearsExperience: overrides.yearsExperience ?? null,
      hourlyRate: overrides.hourlyRate ?? null,
      serviceRadiusKm: overrides.serviceRadiusKm ?? null,
      contactEmail: overrides.contactEmail ?? null,
      contactPhone: overrides.contactPhone ?? null,
      websiteUrl: overrides.websiteUrl ?? null,
      taxId: overrides.taxId ?? null,
      status: overrides.status ?? "ACTIVE",
      verificationStatus: overrides.verificationStatus ?? "UNVERIFIED",
      verifiedAt: overrides.verifiedAt ?? null,
      isAcceptingRequests: overrides.isAcceptingRequests ?? true,
      categoryIds: overrides.categoryIds ?? [],
      createdAt: overrides.createdAt ?? new Date(),
      updatedAt: overrides.updatedAt ?? new Date(),
    };
    this.byId.set(record.id, record);
    return record;
  }

  async findById(id: string): Promise<ProfessionalRecord | null> {
    return this.byId.get(id) ?? null;
  }

  async findByUserId(userId: string): Promise<ProfessionalRecord | null> {
    return [...this.byId.values()].find((p) => p.userId === userId) ?? null;
  }

  async create(userId: string, _data: CreateProfessionalData): Promise<ProfessionalRecord> {
    return this.seed({ userId });
  }

  async update(id: string, data: UpdateProfessionalData): Promise<ProfessionalRecord> {
    const existing = this.byId.get(id);
    if (!existing) throw new Error("not found");
    const updated = { ...existing, ...data, updatedAt: new Date() };
    this.byId.set(id, updated);
    return updated;
  }

  async updateStatus(id: string, status: ProfessionalStatusValue): Promise<void> {
    const existing = this.byId.get(id);
    if (existing) this.byId.set(id, { ...existing, status });
  }

  async updateCategories(id: string, categoryIds: string[]): Promise<ProfessionalRecord> {
    const existing = this.byId.get(id);
    if (!existing) throw new Error("not found");
    const updated = { ...existing, categoryIds };
    this.byId.set(id, updated);
    return updated;
  }
}

export class FakeAddressRepository implements AddressRepository {
  byUserId = new Map<string, AddressRecord>();

  async findPrimaryByUserId(userId: string): Promise<AddressRecord | null> {
    return this.byUserId.get(userId) ?? null;
  }

  async upsertPrimaryForUser(userId: string, data: UpsertAddressData): Promise<AddressRecord> {
    const record: AddressRecord = {
      id: nextId("address"),
      line1: data.line1,
      line2: data.line2 ?? null,
      city: data.city,
      province: data.province ?? null,
      postalCode: data.postalCode,
      country: data.country,
      latitude: data.latitude ?? null,
      longitude: data.longitude ?? null,
    };
    this.byUserId.set(userId, record);
    return record;
  }
}

export class FakeConsentRepository implements ConsentRepository {
  records: ConsentRecord[] = [];

  async findActiveByUserAndType(userId: string, type: ConsentTypeValue): Promise<ConsentRecord | null> {
    return this.records.find((r) => r.userId === userId && r.type === type && r.withdrawnAt === null) ?? null;
  }

  async listByUser(userId: string): Promise<ConsentRecord[]> {
    return this.records.filter((r) => r.userId === userId);
  }

  async create(data: CreateConsentData): Promise<ConsentRecord> {
    const record: ConsentRecord = {
      id: nextId("consent"),
      userId: data.userId,
      type: data.type,
      version: data.version,
      grantedAt: data.grantedAt,
      withdrawnAt: null,
      ipHash: data.ipHash ?? null,
      userAgent: data.userAgent ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.records.push(record);
    return record;
  }

  async withdraw(id: string, withdrawnAt: Date): Promise<ConsentRecord> {
    const record = this.records.find((r) => r.id === id);
    if (!record) throw new Error("not found");
    if (!record.withdrawnAt) record.withdrawnAt = withdrawnAt;
    return record;
  }
}

/** Implements the full `ProfessionalVerificationRepository` interface (this
 *  module only ever calls `findActiveByProfessionalProfileId`) — every
 *  other method throws "not implemented" if a test accidentally exercises
 *  a path this fake wasn't built for, rather than silently no-op'ing. */
export class FakeProfessionalVerificationRepository implements ProfessionalVerificationRepository {
  active = new Map<string, ProfessionalVerificationRecord>();

  seedApproved(professionalProfileId: string): void {
    this.active.set(professionalProfileId, {
      id: nextId("verification"),
      professionalProfileId,
      status: "APPROVED",
      submittedAt: new Date(),
      reviewedAt: new Date(),
      reviewedByUserId: "admin-1",
      rejectionReason: null,
      resubmissionReason: null,
      expiresAt: null,
      provider: "MANUAL",
      providerVerificationId: null,
      providerStatus: null,
      providerSyncedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  seedStatus(professionalProfileId: string, status: ProfessionalVerificationRecord["status"]): void {
    this.active.set(professionalProfileId, {
      id: nextId("verification"),
      professionalProfileId,
      status,
      submittedAt: new Date(),
      reviewedAt: null,
      reviewedByUserId: null,
      rejectionReason: null,
      resubmissionReason: null,
      expiresAt: null,
      provider: "MANUAL",
      providerVerificationId: null,
      providerStatus: null,
      providerSyncedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  async findActiveByProfessionalProfileId(professionalProfileId: string): Promise<ProfessionalVerificationRecord | null> {
    return this.active.get(professionalProfileId) ?? null;
  }

  create(): Promise<ProfessionalVerificationRecord> {
    throw new Error("not implemented in this fake");
  }
  findActiveWithDocumentsByProfessionalProfileId(): Promise<ProfessionalVerificationWithDocuments | null> {
    throw new Error("not implemented in this fake");
  }
  findById(): Promise<ProfessionalVerificationRecord | null> {
    throw new Error("not implemented in this fake");
  }
  updateStatus(_id: string, _data: UpdateVerificationStatusData): Promise<ProfessionalVerificationRecord> {
    throw new Error("not implemented in this fake");
  }
  addDocument(_data: AddVerificationDocumentData): Promise<VerificationDocumentRecord> {
    throw new Error("not implemented in this fake");
  }
  findDocumentById(): Promise<VerificationDocumentRecord | null> {
    throw new Error("not implemented in this fake");
  }
  listDocuments(): Promise<VerificationDocumentRecord[]> {
    throw new Error("not implemented in this fake");
  }
  countDocuments(): Promise<number> {
    throw new Error("not implemented in this fake");
  }
  removeDocument(): Promise<void> {
    throw new Error("not implemented in this fake");
  }
  setProfileVerificationStatus(): Promise<void> {
    throw new Error("not implemented in this fake");
  }
  listForAdmin(_options: ListAdminVerificationsOptions): Promise<AdminVerificationListItem[]> {
    throw new Error("not implemented in this fake");
  }
  getDetailForAdmin(): Promise<AdminVerificationDetail | null> {
    throw new Error("not implemented in this fake");
  }
  findExpirable(): Promise<ProfessionalVerificationRecord[]> {
    throw new Error("not implemented in this fake");
  }
  findByProviderVerificationId(): Promise<ProfessionalVerificationRecord | null> {
    throw new Error("not implemented in this fake");
  }
  findSyncable(): Promise<ProfessionalVerificationRecord[]> {
    throw new Error("not implemented in this fake");
  }
}

export class FakeProfessionalOnboardingRepository implements ProfessionalOnboardingRepository {
  onboardings = new Map<string, ProfessionalOnboardingRecord>();
  payoutAccounts = new Map<string, ProfessionalPayoutAccountRecord>();

  async findByProfessionalProfileId(professionalProfileId: string): Promise<ProfessionalOnboardingRecord | null> {
    return [...this.onboardings.values()].find((o) => o.professionalProfileId === professionalProfileId) ?? null;
  }

  async create(professionalProfileId: string): Promise<ProfessionalOnboardingRecord> {
    const record: ProfessionalOnboardingRecord = {
      id: nextId("onboarding"),
      professionalProfileId,
      status: "IN_PROGRESS",
      activatedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.onboardings.set(record.id, record);
    return record;
  }

  async activate(id: string, activatedAt: Date): Promise<ProfessionalOnboardingRecord> {
    const existing = this.onboardings.get(id);
    if (!existing) throw new Error("not found");
    if (existing.status === "ACTIVATED") return existing;
    const updated: ProfessionalOnboardingRecord = { ...existing, status: "ACTIVATED", activatedAt };
    this.onboardings.set(id, updated);
    return updated;
  }

  async findPayoutAccountByProfessionalProfileId(
    professionalProfileId: string,
  ): Promise<ProfessionalPayoutAccountRecord | null> {
    return this.payoutAccounts.get(professionalProfileId) ?? null;
  }

  async findPayoutAccountByStripeAccountId(stripeAccountId: string): Promise<ProfessionalPayoutAccountRecord | null> {
    return [...this.payoutAccounts.values()].find((a) => a.stripeExpressAccountId === stripeAccountId) ?? null;
  }

  async upsertPayoutAccount(data: CreatePayoutAccountData): Promise<ProfessionalPayoutAccountRecord> {
    const existing = this.payoutAccounts.get(data.professionalProfileId);
    const clearStripeFields = data.method !== "STRIPE_EXPRESS";
    const record: ProfessionalPayoutAccountRecord = {
      id: existing?.id ?? nextId("payout-account"),
      professionalProfileId: data.professionalProfileId,
      method: data.method,
      status: data.status,
      accountHolderName: data.accountHolderName,
      ibanLast4: data.ibanLast4 ?? null,
      ibanHash: data.ibanHash ?? null,
      stripeExpressAccountId: clearStripeFields ? null : existing?.stripeExpressAccountId ?? null,
      stripeExpressStatus: data.stripeExpressStatus ?? "NOT_STARTED",
      stripeChargesEnabled: clearStripeFields ? false : existing?.stripeChargesEnabled ?? false,
      stripePayoutsEnabled: clearStripeFields ? false : existing?.stripePayoutsEnabled ?? false,
      stripeDetailsSubmitted: clearStripeFields ? false : existing?.stripeDetailsSubmitted ?? false,
      stripeRequirementsCurrentlyDue: clearStripeFields ? false : existing?.stripeRequirementsCurrentlyDue ?? false,
      stripeConnectSyncedAt: clearStripeFields ? null : existing?.stripeConnectSyncedAt ?? null,
      createdAt: existing?.createdAt ?? new Date(),
      updatedAt: new Date(),
    };
    this.payoutAccounts.set(data.professionalProfileId, record);
    return record;
  }

  async updateStripeConnectAccount(
    professionalProfileId: string,
    data: UpdateStripeConnectAccountData,
  ): Promise<ProfessionalPayoutAccountRecord> {
    const existing = this.payoutAccounts.get(professionalProfileId);
    if (!existing) throw new Error("not found");
    const record: ProfessionalPayoutAccountRecord = {
      ...existing,
      ...data,
      updatedAt: new Date(),
    };
    this.payoutAccounts.set(professionalProfileId, record);
    return record;
  }

  async countByStatus(status: ProfessionalOnboardingRecord["status"]): Promise<number> {
    return [...this.onboardings.values()].filter((o) => o.status === status).length;
  }
}

export class RecordingAuditLogRepository implements AdminAuditLogRepository {
  entries: RecordAdminAuditLogData[] = [];

  async record(data: RecordAdminAuditLogData): Promise<AdminAuditLogRecord> {
    this.entries.push(data);
    return {
      id: `audit-${this.entries.length}`,
      adminUserId: data.adminUserId,
      action: data.action,
      targetType: data.targetType,
      targetId: data.targetId,
      metadata: data.metadata ?? null,
      createdAt: new Date(),
    };
  }

  async list(_options: ListAdminAuditLogsOptions): Promise<AdminAuditLogRecord[]> {
    return [];
  }
}

export class FakePayoutProvider implements PayoutProvider {
  constructor(
    readonly method: "IBAN" | "STRIPE_EXPRESS",
    private readonly result: RegisterPayoutDestinationResult,
  ) {}

  async registerDestination(_request: RegisterPayoutDestinationRequest): Promise<RegisterPayoutDestinationResult> {
    return this.result;
  }
}
