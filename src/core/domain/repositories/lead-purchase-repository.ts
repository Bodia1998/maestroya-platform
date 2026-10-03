import type { LeadPurchaseStatus } from "@/domain/services/lead-purchase";

/**
 * Module 123 — Lead Marketplace: persistence port for `LeadPurchase`.
 *
 * Intentionally minimal. Module 126 adds `initiate` (atomic, buyer-limit
 * safe creation) and `transition` (atomic, status-conditional update).
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
   * Module 126 — atomically creates a PENDING_PAYMENT purchase for a
   * PUBLISHED lead. In ONE transaction it locks the lead row (serializing
   * concurrent buyers of that lead), re-checks the lead is still PUBLISHED,
   * enforces `maxBuyers` against active (PENDING_PAYMENT + CONFIRMED)
   * purchases (NULL = not enforced), then inserts. Throws
   * LeadNotPurchasableError, LeadBuyerLimitReachedError or
   * DuplicateActiveLeadPurchaseError (the partial unique index stays the
   * final arbiter).
   */
  initiate(data: CreateLeadPurchaseData): Promise<LeadPurchaseRecord>;
  /**
   * Module 126 — atomic `from -> to` transition, conditional on the current
   * status AND validated against the domain state machine. Stamps the
   * matching timestamp. Returns the updated record, or `null` when the row
   * was not in `from` (missing, or a concurrent transition won) — the caller
   * re-reads to distinguish an idempotent repeat from a rejected transition.
   */
  transition(id: string, from: LeadPurchaseStatus, to: LeadPurchaseStatus, now: Date): Promise<LeadPurchaseRecord | null>;

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
