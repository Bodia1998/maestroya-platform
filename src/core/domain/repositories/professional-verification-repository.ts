import type { VerificationStatusValue } from "@/domain/repositories/professional-repository";
import type {
  ProfessionalVerificationStatusValue,
  VerificationDocumentStatusValue,
  VerificationDocumentTypeValue,
} from "@/domain/services/professional-verification-rules";

/**
 * Professional Verification module (Module 17): repository interface for the
 * ProfessionalVerification aggregate and its documents. Follows the same
 * "narrow, module-scoped, record-shaped interface" convention as
 * PortfolioRepository/NotificationRepository — no `Entity<Props>` subclass;
 * pure business rules live in domain/services/professional-verification-
 * rules.ts, this file only defines the shape data is read/written in.
 *
 * Sensitive-data note: `fileUrl` on VerificationDocumentRecord is a
 * Cloudinary reference to a personal document. It is only ever returned to
 * the owning professional or an ADMIN/SUPER_ADMIN through this repository's
 * own use cases — it is never part of any public professional-profile
 * response (see PrismaProfessionalDiscoveryRepository, which selects no
 * verification data at all).
 */

export interface ProfessionalVerificationRecord {
  id: string;
  professionalProfileId: string;
  status: ProfessionalVerificationStatusValue;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  reviewedByUserId: string | null;
  rejectionReason: string | null;
  resubmissionReason: string | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface VerificationDocumentRecord {
  id: string;
  verificationId: string;
  type: VerificationDocumentTypeValue;
  status: VerificationDocumentStatusValue;
  fileUrl: string;
  originalFilename: string;
  mimeType: string;
  fileSizeBytes: number;
  rejectionReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProfessionalVerificationWithDocuments extends ProfessionalVerificationRecord {
  documents: VerificationDocumentRecord[];
}

/** Admin queue row — includes the minimum professional identification the
 *  reviewer needs to make sense of the queue, joined from the profile/user. */
export interface AdminVerificationListItem {
  id: string;
  professionalProfileId: string;
  businessName: string | null;
  professionalName: string | null;
  professionalEmail: string | null;
  status: ProfessionalVerificationStatusValue;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  reviewedByUserId: string | null;
  createdAt: Date;
}

export interface AdminVerificationDetail extends AdminVerificationListItem {
  professionalUserId: string;
  rejectionReason: string | null;
  resubmissionReason: string | null;
  expiresAt: Date | null;
  documents: VerificationDocumentRecord[];
}

export interface AddVerificationDocumentData {
  verificationId: string;
  type: VerificationDocumentTypeValue;
  fileUrl: string;
  originalFilename: string;
  mimeType: string;
  fileSizeBytes: number;
}

/** Every field is optional — a caller supplies only the columns that change
 *  for the transition it is performing (e.g. approve sets status +
 *  reviewedAt + reviewedByUserId + expiresAt). */
export interface UpdateVerificationStatusData {
  status: ProfessionalVerificationStatusValue;
  submittedAt?: Date | null;
  reviewedAt?: Date | null;
  reviewedByUserId?: string | null;
  rejectionReason?: string | null;
  resubmissionReason?: string | null;
  expiresAt?: Date | null;
}

export interface ListAdminVerificationsOptions {
  limit: number;
  offset: number;
  status?: ProfessionalVerificationStatusValue;
}

export interface ProfessionalVerificationRepository {
  /** Opens a fresh case in DRAFT for the given professional profile. */
  create(professionalProfileId: string): Promise<ProfessionalVerificationRecord>;

  /** The professional's current, non-EXPIRED case (there is at most one), or
   *  null if they have never started one / only have expired history. */
  findActiveByProfessionalProfileId(professionalProfileId: string): Promise<ProfessionalVerificationRecord | null>;

  /** Same as above but with its documents eagerly loaded, for the
   *  professional's own dashboard view. */
  findActiveWithDocumentsByProfessionalProfileId(
    professionalProfileId: string,
  ): Promise<ProfessionalVerificationWithDocuments | null>;

  findById(id: string): Promise<ProfessionalVerificationRecord | null>;

  updateStatus(id: string, data: UpdateVerificationStatusData): Promise<ProfessionalVerificationRecord>;

  addDocument(data: AddVerificationDocumentData): Promise<VerificationDocumentRecord>;
  findDocumentById(id: string): Promise<VerificationDocumentRecord | null>;
  listDocuments(verificationId: string): Promise<VerificationDocumentRecord[]>;
  countDocuments(verificationId: string): Promise<number>;
  /** Hard delete — only ever called for a document on a case in a
   *  document-modifiable state (see canModifyDocuments). */
  removeDocument(id: string): Promise<void>;

  /**
   * Writes the public trust signal onto ProfessionalProfile
   * (verificationStatus + verifiedAt). Lives here rather than on
   * ProfessionalRepository so this module doesn't have to widen that
   * interface (and every fake implementing it) — the profile row is the only
   * ProfessionalProfile column this module ever mutates.
   */
  setProfileVerificationStatus(
    professionalProfileId: string,
    status: VerificationStatusValue,
    verifiedAt: Date | null,
  ): Promise<void>;

  // --- Admin read paths ---
  listForAdmin(options: ListAdminVerificationsOptions): Promise<AdminVerificationListItem[]>;
  getDetailForAdmin(id: string): Promise<AdminVerificationDetail | null>;

  /**
   * Module 28 — Workflow Completion: every APPROVED case whose `expiresAt`
   * is at or before `now` — feeds ExpireProfessionalVerificationsUseCase's
   * batch (see verification-expiration-rules.ts).
   */
  findExpirable(now: Date): Promise<ProfessionalVerificationRecord[]>;
}
