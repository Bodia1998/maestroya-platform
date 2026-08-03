import type {
  CompanyVerificationDocumentTypeValue,
  VerificationCaseStatusValue,
} from "@/domain/services/company-verification-rules";
import type { VerificationDocumentStatusValue } from "@/domain/services/professional-verification-rules";

/**
 * Module 18 — Company Professional: repository interface for the
 * CompanyVerification aggregate and its documents — the company-side mirror
 * of ProfessionalVerificationRepository (Module 17). See
 * company-verification-rules.ts for why this is a separate model/enum
 * rather than an extension of the professional one.
 *
 * Sensitive-data note: `fileUrl` is only ever returned to an authorized
 * company member (OWNER/ADMIN — see canManageCompanyProfile) or an
 * ADMIN/SUPER_ADMIN — never part of any public company-profile response.
 */

export interface CompanyVerificationRecord {
  id: string;
  companyProfileId: string;
  status: VerificationCaseStatusValue;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  reviewedByUserId: string | null;
  rejectionReason: string | null;
  resubmissionReason: string | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CompanyVerificationDocumentRecord {
  id: string;
  verificationId: string;
  type: CompanyVerificationDocumentTypeValue;
  status: VerificationDocumentStatusValue;
  fileUrl: string;
  originalFilename: string;
  mimeType: string;
  fileSizeBytes: number;
  rejectionReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CompanyVerificationWithDocuments extends CompanyVerificationRecord {
  documents: CompanyVerificationDocumentRecord[];
}

export interface AdminCompanyVerificationListItem {
  id: string;
  companyProfileId: string;
  companyLegalName: string;
  ownerName: string | null;
  ownerEmail: string | null;
  status: VerificationCaseStatusValue;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  reviewedByUserId: string | null;
  createdAt: Date;
}

export interface AdminCompanyVerificationDetail extends AdminCompanyVerificationListItem {
  rejectionReason: string | null;
  resubmissionReason: string | null;
  expiresAt: Date | null;
  documents: CompanyVerificationDocumentRecord[];
}

export interface AddCompanyVerificationDocumentData {
  verificationId: string;
  type: CompanyVerificationDocumentTypeValue;
  fileUrl: string;
  originalFilename: string;
  mimeType: string;
  fileSizeBytes: number;
}

export interface UpdateCompanyVerificationStatusData {
  status: VerificationCaseStatusValue;
  submittedAt?: Date | null;
  reviewedAt?: Date | null;
  reviewedByUserId?: string | null;
  rejectionReason?: string | null;
  resubmissionReason?: string | null;
  expiresAt?: Date | null;
}

export interface ListAdminCompanyVerificationsOptions {
  limit: number;
  offset: number;
  status?: VerificationCaseStatusValue;
}

export interface CompanyVerificationRepository {
  create(companyProfileId: string): Promise<CompanyVerificationRecord>;
  findActiveByCompanyProfileId(companyProfileId: string): Promise<CompanyVerificationRecord | null>;
  findActiveWithDocumentsByCompanyProfileId(
    companyProfileId: string,
  ): Promise<CompanyVerificationWithDocuments | null>;
  findById(id: string): Promise<CompanyVerificationRecord | null>;
  updateStatus(id: string, data: UpdateCompanyVerificationStatusData): Promise<CompanyVerificationRecord>;

  addDocument(data: AddCompanyVerificationDocumentData): Promise<CompanyVerificationDocumentRecord>;
  findDocumentById(id: string): Promise<CompanyVerificationDocumentRecord | null>;
  listDocuments(verificationId: string): Promise<CompanyVerificationDocumentRecord[]>;
  countDocuments(verificationId: string): Promise<number>;
  removeDocument(id: string): Promise<void>;

  /** Writes the public trust signal onto CompanyProfile (isVerified +
   *  verifiedAt) — lives here rather than on CompanyRepository so this
   *  module doesn't have to widen that interface, same reasoning as
   *  ProfessionalVerificationRepository.setProfileVerificationStatus. */
  setCompanyVerifiedStatus(companyProfileId: string, isVerified: boolean, verifiedAt: Date | null): Promise<void>;

  listForAdmin(options: ListAdminCompanyVerificationsOptions): Promise<AdminCompanyVerificationListItem[]>;
  getDetailForAdmin(id: string): Promise<AdminCompanyVerificationDetail | null>;

  /**
   * Module 28 — Workflow Completion: every APPROVED case whose `expiresAt`
   * is at or before `now` — feeds ExpireCompanyVerificationsUseCase's batch
   * (see verification-expiration-rules.ts).
   */
  findExpirable(now: Date): Promise<CompanyVerificationRecord[]>;
}
