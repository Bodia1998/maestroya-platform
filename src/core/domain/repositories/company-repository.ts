import type { CompanyStatusValue } from "@/domain/services/company-rules";

/**
 * Module 18 — Company Professional: repository interface for the
 * CompanyProfile aggregate itself. Follows the same "narrow, module-scoped,
 * record-shaped interface" convention as ProfessionalRepository — no
 * `Entity<Props>` subclass; pure business rules live in
 * domain/services/company-rules.ts.
 */

export interface CompanyRecord {
  id: string;
  ownerUserId: string;
  legalName: string;
  tradeName: string | null;
  taxId: string;
  description: string | null;
  logoUrl: string | null;
  websiteUrl: string | null;
  slug: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  addressLine: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  status: CompanyStatusValue;
  suspendedAt: Date | null;
  isVerified: boolean;
  verifiedAt: Date | null;
  stripeConnectAccountId: string | null;
  averageRating: number | null;
  reviewCount: number;
  isAcceptingRequests: boolean;
  categoryIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateCompanyData {
  legalName: string;
  tradeName?: string | null;
  taxId: string;
  description?: string | null;
  logoUrl?: string | null;
  websiteUrl?: string | null;
  slug: string;
  contactEmail?: string | null;
  contactPhone?: string | null;
  addressLine?: string | null;
  city?: string | null;
  province?: string | null;
  postalCode?: string | null;
  country?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  categoryIds?: string[];
}

/** Deliberately excludes `status`, `isVerified`, `verifiedAt`,
 *  `stripeConnectAccountId` — those are mutated only via their own dedicated
 *  paths (company status transitions, CompanyVerification, a future Stripe
 *  onboarding flow), never through the general profile-edit path an owner/
 *  admin drives themselves. Mirrors UpdateProfessionalData's own exclusions. */
export interface UpdateCompanyData {
  legalName?: string;
  tradeName?: string | null;
  description?: string | null;
  logoUrl?: string | null;
  websiteUrl?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  addressLine?: string | null;
  city?: string | null;
  province?: string | null;
  postalCode?: string | null;
  country?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  isAcceptingRequests?: boolean;
}

export interface CompanyRepository {
  findById(id: string): Promise<CompanyRecord | null>;
  findByOwnerUserId(ownerUserId: string): Promise<CompanyRecord | null>;
  findBySlug(slug: string): Promise<CompanyRecord | null>;
  findByTaxId(taxId: string): Promise<CompanyRecord | null>;
  /** Used by CreateCompanyUseCase to disambiguate a slug collision. */
  existsBySlug(slug: string): Promise<boolean>;
  create(ownerUserId: string, data: CreateCompanyData): Promise<CompanyRecord>;
  update(id: string, data: UpdateCompanyData): Promise<CompanyRecord>;
  updateStatus(id: string, status: CompanyStatusValue, suspendedAt: Date | null): Promise<void>;
  updateCategories(id: string, categoryIds: string[]): Promise<CompanyRecord>;
  /** Reassigns ownership — the new owner must already be an ACTIVE member
   *  (enforced in TransferCompanyOwnershipUseCase, not here). Does not touch
   *  CompanyMember rows; the use case updates the two members' roles in the
   *  same transaction. */
  updateOwner(id: string, newOwnerUserId: string): Promise<void>;
}
