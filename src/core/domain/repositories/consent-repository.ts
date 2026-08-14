import type { ConsentTypeValue } from "@/domain/value-objects/consent-type";

/**
 * Module 38 — GDPR Compliance: repository interface for the `Consent`
 * aggregate (`domain/entities/consent.ts`). Follows the same "narrow,
 * module-scoped interface" convention as every other repository in this
 * codebase — only the operations `GrantConsentUseCase`/
 * `WithdrawConsentUseCase`/`ExportPersonalDataUseCase` need.
 *
 * Append-only in spirit: there is no `update`, only `create` (a fresh
 * grant) and `withdraw` (marks the existing active row's `withdrawnAt`) —
 * mirrors `AdminAuditLogRepository`'s own "no edits, only new facts"
 * design, since a consent history must remain trustworthy evidence of what
 * was actually agreed to and when.
 *
 * `ipHash`/`userAgent` (Module 62 — Professional Onboarding): additive,
 * optional provenance columns — populated by
 * `AcceptOnboardingTermsUseCase` (which reuses this same repository/entity
 * rather than introducing a parallel "terms acceptance" table; see that
 * module's own doc comment), left `null` by every pre-existing caller
 * (`GrantConsentUseCase`). Never required — a consent granted through a
 * channel with no request context (e.g. a future admin-assisted flow)
 * still records validly with both `null`.
 */
export interface ConsentRecord {
  id: string;
  userId: string;
  type: ConsentTypeValue;
  version: string;
  grantedAt: Date;
  withdrawnAt: Date | null;
  ipHash: string | null;
  userAgent: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateConsentData {
  userId: string;
  type: ConsentTypeValue;
  version: string;
  grantedAt: Date;
  ipHash?: string | null;
  userAgent?: string | null;
}

export interface ConsentRepository {
  /** The currently-active (not withdrawn) consent of this type for this
   *  user, or `null` if none was ever granted or the last one was
   *  withdrawn. At most one row can ever match, per (userId, type). */
  findActiveByUserAndType(userId: string, type: ConsentTypeValue): Promise<ConsentRecord | null>;

  /** Every consent record (granted and withdrawn) for a user, newest
   *  first — backs `ExportPersonalDataUseCase`'s CONSENT_RECORDS category. */
  listByUser(userId: string): Promise<ConsentRecord[]>;

  create(data: CreateConsentData): Promise<ConsentRecord>;

  /** Marks the given consent row as withdrawn. Implementations should treat
   *  withdrawing an already-withdrawn row as an idempotent no-op returning
   *  the existing record, matching `NotificationRepository.dismiss`'s own
   *  "idempotent soft mutation" convention. */
  withdraw(id: string, withdrawnAt: Date): Promise<ConsentRecord>;
}
