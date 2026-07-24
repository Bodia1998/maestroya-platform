/**
 * Module 18 — Company Professional: pure, dependency-free business rules for
 * the CompanyProfile aggregate itself (status lifecycle, slug/basic field
 * validation). Same small-helper style as professional-verification-rules.ts/
 * review-rules.ts/portfolio-rules.ts — kept independently unit-testable and
 * re-checked in every use case regardless of what the client sent.
 *
 * Membership/invitation/verification rules for a company live in their own
 * sibling files (company-membership-rules.ts, company-invitation-rules.ts,
 * company-verification-rules.ts) rather than here, mirroring how Job/
 * Appointment/Review each got their own rules file instead of one giant
 * "company rules" grab-bag.
 */

export const COMPANY_STATUS_VALUES = ["PENDING", "ACTIVE", "SUSPENDED", "DEACTIVATED"] as const;
export type CompanyStatusValue = (typeof COMPANY_STATUS_VALUES)[number];

export const MIN_LEGAL_NAME_LENGTH = 2;
export const MAX_LEGAL_NAME_LENGTH = 200;
export const MAX_TRADE_NAME_LENGTH = 200;
export const MAX_DESCRIPTION_LENGTH = 5000;

/**
 * A company's own status lifecycle, distinct from `isVerified` (a trust
 * signal driven by CompanyVerification) and `deletedAt` (hard removal).
 *
 * PENDING: just created by its owner, not yet publicly discoverable/
 * accepting work (mirrors an individual professional profile existing before
 * it is ACTIVE). ACTIVE: normal operating state. SUSPENDED: an admin action
 * (see SuspendCompanyUseCase) — reversible via ReactivateCompany.
 * DEACTIVATED: the owner's own choice to stop operating (heavier than
 * "not accepting requests" — mirrors ProfessionalStatus.INACTIVE's role for
 * individual professionals). Admin suspension and owner deactivation are
 * kept as separate states (not one "inactive" bucket) so an admin
 * reactivating a company can never accidentally undo an owner's own choice,
 * and vice versa.
 */
const TRANSITIONS: Record<CompanyStatusValue, CompanyStatusValue[]> = {
  PENDING: ["ACTIVE", "SUSPENDED", "DEACTIVATED"],
  ACTIVE: ["SUSPENDED", "DEACTIVATED"],
  SUSPENDED: ["ACTIVE", "DEACTIVATED"],
  DEACTIVATED: ["ACTIVE"],
};

export function canTransitionCompanyStatus(from: CompanyStatusValue, to: CompanyStatusValue): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Only ACTIVE companies may be discovered publicly or receive new work —
 *  same role ProfessionalStatus.ACTIVE plays for individual professionals. */
export function isCompanyDiscoverable(status: CompanyStatusValue): boolean {
  return status === "ACTIVE";
}

export function isValidLegalName(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length >= MIN_LEGAL_NAME_LENGTH && trimmed.length <= MAX_LEGAL_NAME_LENGTH;
}

export function isValidTradeName(value: string | null | undefined): boolean {
  if (value === null || value === undefined) return true;
  return value.trim().length <= MAX_TRADE_NAME_LENGTH;
}

export function isValidDescription(value: string | null | undefined): boolean {
  if (value === null || value === undefined) return true;
  return value.trim().length <= MAX_DESCRIPTION_LENGTH;
}

/** Slugifies a display name into a URL-safe identifier — ASCII lowercase,
 *  hyphen-separated, no leading/trailing/duplicate hyphens. The caller
 *  (CreateCompanyUseCase) is responsible for appending a disambiguating
 *  suffix if the slugified value collides with an existing one; this
 *  function itself is a pure string transform with no I/O. */
export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function normalizeOptionalText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}
