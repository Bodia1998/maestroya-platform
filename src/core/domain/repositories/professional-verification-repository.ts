import type { VerificationStatusValue } from "@/domain/repositories/professional-repository";
import type {
  ProfessionalVerificationStatusValue,
  VerificationDocumentStatusValue,
  VerificationDocumentTypeValue,
  VerificationProviderValue,
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
  /** Module 59 — Professional Verification (Persona). `"MANUAL"` for every
   *  pre-Module-59 case and every case a professional never starts a
   *  provider inquiry for. See VerificationProviderName's doc comment in
   *  schema.prisma. */
  provider: VerificationProviderValue;
  providerVerificationId: string | null;
  providerStatus: string | null;
  providerSyncedAt: Date | null;
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
  // --- Module 88 / Module 94: GDPR erasure + Cloudinary purge retry ---
  /** Set the instant erasure soft-deletes this document. Null for a
   *  document that has not been through GDPR erasure at all. */
  deletedAt: Date | null;
  /** Set only once the Cloudinary file behind `fileUrl` is confirmed
   *  deleted. See schema.prisma's own doc comment. */
  storagePurgedAt: Date | null;
  /** Module 94 — see `DocumentStoragePurgeStatusValue`'s own doc comment. */
  storagePurgeStatus: DocumentStoragePurgeStatusValue;
  storagePurgeAttemptCount: number;
  storagePurgeNextAttemptAt: Date | null;
  storagePurgeLastError: string | null;
  storagePurgeLastAttemptedAt: Date | null;
}

/**
 * Module 94 — GDPR Cloudinary Purge Retry & Durable Erasure Completion.
 * Mirrors the Postgres enum `DocumentStoragePurgeStatus` (schema.prisma).
 * `PENDING`: eligible for another retry attempt (immediately, or once
 * `storagePurgeNextAttemptAt` elapses). `DEAD_LETTER`: retries exhausted
 * (`GDPR_CLOUDINARY_PURGE_MAX_ATTEMPTS`) or the provider returned a
 * permanent/non-retryable error — requires manual operator review, never
 * silently discarded (see `RetryPendingCloudinaryPurgesUseCase`'s own doc
 * comment).
 */
export type DocumentStoragePurgeStatusValue = "PENDING" | "DEAD_LETTER";

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
  /** Module 59 — Professional Verification (Persona): set together by
   *  `StartProfessionalVerificationUseCase` (provider + providerVerificationId,
   *  moving MANUAL -> PERSONA the first time a professional starts a
   *  Persona inquiry) and `RefreshVerificationStatusUseCase`/
   *  `SynchronizeVerificationUseCase` (providerStatus + providerSyncedAt on
   *  every sync, regardless of whether the case's own `status` changed). */
  provider?: VerificationProviderValue;
  providerVerificationId?: string | null;
  providerStatus?: string | null;
  providerSyncedAt?: Date | null;
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

  /**
   * Module 59 — Professional Verification (Persona): correlates an inbound
   * provider lookup (or, in the future, a validated webhook) back to the
   * case it belongs to. `null` for any `providerVerificationId` this
   * platform never issued/recorded — a caller must treat that as "not
   * found", never as evidence that a matching case merely hasn't been
   * synced yet.
   */
  findByProviderVerificationId(providerVerificationId: string): Promise<ProfessionalVerificationRecord | null>;

  /**
   * Module 59 — Professional Verification (Persona): every case whose
   * provider verification is still awaiting a decision — `provider !=
   * MANUAL`, `providerVerificationId` set, and `status` in the set
   * `canSyncProviderStatus` (professional-verification-rules.ts) allows —
   * feeds `SynchronizeVerificationUseCase`'s batch sync, the same "batch
   * use case queries a `findX` method, applies pure per-record rules"
   * shape `findExpirable` above already established.
   */
  findSyncable(): Promise<ProfessionalVerificationRecord[]>;

  // --- Module 88: GDPR Erasure Execution & Document Retention ---

  /**
   * Soft-deletes (sets `deletedAt`) every not-yet-deleted
   * `ProfessionalVerificationDocument` across every verification case this
   * professional profile has (current and historical — a professional can
   * accumulate more than one case over time, see this file's own doc
   * comment) and returns exactly the rows just marked, so the caller can
   * drive the external Cloudinary purge for each `fileUrl` outside of the
   * DB transaction this runs in. Idempotent: a document already
   * soft-deleted is excluded, so re-running this against the same
   * professional profile returns an empty array the second time.
   */
  eraseDocumentsForProfessionalProfile(professionalProfileId: string): Promise<VerificationDocumentRecord[]>;

  /**
   * Every soft-deleted document (`deletedAt` set) whose underlying storage
   * file has not yet been confirmed purged (`storagePurgedAt` still null)
   * — across every case for this professional profile. Feeds the retry
   * path: a prior erasure run may have soft-deleted the DB rows but failed
   * partway through the Cloudinary deletes (network error, provider
   * outage); re-running the erasure use case re-selects exactly the
   * documents still outstanding here instead of re-soft-deleting or
   * skipping them.
   */
  listDocumentsPendingStoragePurge(professionalProfileId: string): Promise<VerificationDocumentRecord[]>;

  /**
   * Marks one document's underlying storage file as confirmed deleted —
   * sets `storagePurgedAt` and clears any outstanding Module 94 retry
   * state (`storagePurgeStatus` back to `PENDING`'s default meaning
   * "nothing owed," `storagePurgeAttemptCount`/`storagePurgeNextAttemptAt`/
   * `storagePurgeLastError` reset). Shared by both the inline purge
   * attempt inside `ExecuteAccountErasureUseCase` and
   * `RetryPendingCloudinaryPurgesUseCase` — one "purge succeeded" write
   * path, not two.
   */
  markDocumentStoragePurged(documentId: string): Promise<void>;

  // --- Module 94: GDPR Cloudinary Purge Retry & Durable Erasure Completion ---

  /**
   * Records a failed purge attempt for one document — called inline by
   * `ExecuteAccountErasureUseCase` the moment its own first attempt fails
   * (so a durable retry record exists immediately, before the erasure
   * call even returns; see that use case's own doc comment) and by
   * `RetryPendingCloudinaryPurgesUseCase` for every subsequent attempt.
   * `nextAttemptAt: null` together with `deadLetter: true` moves the row
   * to `DocumentStoragePurgeStatus.DEAD_LETTER` (retries exhausted, or the
   * provider error was classified permanent — see
   * `classifyCloudinaryPurgeError`) instead of scheduling another
   * attempt. `errorMessage` must already be the classified, redacted
   * message — never a raw provider payload (see `storagePurgeLastError`'s
   * own doc comment).
   */
  recordDocumentStoragePurgeFailure(
    documentId: string,
    data: { attemptCount: number; nextAttemptAt: Date | null; deadLetter: boolean; errorMessage: string },
  ): Promise<void>;

  /**
   * Atomically claims up to `batchSize` documents due for a Cloudinary
   * purge retry — `deletedAt IS NOT NULL AND storagePurgedAt IS NULL AND
   * storagePurgeStatus = 'PENDING' AND (storagePurgeNextAttemptAt IS NULL
   * OR storagePurgeNextAttemptAt <= now)`, ordered
   * `storagePurgeNextAttemptAt ASC NULLS FIRST, id ASC` (the exact keyset
   * order the composite index on those columns serves — never `OFFSET`
   * pagination, see `RetryPendingCloudinaryPurgesUseCase`'s own doc
   * comment).
   *
   * The claim itself is the concurrency-safety mechanism: implemented as
   * one atomic `SELECT ... FOR UPDATE SKIP LOCKED` + `UPDATE ... RETURNING`
   * statement (see the Prisma implementation), so two overlapping cron
   * invocations (this platform's serverless deployment target can and
   * does run duplicate/overlapping invocations of the same scheduled
   * route) can never both claim the same row — the loser's `SKIP LOCKED`
   * simply excludes rows the winner already has a row lock on, no
   * separate `lockedAt`/`lockOwner` column or distributed lock required
   * for row-level correctness (a coarser `DistributedLock` is layered on
   * top by `RetryPendingCloudinaryPurgesUseCase` purely to avoid wasted,
   * fully-redundant work when invocations overlap — not for correctness,
   * which this claim already guarantees on its own).
   *
   * Sets `storagePurgeLastAttemptedAt = now` on every claimed row as part
   * of the same atomic statement — this doubles as the in-flight lease:
   * a process that crashes mid-purge after claiming a row leaves it with
   * a stale `storagePurgeLastAttemptedAt` and an unchanged
   * `storagePurgeNextAttemptAt`, which is only re-claimable once that
   * `storagePurgeNextAttemptAt` (still whatever it was before this claim,
   * i.e. immediately, since a genuinely fresh row has it null) elapses
   * again on the *next* scheduled invocation — never stuck forever, and
   * never double-processed concurrently with the crashed attempt still
   * technically "in flight" (Cloudinary's own `destroy` is idempotent —
   * see `CloudinaryVerificationDocumentDeletionService`'s own doc
   * comment — so even the rare case of the crashed attempt's network call
   * actually completing server-side after this method re-claims the row
   * is safe: the next real attempt just gets Cloudinary's "not found"
   * response, treated as success).
   */
  claimPendingStoragePurgeBatch(now: Date, batchSize: number): Promise<VerificationDocumentRecord[]>;
}
