/**
 * Module 21 — Disputes & Support: repository interface for the
 * DisputeEvidence aggregate. Reuses the existing storage abstraction (see
 * src/core/infrastructure/storage) exactly like MessageAttachment/
 * PortfolioItem/VerificationDocument do — this repository only persists the
 * URL + metadata a file was already uploaded to, it never performs the
 * upload itself.
 *
 * Known limitation (documented rather than solved — see
 * docs/MODULE_21_DISPUTES_SUPPORT.md, "Evidence handling"): `fileUrl` is a
 * plain URL, same as every other attachment model in this codebase
 * (MessageAttachment.url, PortfolioItem.mediaUrl). This codebase's storage
 * abstraction has no signed/scoped-access primitive today, so — same as
 * every other module with public-URL attachments — dispute evidence URLs
 * are not access-controlled at the storage layer; only *linking* to them
 * (reading DisputeEvidence rows) is access-controlled, via
 * GetDisputeByIdUseCase's authorization check.
 */

export interface DisputeEvidenceRecord {
  id: string;
  disputeId: string;
  submittedByUserId: string;
  fileUrl: string;
  fileName: string | null;
  fileType: string | null;
  fileSizeBytes: number | null;
  description: string | null;
  createdAt: Date;
}

export interface CreateDisputeEvidenceData {
  disputeId: string;
  submittedByUserId: string;
  fileUrl: string;
  fileName: string | null;
  fileType: string | null;
  fileSizeBytes: number | null;
  description: string | null;
}

export interface DisputeEvidenceRepository {
  listByDisputeId(disputeId: string): Promise<DisputeEvidenceRecord[]>;
  create(data: CreateDisputeEvidenceData): Promise<DisputeEvidenceRecord>;
}
