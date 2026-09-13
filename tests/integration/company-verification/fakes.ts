import type {
  AddCompanyVerificationDocumentData,
  AdminCompanyVerificationDetail,
  AdminCompanyVerificationListItem,
  CompanyVerificationDocumentRecord,
  CompanyVerificationRecord,
  CompanyVerificationRepository,
  CompanyVerificationWithDocuments,
  ListAdminCompanyVerificationsOptions,
  UpdateCompanyVerificationStatusData,
} from "@/domain/repositories/company-verification-repository";

/**
 * Module 106 — Secure Cloudinary Document Delivery.
 *
 * In-memory `CompanyVerificationRepository` test double — same pattern as
 * `tests/integration/verification/fakes.ts`'s
 * `FakeProfessionalVerificationRepository` and
 * `tests/integration/company/fakes.ts`'s other fakes: implements the real
 * interface so `GetCompanyVerificationDocumentUseCase` (and any other
 * company-verification use case a future test needs) runs its genuine
 * authorization logic, with only storage swapped out. Introduced for this
 * module because no company-verification fake previously existed —
 * Module 18's own tests only ever exercised company-verification use
 * cases through `PrismaCompanyVerificationRepository` in DB-integration
 * tests.
 */
let idCounter = 0;
function nextId(prefix: string) {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

export class FakeCompanyVerificationRepository implements CompanyVerificationRepository {
  verifications = new Map<string, CompanyVerificationRecord>();
  documents = new Map<string, CompanyVerificationDocumentRecord>();

  seedVerification(overrides: Partial<CompanyVerificationRecord> & { companyProfileId: string }): CompanyVerificationRecord {
    const now = new Date();
    const record: CompanyVerificationRecord = {
      id: nextId("fake-company-verification"),
      status: "DRAFT",
      submittedAt: null,
      reviewedAt: null,
      reviewedByUserId: null,
      rejectionReason: null,
      resubmissionReason: null,
      expiresAt: null,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
    this.verifications.set(record.id, record);
    return record;
  }

  seedDocument(overrides: Partial<CompanyVerificationDocumentRecord> & { verificationId: string }): CompanyVerificationDocumentRecord {
    const now = new Date();
    const record: CompanyVerificationDocumentRecord = {
      id: nextId("fake-company-document"),
      type: "BUSINESS_LICENSE",
      status: "PENDING",
      fileUrl: `https://res.cloudinary.com/demo/image/private/v1/maestroya/company-verifications/${overrides.verificationId}/doc.png`,
      originalFilename: "doc.png",
      mimeType: "image/png",
      fileSizeBytes: 100,
      rejectionReason: null,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
    this.documents.set(record.id, record);
    return record;
  }

  async create(companyProfileId: string): Promise<CompanyVerificationRecord> {
    return this.seedVerification({ companyProfileId });
  }

  private activeFor(companyProfileId: string): CompanyVerificationRecord | null {
    return (
      [...this.verifications.values()]
        .filter((v) => v.companyProfileId === companyProfileId && v.status !== "EXPIRED")
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null
    );
  }

  async findActiveByCompanyProfileId(companyProfileId: string) {
    return this.activeFor(companyProfileId);
  }

  async findActiveWithDocumentsByCompanyProfileId(companyProfileId: string): Promise<CompanyVerificationWithDocuments | null> {
    const active = this.activeFor(companyProfileId);
    if (!active) return null;
    return { ...active, documents: await this.listDocuments(active.id) };
  }

  async findById(id: string) {
    return this.verifications.get(id) ?? null;
  }

  async updateStatus(id: string, data: UpdateCompanyVerificationStatusData): Promise<CompanyVerificationRecord> {
    const existing = this.verifications.get(id);
    if (!existing) throw new Error(`No fake company verification with id ${id}`);
    const updated: CompanyVerificationRecord = { ...existing, ...data, updatedAt: new Date() };
    this.verifications.set(id, updated);
    return updated;
  }

  async addDocument(data: AddCompanyVerificationDocumentData): Promise<CompanyVerificationDocumentRecord> {
    return this.seedDocument(data);
  }

  async findDocumentById(id: string) {
    return this.documents.get(id) ?? null;
  }

  async listDocuments(verificationId: string): Promise<CompanyVerificationDocumentRecord[]> {
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

  async setCompanyVerifiedStatus(): Promise<void> {
    // Not exercised by Module 106's tests — no-op test stub.
  }

  async listForAdmin(options: ListAdminCompanyVerificationsOptions): Promise<AdminCompanyVerificationListItem[]> {
    void options;
    return [];
  }

  async getDetailForAdmin(id: string): Promise<AdminCompanyVerificationDetail | null> {
    const v = this.verifications.get(id);
    if (!v) return null;
    return {
      id: v.id,
      companyProfileId: v.companyProfileId,
      companyLegalName: "",
      ownerName: null,
      ownerEmail: null,
      status: v.status,
      submittedAt: v.submittedAt,
      reviewedAt: v.reviewedAt,
      reviewedByUserId: v.reviewedByUserId,
      createdAt: v.createdAt,
      rejectionReason: v.rejectionReason,
      resubmissionReason: v.resubmissionReason,
      expiresAt: v.expiresAt,
      documents: await this.listDocuments(v.id),
    };
  }

  async findExpirable(now: Date): Promise<CompanyVerificationRecord[]> {
    return [...this.verifications.values()].filter(
      (v) => v.status === "APPROVED" && v.expiresAt != null && v.expiresAt.getTime() <= now.getTime(),
    );
  }
}
