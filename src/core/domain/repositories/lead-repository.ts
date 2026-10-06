import type { TransactionFlowVersion } from "@/domain/services/transaction-flow";
import type { LeadStatus } from "@/domain/services/lead";
import type { LeadPublicationSnapshot, LeadPublicationSnapshotData } from "@/domain/services/lead-publication";

/**
 * Module 123 — Lead Marketplace: persistence port for `Lead`.
 *
 * Intentionally minimal. Module 124 adds only `publish` (DRAFT -> PUBLISHED);
 * other lifecycle transitions belong to later modules.
 *
 * SECURITY: a LeadRecord never contains customer contact data (no
 * name/email/phone/address) and implementations must not select any. Private
 * contact is reachable only through Module 122's contact-reader port (GetLeadContactUseCase).
 */
export interface LeadRecord {
  id: string;
  serviceRequestId: string;
  status: LeadStatus;
  /** DERIVED from ServiceRequest.flowVersion (not stored on the lead).
   *  Typed as the full union so a corrupted/legacy link is visible to
   *  Module 122's WRONG_FLOW denial instead of being hidden. */
  flowVersion: TransactionFlowVersion;
  /** null = buyer policy not configured (NOT unlimited, NOT exclusive). */
  /** null = buyer policy not configured (NOT unlimited, NOT exclusive). Module 133: for a published Lead it equals `publication.maxBuyers`. */
  maxBuyers: number | null;
  /**
   * Module 133: the immutable publication snapshot (price, buyer policy,
   * versions). null/absent = the Lead was never published through the
   * publication contract (DRAFT, terminal-from-draft, or a legacy Module 124
   * publication). Marketplace consumers must use it instead of recomputing.
   */
  publication?: LeadPublicationSnapshot | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateLeadData {
  serviceRequestId: string;
  maxBuyers?: number | null;
}

export interface LeadRepository {
  /**
   * Creates a DRAFT lead. Throws NotFoundError (missing / soft-deleted
   * ServiceRequest), InvalidLeadFlowError (not LEAD_V1) or
   * LeadAlreadyExistsError (request already has a lead). Never creates a
   * Quote/Payment/Commission.
   */
  create(data: CreateLeadData): Promise<LeadRecord>;
  /**
   * Module 124/133 - atomic DRAFT -> PUBLISHED together with the immutable
   * publication snapshot (price + buyer policy) in ONE conditional write.
   * Returns the updated record, or `null` when no row was transitioned
   * (missing, not DRAFT, already carrying a snapshot, or the request is no
   * longer an open, non-deleted LEAD_V1 request) - the caller re-reads to tell
   * an idempotent repeat from a rejected publication. Because the write is
   * conditional on `status = DRAFT`, concurrent publishes cannot both win (the
   * first snapshot stays), a terminal Lead cannot be resurrected, and a
   * published Lead's snapshot/buyer policy can never be overwritten. The
   * Lead can never be PUBLISHED without its snapshot.
   */
  publish(id: string, snapshot: LeadPublicationSnapshotData): Promise<LeadRecord | null>;
  findById(id: string): Promise<LeadRecord | null>;
  findByServiceRequestId(serviceRequestId: string): Promise<LeadRecord | null>;
}
