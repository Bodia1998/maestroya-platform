export type ProfessionalStatusValue = "ACTIVE" | "INACTIVE" | "SUSPENDED";
export type VerificationStatusValue = "UNVERIFIED" | "PENDING" | "VERIFIED" | "REJECTED";

export interface ProfessionalRecord {
  id: string;
  userId: string;
  businessName: string | null;
  bio: string | null;
  headline: string | null;
  yearsExperience: number | null;
  hourlyRate: number | null;
  serviceRadiusKm: number | null;
  contactEmail: string | null;
  contactPhone: string | null;
  websiteUrl: string | null;
  taxId: string | null;
  status: ProfessionalStatusValue;
  /** Admin-only future workflow. Never set from a professional-facing use case. */
  verificationStatus: VerificationStatusValue;
  verifiedAt: Date | null;
  isAcceptingRequests: boolean;
  categoryIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateProfessionalData {
  businessName?: string | null;
  bio?: string | null;
  headline?: string | null;
  yearsExperience?: number | null;
  hourlyRate?: number | null;
  serviceRadiusKm?: number | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  websiteUrl?: string | null;
  taxId?: string | null;
  categoryIds?: string[];
}

/**
 * Deliberately excludes `status` and `verificationStatus` — those are
 * mutated only via `updateStatus` (deactivation) and the future admin-only
 * verification workflow, never through the general-purpose profile update
 * path a professional drives themselves.
 */
export interface UpdateProfessionalData {
  businessName?: string | null;
  bio?: string | null;
  headline?: string | null;
  yearsExperience?: number | null;
  hourlyRate?: number | null;
  serviceRadiusKm?: number | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  websiteUrl?: string | null;
  taxId?: string | null;
  isAcceptingRequests?: boolean;
}

/**
 * Repository interface for the Professional Module's use of
 * ProfessionalProfile (see schema.prisma). Reuses the existing
 * ProfessionalProfile model rather than introducing a parallel one — this
 * interface only exposes the operations individual-professional use cases
 * need, following the same "narrow, module-scoped interface" convention as
 * AddressRepository/UserRepository.
 */
export interface ProfessionalRepository {
  findById(id: string): Promise<ProfessionalRecord | null>;
  findByUserId(userId: string): Promise<ProfessionalRecord | null>;
  create(userId: string, data: CreateProfessionalData): Promise<ProfessionalRecord>;
  update(id: string, data: UpdateProfessionalData): Promise<ProfessionalRecord>;
  updateStatus(id: string, status: ProfessionalStatusValue): Promise<void>;
  updateCategories(id: string, categoryIds: string[]): Promise<ProfessionalRecord>;
}
