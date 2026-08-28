/**
 * Module 79 — Invoicing & Credit Notes: repository interface for the
 * professional's (or company's) explicit self-billing (facturación por el
 * destinatario) authorization — the domain fact that MaestroYa may issue
 * invoices in the professional's name and on their behalf, subject to
 * their agreement and Spanish tax requirements (see the module brief's
 * "SELF-BILLING" section).
 *
 * Deliberately NOT a fake electronic-signature system. What is persisted
 * here is exactly what the brief lists as the minimum: authorization
 * status, the acceptance timestamp, who accepted it, which
 * agreement/version they accepted, and enough audit evidence (never a
 * claim of a "qualified electronic signature") to demonstrate acceptance
 * later. The legal wording of the agreement itself is never stored here —
 * only `agreementVersion`, a caller-supplied identifier resolved against
 * whatever configurable/versioned agreement-text store the product owner
 * maintains (out of this module's scope — see the report's "Remaining
 * risks" section).
 *
 * One authorization row per professional OR per company at a time — same
 * "at most one active row, insert-or-replace on re-grant" convention
 * `ProfessionalOnboardingRepository.upsertPayoutAccount` already
 * establishes for a similar "current active configuration" concept.
 * History is preserved: granting a new authorization after a revocation
 * inserts a new row rather than resurrecting the old one, so the audit
 * trail always shows exactly which version was accepted when.
 */

export type SelfBillingAuthorizationStatusValue = "ACTIVE" | "REVOKED";

export interface SelfBillingAuthorizationRecord {
  id: string;
  /** Exactly one of professionalProfileId/companyProfileId is set — same
   *  solo-professional-vs-company duality every other financial record in
   *  this codebase (Quote, Payout, Commission, ...) already uses. */
  professionalProfileId: string | null;
  companyProfileId: string | null;
  status: SelfBillingAuthorizationStatusValue;
  /** Identifier of the versioned self-billing agreement text the
   *  professional/company accepted (e.g. "self-billing-agreement-es-v1").
   *  Never the agreement's legal wording itself — see this file's own
   *  doc comment. */
  agreementVersion: string;
  /** The authenticated User (professional or company owner) who accepted
   *  the agreement — never inferred, always supplied by the use case from
   *  the authenticated session. */
  acceptedByUserId: string;
  acceptedAt: Date;
  /** Best-effort acceptance evidence — never claimed as a qualified
   *  electronic signature (see this file's own doc comment and the
   *  module brief's "ELECTRONIC ACCEPTANCE" section). */
  acceptanceIpAddress: string | null;
  acceptanceUserAgent: string | null;
  revokedAt: Date | null;
  revokedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface GrantSelfBillingAuthorizationData {
  professionalProfileId?: string | null;
  companyProfileId?: string | null;
  agreementVersion: string;
  acceptedByUserId: string;
  acceptedAt: Date;
  acceptanceIpAddress?: string | null;
  acceptanceUserAgent?: string | null;
}

export interface SelfBillingAuthorizationRepository {
  findActiveForProfessional(professionalProfileId: string): Promise<SelfBillingAuthorizationRecord | null>;
  findActiveForCompany(companyProfileId: string): Promise<SelfBillingAuthorizationRecord | null>;

  /** Inserts a new ACTIVE authorization row. Implementations MUST first
   *  revoke (not delete) any existing ACTIVE row for the same
   *  professional/company inside the same transaction, so there is never
   *  more than one ACTIVE row per party at a time while the full history
   *  is preserved — same "insert new, never resurrect/mutate the old
   *  one" convention as re-granting Consent (Module 38). Idempotent in
   *  the sense that granting with the SAME agreementVersion while an
   *  identical ACTIVE authorization already exists returns that existing
   *  row unchanged rather than creating a duplicate. */
  grant(data: GrantSelfBillingAuthorizationData): Promise<SelfBillingAuthorizationRecord>;

  /** Marks the given authorization REVOKED. A no-op (returns the record
   *  unchanged) if it is already REVOKED — same idempotent convention as
   *  `ConsentRepository.withdraw`. */
  revoke(id: string, revokedByUserId: string, revokedAt: Date): Promise<SelfBillingAuthorizationRecord>;
}
