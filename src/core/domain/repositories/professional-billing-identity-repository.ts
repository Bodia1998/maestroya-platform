import type {
  BillingIdentityDetails,
  BillingIdentityPersistedStatus,
  BillingIdentityRejectionReason,
} from "@/domain/services/professional-billing-identity";

/**
 * Module 146 — persistence port for `ProfessionalBillingIdentity` (one row per
 * ProfessionalProfile). Verification authority lives in `markVerified` /
 * `markRejected`, which only the admin use cases call; `saveDetails` can NEVER
 * set a verification status — it accepts details only, and any material change
 * resets the row to UNVERIFIED (also enforced by a database trigger).
 */
export interface ProfessionalBillingIdentityRecord extends BillingIdentityDetails {
  id: string;
  professionalProfileId: string;
  verificationStatus: BillingIdentityPersistedStatus;
  /** Bumped by the database on every material change; admin decisions are bound to it. */
  revision: number;
  verifiedAt: Date | null;
  reviewedAt: Date | null;
  /** Admin-only. Never part of any professional-facing DTO. */
  reviewedByUserId: string | null;
  rejectionReason: BillingIdentityRejectionReason | null;
  /** Admin-only free text. Never part of any professional-facing DTO. */
  reviewNote: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SaveBillingIdentityResult {
  record: ProfessionalBillingIdentityRecord;
  /** True when a row was created or a material field changed (verification reset). */
  changed: boolean;
}

export interface BillingIdentityDecision {
  adminUserId: string;
  now: Date;
}

export interface ProfessionalBillingIdentityRepository {
  findByProfessionalProfileId(professionalProfileId: string): Promise<ProfessionalBillingIdentityRecord | null>;
  findById(id: string): Promise<ProfessionalBillingIdentityRecord | null>;
  /**
   * Insert-or-update of the details of ONE professional's identity. Identical
   * (normalised) details are a no-op that preserves the current status;
   * otherwise the row ends UNVERIFIED with all review metadata cleared.
   */
  saveDetails(professionalProfileId: string, details: BillingIdentityDetails): Promise<SaveBillingIdentityResult>;
  /**
   * UNVERIFIED -> VERIFIED, conditional on `expectedRevision` (the revision the
   * administrator actually reviewed). Returns null when the row is missing, not
   * UNVERIFIED, or its revision moved on (the professional edited meanwhile).
   */
  markVerified(id: string, expectedRevision: number, decision: BillingIdentityDecision): Promise<ProfessionalBillingIdentityRecord | null>;
  /** UNVERIFIED | VERIFIED -> REJECTED, same revision condition. */
  markRejected(
    id: string,
    expectedRevision: number,
    decision: BillingIdentityDecision & { reason: BillingIdentityRejectionReason; note: string | null },
  ): Promise<ProfessionalBillingIdentityRecord | null>;
  /** Oldest first; UNVERIFIED rows only (admin review queue). */
  listPendingReview(options: { limit: number; offset: number }): Promise<ProfessionalBillingIdentityRecord[]>;
}
