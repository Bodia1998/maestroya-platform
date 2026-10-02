import type { LeadPurchaseStatus } from "@/domain/services/lead-purchase";

/**
 * Module 123 — Lead Marketplace: persistence port for `LeadPurchase`.
 *
 * Intentionally minimal. There is NO status-update method: the payment
 * state machine (and its idempotency) is Module 126's job.
 *
 * `professionalProfileId` is the existing ProfessionalProfile id — the same
 * identity Module 122 authorizes against.
 */
export interface LeadPurchaseRecord {
  id: string;
  leadId: string;
  professionalProfileId: string;
  status: LeadPurchaseStatus;
  /** Fee the professional pays MaestroYa for access (EUR, max 2 decimals). */
  price: number;
  currency: string;
  confirmedAt: Date | null;
  refundedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateLeadPurchaseData {
  leadId: string;
  professionalProfileId: string;
  price: number;
  currency?: string;
}

export interface LeadPurchaseRepository {
  /**
   * Creates a PENDING_PAYMENT purchase (which grants NO access). Validates
   * price/currency. Throws DuplicateActiveLeadPurchaseError when the
   * professional already has a PENDING_PAYMENT/CONFIRMED purchase for the
   * lead (DB partial unique index is the arbiter under concurrency).
   * Creates no Payment/Commission/Payout/Invoice.
   */
  create(data: CreateLeadPurchaseData): Promise<LeadPurchaseRecord>;
  findById(id: string): Promise<LeadPurchaseRecord | null>;
  /** The professional's PENDING_PAYMENT or CONFIRMED purchase for the lead, if any. */
  findActiveByLeadAndProfessional(leadId: string, professionalProfileId: string): Promise<LeadPurchaseRecord | null>;
  /** The professional's CONFIRMED purchase for the lead, if any — the source
   *  for Module 122's authorization facts. Existence is still not an access
   *  decision. */
  findConfirmedByLeadAndProfessional(leadId: string, professionalProfileId: string): Promise<LeadPurchaseRecord | null>;
}
