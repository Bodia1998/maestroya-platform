import type { LeadStatus } from "@/domain/services/lead";
import type { LeadPurchaseStatus } from "@/domain/services/lead-purchase";
import type { LeadQualityClaimReasonCode, LeadQualityClaimStatus } from "@/domain/services/lead-quality-claim";
import type { LeadFeeDisputeEvidenceStatus, LeadFeeDisputeStatus } from "@/domain/services/lead-fee-dispute";
import type {
  LeadAbuseDecisionAction,
  LeadAbuseDecisionOrigin,
  LeadAbuseDecisionStatus,
  LeadAbuseReliability,
  LeadAbuseRestrictedAction,
  LeadAbuseSeverity,
  LeadAbuseSignalType,
} from "@/domain/services/lead-abuse-controls";

/**
 * Module 157 — READ-ONLY port of the Lead Admin Operations Console.
 *
 * It projects rows other modules own (M123 leads / purchases, M154 claims, M155 disputes and revocations, M156 signals and decisions,
 * and the append-only audit trail) for operators. Like the Admin Panel's `AdminRepository` (Module 16), it is an oversight layer that
 * reads ACROSS aggregates; it deliberately has NO write method, so an implementation cannot mutate domain state through it. Every
 * state change goes through the owning module's use case.
 *
 * PRIVACY (decision D26): no record below has a field for a name, e-mail, phone, address line, request title/description, payment
 * provider reference or evidence text. Parties are opaque ids. Implementations must select explicit columns only.
 */

export interface AdminLeadListQuery {
  /** Exact lead id. */
  leadId?: string;
  status?: LeadStatus;
  /** Leads that have at least one purchase in this status. */
  purchaseStatus?: LeadPurchaseStatus;
  categoryId?: string;
  /** Province of the request's address (case-insensitive, exact). */
  region?: string;
  city?: string;
  createdFrom?: Date;
  createdTo?: Date;
  limit: number;
  offset: number;
}

export interface AdminLeadListRow {
  id: string;
  status: LeadStatus;
  createdAt: Date;
  publishedAt: Date | null;
  maxBuyers: number | null;
  categoryId: string;
  categoryName: string;
  city: string | null;
  province: string | null;
  /** Published fee snapshot (a persisted fact). Null when never published. */
  publicationPrice: string | null;
  publicationCurrency: string | null;
  /** Counts of this lead's purchases by status (persisted facts), capped by the reader. */
  purchaseCounts: Partial<Record<LeadPurchaseStatus, number>>;
  openClaims: number;
  openDisputes: number;
  revokedPurchases: number;
}

export interface AdminLeadDetailPurchase {
  id: string;
  professionalProfileId: string;
  professionalUserId: string;
  status: LeadPurchaseStatus;
  price: string;
  currency: string;
  taxAmount: string | null;
  totalAmount: string | null;
  hasPaymentReference: boolean;
  createdAt: Date;
  confirmedAt: Date | null;
  failedAt: Date | null;
  cancelledAt: Date | null;
  refundedAt: Date | null;
  revokedAt: Date | null;
}

export interface AdminLeadDetailClaim {
  id: string;
  leadPurchaseId: string;
  professionalProfileId: string;
  reasonCode: LeadQualityClaimReasonCode;
  status: LeadQualityClaimStatus;
  /** The professional's own text (conservatively validated against contact data by M154); shown to the deciding administrator only. */
  description: string;
  evidenceReference: string | null;
  submittedAt: Date;
  respondBy: Date;
  reviewStartedAt: Date | null;
  reviewStartedByUserId: string | null;
  decidedAt: Date | null;
  decidedByUserId: string | null;
  decisionExplanation: string | null;
}

export interface AdminLeadDetailDispute {
  id: string;
  providerDisputeId: string;
  leadPurchaseId: string;
  status: LeadFeeDisputeStatus;
  amount: string;
  currency: string;
  reason: string | null;
  evidenceDueBy: Date | null;
  openedAt: Date;
  closedAt: Date | null;
  evidenceStatus: LeadFeeDisputeEvidenceStatus;
  evidenceReference: string | null;
  evidenceRequestedAt: Date | null;
  evidenceSubmittedAt: Date | null;
}

export interface AdminLeadDetailRevocation {
  id: string;
  leadPurchaseId: string;
  source: "ADMIN" | "DISPUTE_LOST";
  actorUserId: string | null;
  explanation: string | null;
  evidenceReference: string | null;
  leadFeeDisputeId: string | null;
  createdAt: Date;
}

export interface AdminAbuseSignalRow {
  id: string;
  subjectUserId: string;
  signalType: LeadAbuseSignalType;
  reliability: LeadAbuseReliability;
  severity: LeadAbuseSeverity;
  ruleVersion: string;
  targetLeadId: string | null;
  observedCount: number | null;
  threshold: number | null;
  windowSeconds: number | null;
  occurredAt: Date;
}

export interface AdminAbuseDecisionRow {
  id: string;
  subjectUserId: string;
  action: LeadAbuseDecisionAction;
  restrictedAction: LeadAbuseRestrictedAction | null;
  status: LeadAbuseDecisionStatus;
  origin: LeadAbuseDecisionOrigin;
  ruleKey: LeadAbuseSignalType | null;
  ruleVersion: string | null;
  reasonCode: string;
  createdByUserId: string | null;
  decidedAt: Date;
  expiresAt: Date | null;
  explanation: string | null;
  liftedAt: Date | null;
  liftedByUserId: string | null;
  resolutionNote: string | null;
}

/** One audit-trail row about an entity of this lead. Metadata is reduced to an allow-list of scalar keys. */
export interface AdminLeadAuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actorUserId: string | null;
  createdAt: Date;
  metadata: Record<string, string | number | boolean | null>;
}

export interface AdminLeadDetailRecord {
  lead: {
    id: string;
    serviceRequestId: string;
    status: LeadStatus;
    requestStatus: string;
    flowVersion: string;
    maxBuyers: number | null;
    createdAt: Date;
    updatedAt: Date;
    publishedAt: Date | null;
    publicationPrice: string | null;
    publicationCurrency: string | null;
    publicationPricingConfigVersion: string | null;
    publicationBuyerPolicyVersion: string | null;
    categoryId: string;
    categoryName: string;
    city: string | null;
    province: string | null;
    /** Opaque id of the customer's USER (for abuse-subject lookups). No name, e-mail or phone. */
    customerUserId: string;
  };
  purchases: AdminLeadDetailPurchase[];
  claims: AdminLeadDetailClaim[];
  disputes: AdminLeadDetailDispute[];
  revocations: AdminLeadDetailRevocation[];
  /** Raw event signals that targeted this very lead (probing). Heuristic evidence only. */
  signals: AdminAbuseSignalRow[];
  audit: AdminLeadAuditEntry[];
}

export interface AdminClaimQueueQuery {
  /** Default (undefined) = the open claims: SUBMITTED and UNDER_REVIEW. */
  status?: LeadQualityClaimStatus;
  limit: number;
  offset: number;
}

export interface AdminClaimQueueRow extends AdminLeadDetailClaim {
  leadId: string;
}

export interface AdminDisputeQueueQuery {
  /** Default (undefined) = the open disputes: NEEDS_RESPONSE and UNDER_REVIEW. */
  status?: LeadFeeDisputeStatus;
  limit: number;
  offset: number;
}

export interface AdminDisputeQueueRow extends AdminLeadDetailDispute {
  leadId: string;
  purchaseStatus: LeadPurchaseStatus;
}

export interface AdminAbuseSubjectRecord {
  subjectUserId: string;
  /** Newest first, bounded. */
  signals: AdminAbuseSignalRow[];
  /** Newest first, bounded: includes LIFTED and EXPIRED decisions (the decision history). */
  decisions: AdminAbuseDecisionRow[];
}

export interface LeadAdminConsoleReader {
  listLeads(query: AdminLeadListQuery): Promise<AdminLeadListRow[]>;
  /** Null when the lead does not exist. Only LEAD_V1 leads exist as `Lead` rows. */
  getLeadDetail(leadId: string): Promise<AdminLeadDetailRecord | null>;
  listClaims(query: AdminClaimQueueQuery): Promise<AdminClaimQueueRow[]>;
  listDisputes(query: AdminDisputeQueueQuery): Promise<AdminDisputeQueueRow[]>;
  /** Null when the user does not exist. */
  getAbuseSubject(subjectUserId: string): Promise<AdminAbuseSubjectRecord | null>;
}
