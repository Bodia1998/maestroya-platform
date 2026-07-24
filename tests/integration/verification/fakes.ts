import type { NotificationCreator, NotificationEvent } from "@/application/ports/notification-creator";
import type { VerificationDocumentUploadService } from "@/application/interfaces/verification-document-upload-service";
import type {
  AdminAuditAction,
  AdminAuditLogRecord,
  AdminAuditLogRepository,
  ListAdminAuditLogsOptions,
  RecordAdminAuditLogData,
} from "@/domain/repositories/admin-audit-log-repository";
import type {
  CreateProfessionalData,
  ProfessionalRecord,
  ProfessionalRepository,
  ProfessionalStatusValue,
  UpdateProfessionalData,
  VerificationStatusValue,
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

/**
 * In-memory test doubles for the Professional Verification module (Module
 * 17) integration tests — same pattern as tests/integration/portfolio/fakes.ts
 * and tests/integration/admin/fakes.ts: implement the real interfaces so the
 * use cases under test run their genuine orchestration/authorization logic,
 * with only storage swapped out.
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
 * Mirrors PrismaProfessionalVerificationRepository's behavior: "active" =
 * non-EXPIRED (findActive* excludes EXPIRED), documents are ordered by
 * creation, and setProfileVerificationStatus writes onto the linked
 * ProfessionalProfile (via the shared FakeProfessionalRepository) so tests can
 * assert the public trust signal.
 */
export class FakeProfessionalVerificationRepository implements ProfessionalVerificationRepository {
  verifications = new Map<string, ProfessionalVerificationRecord>();
  documents = new Map<string, VerificationDocumentRecord>();

  constructor(private readonly professionals: FakeProfessionalRepository) {}

  async create(professionalProfileId: string): Promise<ProfessionalVerificationRecord> {
    const now = new Date();
    const record: ProfessionalVerificationRecord = {
      id: nextId("fake-verification"),
      professionalProfileId,
      status: "DRAFT",
      submittedAt: null,
      reviewedAt: null,
      reviewedByUserId: null,
      rejectionReason: null,
      resubmissionReason: null,
      expiresAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.verifications.set(record.id, record);
    return record;
  }

  private activeFor(professionalProfileId: string): ProfessionalVerificationRecord | null {
    return (
      [...this.verifications.values()]
        .filter((v) => v.professionalProfileId === professionalProfileId && v.status !== "EXPIRED")
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null
    );
  }

  async findActiveByProfessionalProfileId(professionalProfileId: string) {
    return this.activeFor(professionalProfileId);
  }

  async findActiveWithDocumentsByProfessionalProfileId(
    professionalProfileId: string,
  ): Promise<ProfessionalVerificationWithDocuments | null> {
    const active = this.activeFor(professionalProfileId);
    if (!active) return null;
    return { ...active, documents: await this.listDocuments(active.id) };
  }

  async findById(id: string) {
    return this.verifications.get(id) ?? null;
  }

  async updateStatus(id: string, data: UpdateVerificationStatusData): Promise<ProfessionalVerificationRecord> {
    const existing = this.verifications.get(id);
    if (!existing) throw new Error(`No fake verification with id ${id}`);
    const updated: ProfessionalVerificationRecord = {
      ...existing,
      status: data.status,
      ...(data.submittedAt !== undefined ? { submittedAt: data.submittedAt } : {}),
      ...(data.reviewedAt !== undefined ? { reviewedAt: data.reviewedAt } : {}),
      ...(data.reviewedByUserId !== undefined ? { reviewedByUserId: data.reviewedByUserId } : {}),
      ...(data.rejectionReason !== undefined ? { rejectionReason: data.rejectionReason } : {}),
      ...(data.resubmissionReason !== undefined ? { resubmissionReason: data.resubmissionReason } : {}),
      ...(data.expiresAt !== undefined ? { expiresAt: data.expiresAt } : {}),
      updatedAt: new Date(),
    };
    this.verifications.set(id, updated);
    return updated;
  }

  async addDocument(data: AddVerificationDocumentData): Promise<VerificationDocumentRecord> {
    const now = new Date();
    const record: VerificationDocumentRecord = {
      id: nextId("fake-document"),
      verificationId: data.verificationId,
      type: data.type,
      status: "PENDING",
      fileUrl: data.fileUrl,
      originalFilename: data.originalFilename,
      mimeType: data.mimeType,
      fileSizeBytes: data.fileSizeBytes,
      rejectionReason: null,
      createdAt: now,
      updatedAt: now,
    };
    this.documents.set(record.id, record);
    return record;
  }

  async findDocumentById(id: string) {
    return this.documents.get(id) ?? null;
  }

  async listDocuments(verificationId: string): Promise<VerificationDocumentRecord[]> {
    return [...this.documents.values()]
      .filter((d) => d.verificationId === verificationId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async countDocuments(verificationId: string): Promise<number> {
    return (await this.listDocuments(verificationId)).length;
  }

  async removeDocument(id: string): Promise<void> {
    this.documents.delete(id);
  }

  async setProfileVerificationStatus(
    professionalProfileId: string,
    status: VerificationStatusValue,
    verifiedAt: Date | null,
  ): Promise<void> {
    const profile = this.professionals.profiles.get(professionalProfileId);
    if (profile) {
      this.professionals.profiles.set(professionalProfileId, {
        ...profile,
        verificationStatus: status,
        verifiedAt,
        updatedAt: new Date(),
      });
    }
  }

  async listForAdmin(options: ListAdminVerificationsOptions): Promise<AdminVerificationListItem[]> {
    return [...this.verifications.values()]
      .filter((v) => (options.status ? v.status === options.status : true))
      .sort((a, b) => {
        const at = a.submittedAt?.getTime() ?? -1;
        const bt = b.submittedAt?.getTime() ?? -1;
        return bt - at;
      })
      .slice(options.offset, options.offset + options.limit)
      .map((v) => this.toListItem(v));
  }

  async getDetailForAdmin(id: string): Promise<AdminVerificationDetail | null> {
    const v = this.verifications.get(id);
    if (!v) return null;
    const profile = this.professionals.profiles.get(v.professionalProfileId);
    return {
      ...this.toListItem(v),
      professionalUserId: profile?.userId ?? "",
      rejectionReason: v.rejectionReason,
      resubmissionReason: v.resubmissionReason,
      expiresAt: v.expiresAt,
      documents: await this.listDocuments(v.id),
    };
  }

  private toListItem(v: ProfessionalVerificationRecord): AdminVerificationListItem {
    const profile = this.professionals.profiles.get(v.professionalProfileId);
    return {
      id: v.id,
      professionalProfileId: v.professionalProfileId,
      businessName: profile?.businessName ?? null,
      professionalName: null,
      professionalEmail: profile?.contactEmail ?? null,
      status: v.status,
      submittedAt: v.submittedAt,
      reviewedAt: v.reviewedAt,
      reviewedByUserId: v.reviewedByUserId,
      createdAt: v.createdAt,
    };
  }
}

export class FakeAdminAuditLogRepository implements AdminAuditLogRepository {
  entries: (RecordAdminAuditLogData & { id: string; createdAt: Date })[] = [];

  async record(data: RecordAdminAuditLogData): Promise<AdminAuditLogRecord> {
    const entry = { ...data, id: nextId("fake-audit"), createdAt: new Date() };
    this.entries.push(entry);
    return {
      id: entry.id,
      adminUserId: entry.adminUserId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      metadata: entry.metadata ?? null,
      createdAt: entry.createdAt,
    };
  }

  async list(options: ListAdminAuditLogsOptions): Promise<AdminAuditLogRecord[]> {
    return [...this.entries]
      .reverse()
      .slice(options.offset, options.offset + options.limit)
      .map((e) => ({
        id: e.id,
        adminUserId: e.adminUserId,
        action: e.action,
        targetType: e.targetType,
        targetId: e.targetId,
        metadata: e.metadata ?? null,
        createdAt: e.createdAt,
      }));
  }

  actions(): AdminAuditAction[] {
    return this.entries.map((e) => e.action);
  }
}

export class FakeNotificationCreator implements NotificationCreator {
  events: NotificationEvent[] = [];
  async notify(event: NotificationEvent): Promise<void> {
    this.events.push(event);
  }
}

export class FakeVerificationDocumentUploadService implements VerificationDocumentUploadService {
  uploads: { verificationId: string; contentType: string }[] = [];
  async uploadVerificationDocument(verificationId: string, _fileBuffer: Buffer, contentType: string): Promise<string> {
    this.uploads.push({ verificationId, contentType });
    return `https://res.cloudinary.com/demo/verifications/${verificationId}/${this.uploads.length}`;
  }
}
