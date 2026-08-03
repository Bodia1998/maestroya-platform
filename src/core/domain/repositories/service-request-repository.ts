/**
 * Service Request Module: repository interface for the existing
 * `ServiceRequest` / `RequestPhoto` / `Address` models (see schema.prisma).
 * Follows the same "narrow, module-scoped interface" convention as
 * ProfessionalRepository — only the operations this module's use cases
 * need, not a general-purpose CRUD surface.
 *
 * Status naming note: the full `ServiceRequestStatus` enum anticipates a
 * fuller future workflow (DRAFT, QUOTED, ACCEPTED, IN_PROGRESS, COMPLETED,
 * EXPIRED, DISPUTED) that this module does not implement. This MVP only
 * ever writes PUBLISHED (on create) and CANCELLED (on cancel) — see
 * `src/core/domain/services/service-request-state.ts` for the "PUBLISHED is
 * the OPEN-equivalent state" rule enforced by the use cases.
 */

export type ServiceRequestStatusValue =
  | "DRAFT"
  | "PUBLISHED"
  | "QUOTED"
  | "ACCEPTED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "CANCELLED"
  | "EXPIRED"
  | "DISPUTED";

export type RequestUrgencyValue = "LOW" | "MEDIUM" | "HIGH" | "EMERGENCY";

export interface RequestPhotoRecord {
  id: string;
  url: string;
  caption: string | null;
  sortOrder: number;
}

export interface ServiceRequestLocation {
  line1: string;
  line2: string | null;
  city: string;
  province: string | null;
  postalCode: string;
  country: string;
  latitude: number | null;
  longitude: number | null;
}

export interface ServiceRequestRecord {
  id: string;
  /** CustomerProfile.id — never a User.id, see CustomerProfileRepository. */
  customerId: string;
  categoryId: string;
  categoryName: string;
  title: string;
  description: string;
  status: ServiceRequestStatusValue;
  urgency: RequestUrgencyValue;
  budgetMin: number | null;
  budgetMax: number | null;
  location: ServiceRequestLocation;
  photos: RequestPhotoRecord[];
  /**
   * Module 28 — Workflow Completion: when set, the point past which a
   * still-PUBLISHED/QUOTED request auto-transitions to EXPIRED (see
   * service-request-expiration-rules.ts). Optional (rather than a plain
   * `Date | null`) so every pre-existing object literal implementing this
   * interface across this codebase's fakes/tests — none of which know
   * about expiration — keeps compiling unchanged; every real row read
   * through PrismaServiceRequestRepository always populates it (null when
   * the underlying column is null).
   */
  expiresAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateServiceRequestData {
  categoryId: string;
  title: string;
  description: string;
  urgency: RequestUrgencyValue;
  budgetMin: number | null;
  budgetMax: number | null;
  location: ServiceRequestLocation;
}

/**
 * Every field is optional — the update use case only ever passes the
 * fields that actually changed (defaulting the rest to the existing
 * record's own values itself), so the repository implementation can stay
 * a plain "set what's given" without needing its own merge logic.
 */
export interface UpdateServiceRequestFields {
  categoryId?: string;
  title?: string;
  description?: string;
  urgency?: RequestUrgencyValue;
  budgetMin?: number | null;
  budgetMax?: number | null;
  location?: ServiceRequestLocation;
}

export interface ServiceRequestRepository {
  findById(id: string): Promise<ServiceRequestRecord | null>;
  findManyByCustomerId(customerId: string): Promise<ServiceRequestRecord[]>;
  /**
   * `userId` is only needed to create the underlying Address row (Address
   * belongs to a User, see schema.prisma) — the ServiceRequest itself is
   * owned via `customerId`.
   */
  create(customerId: string, userId: string, data: CreateServiceRequestData): Promise<ServiceRequestRecord>;
  update(id: string, data: UpdateServiceRequestFields): Promise<ServiceRequestRecord>;
  updateStatus(id: string, status: ServiceRequestStatusValue): Promise<void>;
  addPhoto(serviceRequestId: string, url: string, caption: string | null): Promise<RequestPhotoRecord>;
  removePhoto(serviceRequestId: string, photoId: string): Promise<void>;
  countPhotos(serviceRequestId: string): Promise<number>;
  /**
   * Module 28 — Workflow Completion: every non-deleted ServiceRequest whose
   * `expiresAt` is at or before `now` and whose status is still one
   * `isServiceRequestExpirable` considers open (PUBLISHED/QUOTED) — feeds
   * ExpireServiceRequestsUseCase's batch. Same "no pagination yet" scope
   * note as QuoteRepository.findExpirable.
   */
  findExpirable(now: Date): Promise<ServiceRequestRecord[]>;
}
