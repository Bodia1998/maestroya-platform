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
import type { VerificationCaseStatusValue } from "@/domain/services/company-verification-rules";

/**
 * Module 28 — Workflow Completion: in-memory CompanyVerificationRepository
 * test double — the one repository fake this module's test suite needed
 * that didn't already exist anywhere in the codebase (every other
 * repository this module touches already had a fake — see
 * tests/integration/service-request/fakes.ts, tests/integration/quotes/fakes.ts,
 * tests/integration/verification/fakes.ts). Mirrors
 * FakeProfessionalVerificationRepository's shape exactly (same module,
 * same aggregate pattern, different owner column).
 */

let idCounter = 0;
function nextId(prefix: string) {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

export class FakeCompanyVerificationRepository implements CompanyVerificationRepository {
  verifications = new Map<string, CompanyVerificationRecord>();
  documents = new Map<string, CompanyVerificationDocumentRecord>();

  /** Test-only helper — seeds a verification record directly, bypassing
   *  the DRAFT->...->APPROVED flow, so expiration tests can start from an
   *  already-APPROVED case with an arbitrary `expiresAt`. */
  seed(overrides: Partial<CompanyVerificationRecord> & { companyProfileId: string }): CompanyVerificationRecord {
    const now = new Date();
    const record: CompanyVerificationRecord = {
      id: nextId("fake-company-verification"),
      status: "APPROVED",
      submittedAt: now,
      reviewedAt: now,
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

  async create(companyProfileId: string): Promise<CompanyVerificationRecord> {
    const now = new Date();
    const record: CompanyVerificationRecord = {
      id: nextId("fake-company-verification"),
      companyProfileId,
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

  async findActiveWithDocumentsByCompanyProfileId(
    companyProfileId: string,
  ): Promise<CompanyVerificationWithDocuments | null> {
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
    const updated: CompanyVerificationRecord = {
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

  async addDocument(data: AddCompanyVerificationDocumentData): Promise<CompanyVerificationDocumentRecord> {
    const now = new Date();
    const record: CompanyVerificationDocumentRecord = {
      id: nextId("fake-company-document"),
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
    // Not exercised by this module's tests — no CompanyProfile fake wired
    // up here (see this module's own scope: it never touches the public
    // trust badge, see ExpireCompanyVerificationsUseCase's doc comment).
  }

  async listForAdmin(options: ListAdminCompanyVerificationsOptions): Promise<AdminCompanyVerificationListItem[]> {
    return [...this.verifications.values()]
      .filter((v) => (options.status ? v.status === options.status : true))
      .slice(options.offset, options.offset + options.limit)
      .map((v) => this.toListItem(v));
  }

  async getDetailForAdmin(id: string): Promise<AdminCompanyVerificationDetail | null> {
    const v = this.verifications.get(id);
    if (!v) return null;
    return {
      ...this.toListItem(v),
      rejectionReason: v.rejectionReason,
      resubmissionReason: v.resubmissionReason,
      expiresAt: v.expiresAt,
      documents: await this.listDocuments(v.id),
    };
  }

  private toListItem(v: CompanyVerificationRecord): AdminCompanyVerificationListItem {
    return {
      id: v.id,
      companyProfileId: v.companyProfileId,
      companyLegalName: "Fake Co",
      ownerName: null,
      ownerEmail: null,
      status: v.status,
      submittedAt: v.submittedAt,
      reviewedAt: v.reviewedAt,
      reviewedByUserId: v.reviewedByUserId,
      createdAt: v.createdAt,
    };
  }

  async findExpirable(now: Date): Promise<CompanyVerificationRecord[]> {
    return [...this.verifications.values()].filter(
      (v) => v.status === "APPROVED" && v.expiresAt != null && v.expiresAt.getTime() <= now.getTime(),
    );
  }
}

export type { VerificationCaseStatusValue };
