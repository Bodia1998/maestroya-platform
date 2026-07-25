/**
 * Module 21 — Disputes & Support: repository interface for the Dispute
 * aggregate. Follows the same "record + narrow repository interface"
 * convention as ReviewRepository/NotificationRepository — pure business
 * rules live in domain/services/dispute-state.ts + dispute-rules.ts, this
 * file only defines the shape data is read/written in.
 *
 * A Dispute is always anchored to a Job (`jobId`) — see schema.prisma's
 * Dispute doc comment for the Job-vs-ServiceRequest anchoring decision.
 * `serviceRequestId` is copied from `job.serviceRequestId` at creation
 * purely for admin query convenience and is never independently writable.
 */

export type DisputeReasonValue =
  | "SERVICE_NOT_COMPLETED"
  | "SERVICE_QUALITY"
  | "PROPERTY_DAMAGE"
  | "PROFESSIONAL_NO_SHOW"
  | "CUSTOMER_NO_SHOW"
  | "PRICE_DISAGREEMENT"
  | "SCOPE_OF_WORK"
  | "COMMUNICATION_ISSUE"
  | "OTHER";

export type DisputeStatusValue =
  | "OPEN"
  | "UNDER_REVIEW"
  | "WAITING_FOR_CUSTOMER"
  | "WAITING_FOR_PROFESSIONAL"
  | "RESOLVED"
  | "REJECTED"
  | "CLOSED";

export type DisputeResolutionValue =
  | "NO_ACTION"
  | "CUSTOMER_FAVOR"
  | "PROFESSIONAL_FAVOR"
  | "PARTIAL_RESOLUTION"
  | "FINANCIAL_ADJUSTMENT_REQUIRED"
  | "ESCALATED_EXTERNALLY";

export type DisputePriorityValue = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

export interface DisputeRecord {
  id: string;
  caseNumber: string;
  title: string;
  jobId: string;
  serviceRequestId: string;
  raisedByUserId: string;
  respondentProfessionalProfileId: string | null;
  respondentCompanyProfileId: string | null;
  reason: DisputeReasonValue;
  status: DisputeStatusValue;
  priority: DisputePriorityValue;
  description: string;
  assignedAdminUserId: string | null;
  resolution: DisputeResolutionValue | null;
  resolutionNote: string | null;
  resolvedAt: Date | null;
  resolvedByUserId: string | null;
  closedAt: Date | null;
  closedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateDisputeData {
  caseNumber: string;
  title: string;
  jobId: string;
  serviceRequestId: string;
  raisedByUserId: string;
  respondentProfessionalProfileId: string | null;
  respondentCompanyProfileId: string | null;
  reason: DisputeReasonValue;
  priority: DisputePriorityValue;
  description: string;
}

export interface ListDisputesOptions {
  limit: number;
  offset: number;
  status?: DisputeStatusValue;
}

export interface ListAdminDisputesOptions {
  limit: number;
  offset: number;
  status?: DisputeStatusValue;
  priority?: DisputePriorityValue;
  reason?: DisputeReasonValue;
  assignedAdminUserId?: string;
  /** Matches against caseNumber/title (case-insensitive substring). */
  search?: string;
}

export interface DisputeRepository {
  findById(id: string): Promise<DisputeRecord | null>;
  /** Every dispute (either as raiser or respondent) tied to a given Job —
   *  used by CreateDisputeUseCase's "one OPEN dispute per (job, opener)"
   *  check and by the Job/Order detail page. */
  listByJobId(jobId: string): Promise<DisputeRecord[]>;
  /** Disputes a given user opened (raisedByUserId) — "my disputes" as
   *  raiser. Respondent-side "my disputes" is resolved by the use case via
   *  listByJobId over the user's own Jobs, not a separate repository
   *  method, since "which Jobs is this professional/company party to" is
   *  JobRepository's concern, not DisputeRepository's. */
  listRaisedByUser(userId: string, options: ListDisputesOptions): Promise<DisputeRecord[]>;

  /** Admin oversight listing — filterable/searchable, never scoped to a
   *  single user. */
  listForAdmin(options: ListAdminDisputesOptions): Promise<DisputeRecord[]>;

  /**
   * Creates the Dispute. Implementations MUST translate a DB unique
   * constraint violation on `caseNumber` OR on the partial unique index
   * "at most one OPEN dispute per (job, opener)" into a `ConflictError`
   * rather than letting a raw Prisma error escape — see
   * PrismaDisputeRepository.create's doc comment.
   */
  create(data: CreateDisputeData): Promise<DisputeRecord>;

  /** Narrow, purpose-built status mutation — the only way Dispute.status is
   *  ever written. `expectedStatus` is an optimistic-concurrency guard
   *  (same convention as JobRepository.startWork/complete/cancel): the
   *  write only applies if the Dispute's status is still `expectedStatus`
   *  at write time, throwing ConflictError otherwise. Callers pass the
   *  full set of fields relevant to the specific transition (resolution/
   *  resolutionNote/resolvedByUserId/resolvedAt for a RESOLVED transition,
   *  closedByUserId/closedAt for CLOSED, etc.) — never a raw partial patch. */
  updateStatus(
    id: string,
    expectedStatus: DisputeStatusValue,
    data: {
      status: DisputeStatusValue;
      resolution?: DisputeResolutionValue | null;
      resolutionNote?: string | null;
      resolvedAt?: Date | null;
      resolvedByUserId?: string | null;
      closedAt?: Date | null;
      closedByUserId?: string | null;
    },
  ): Promise<DisputeRecord>;

  assign(id: string, assignedAdminUserId: string | null): Promise<DisputeRecord>;
  setPriority(id: string, priority: DisputePriorityValue): Promise<DisputeRecord>;
}
