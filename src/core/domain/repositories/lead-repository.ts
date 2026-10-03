import type { TransactionFlowVersion } from "@/domain/services/transaction-flow";
import type { LeadStatus } from "@/domain/services/lead";

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
  maxBuyers: number | null;
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
   * Module 124 - atomic DRAFT -> PUBLISHED. Returns the updated record, or
   * `null` when no DRAFT row was transitioned (missing, or already in another
   * status - the caller re-reads to tell an idempotent repeat from a rejected
   * transition). Conditional on status, so concurrent publishes cannot
   * double-transition or resurrect a CLOSED/EXPIRED/CANCELLED lead.
   */
  publish(id: string): Promise<LeadRecord | null>;
  findById(id: string): Promise<LeadRecord | null>;
  findByServiceRequestId(serviceRequestId: string): Promise<LeadRecord | null>;
}
