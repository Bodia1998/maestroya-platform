import type { Prisma } from "@prisma/client";

import { prisma } from "@/infrastructure/database/prisma/client";
import type {
  AdminAbuseDecisionRow,
  AdminAbuseSignalRow,
  AdminAbuseSubjectRecord,
  AdminClaimQueueQuery,
  AdminClaimQueueRow,
  AdminDisputeQueueQuery,
  AdminDisputeQueueRow,
  AdminLeadAuditEntry,
  AdminLeadDetailClaim,
  AdminLeadDetailDispute,
  AdminLeadDetailRecord,
  AdminLeadListQuery,
  AdminLeadListRow,
  LeadAdminConsoleReader,
} from "@/domain/repositories/lead-admin-console-reader";
import { LEAD_ADMIN_DETAIL_ROW_CAP } from "@/domain/services/lead-admin-console";
import type { LeadPurchaseStatus } from "@/domain/services/lead-purchase";

/**
 * Module 157 — Prisma implementation of the READ-ONLY lead console port.
 *
 * READ-ONLY BY CONSTRUCTION: this file calls `findMany` / `findFirst` / `findUnique` only — no create, update, upsert, delete, raw
 * statement or transaction (a static test pins that). It owns no table and adds no schema object; it projects rows that M123, M154,
 * M155, M156 and the audit trail own.
 *
 * PRIVACY (D26): every query selects an explicit column list. Nothing selects a user's name / e-mail / phone, an address line, the
 * request title or description, a payment-provider reference or the dispute evidence text. The customer and the professionals appear
 * as opaque user ids only.
 *
 * Every list is bounded: pages by `limit` (<= 100, enforced by the use case) and detail sub-lists by LEAD_ADMIN_DETAIL_ROW_CAP.
 */

const CAP = LEAD_ADMIN_DETAIL_ROW_CAP;
const OPEN_CLAIM_STATUSES = ["SUBMITTED", "UNDER_REVIEW"] as const;
const OPEN_DISPUTE_STATUSES = ["NEEDS_RESPONSE", "UNDER_REVIEW"] as const;
/** Purchases fetched per listed lead when counting statuses (a lead rarely has more than a handful). */
const PURCHASES_PER_LEAD_CAP = 50;

/** Audit metadata keys the console may show. Scalars only; anything else (and any free text) is dropped. */
const AUDIT_METADATA_ALLOW_LIST = [
  "adminAction",
  "fromStatus",
  "toStatus",
  "reasonCode",
  "origin",
  "ruleKey",
  "ruleVersion",
  "restrictedAction",
  "decisionAction",
  "effect",
  "source",
] as const;

const money = (value: Prisma.Decimal | null | undefined): string | null => (value === null || value === undefined ? null : value.toFixed(2));

function auditMetadata(raw: Prisma.JsonValue | null): AdminLeadAuditEntry["metadata"] {
  const out: AdminLeadAuditEntry["metadata"] = {};
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const key of AUDIT_METADATA_ALLOW_LIST) {
    const value = (raw as Record<string, Prisma.JsonValue>)[key];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") out[key] = value;
  }
  return out;
}

const CLAIM_SELECT = {
  id: true,
  leadPurchaseId: true,
  professionalProfileId: true,
  reasonCode: true,
  status: true,
  description: true,
  evidenceReference: true,
  submittedAt: true,
  respondBy: true,
  reviewStartedAt: true,
  reviewStartedByUserId: true,
  decidedAt: true,
  decidedByUserId: true,
  decisionExplanation: true,
} satisfies Prisma.LeadQualityClaimSelect;

const DISPUTE_SELECT = {
  id: true,
  providerDisputeId: true,
  leadPurchaseId: true,
  status: true,
  amount: true,
  currency: true,
  reason: true,
  evidenceDueBy: true,
  openedAt: true,
  closedAt: true,
  evidenceStatus: true,
  evidenceReference: true,
  evidenceRequestedAt: true,
  evidenceSubmittedAt: true,
  // NOT selected: evidenceText, evidenceActorUserId, paymentReference, providerChargeId, lastProviderEventId.
} satisfies Prisma.LeadFeeDisputeSelect;

const SIGNAL_SELECT = {
  id: true,
  subjectUserId: true,
  signalType: true,
  reliability: true,
  severity: true,
  ruleVersion: true,
  targetLeadId: true,
  observedCount: true,
  threshold: true,
  windowSeconds: true,
  occurredAt: true,
} satisfies Prisma.LeadAbuseSignalSelect;

const DECISION_SELECT = {
  id: true,
  subjectUserId: true,
  action: true,
  restrictedAction: true,
  status: true,
  origin: true,
  ruleKey: true,
  ruleVersion: true,
  reasonCode: true,
  createdByUserId: true,
  decidedAt: true,
  expiresAt: true,
  explanation: true,
  liftedAt: true,
  liftedByUserId: true,
  resolutionNote: true,
} satisfies Prisma.LeadAbuseDecisionSelect;

type ClaimRow = Prisma.LeadQualityClaimGetPayload<{ select: typeof CLAIM_SELECT }>;
type DisputeRow = Prisma.LeadFeeDisputeGetPayload<{ select: typeof DISPUTE_SELECT }>;

const toClaim = (r: ClaimRow): AdminLeadDetailClaim => ({ ...r });
const toDispute = (r: DisputeRow): AdminLeadDetailDispute => ({ ...r, amount: r.amount.toFixed(2) });
const toSignal = (r: AdminAbuseSignalRow): AdminAbuseSignalRow => ({ ...r });
const toDecision = (r: AdminAbuseDecisionRow): AdminAbuseDecisionRow => ({ ...r });

export class PrismaLeadAdminConsoleReader implements LeadAdminConsoleReader {
  async listLeads(query: AdminLeadListQuery): Promise<AdminLeadListRow[]> {
    const requestWhere: Prisma.ServiceRequestWhereInput = {
      flowVersion: "LEAD_V1", // LEAD_V1 isolation: the console never lists a legacy request
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.region || query.city
        ? {
            address: {
              ...(query.region ? { province: { equals: query.region, mode: "insensitive" as const } } : {}),
              ...(query.city ? { city: { equals: query.city, mode: "insensitive" as const } } : {}),
            },
          }
        : {}),
    };
    const where: Prisma.LeadWhereInput = {
      ...(query.leadId ? { id: query.leadId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.createdFrom || query.createdTo
        ? { createdAt: { ...(query.createdFrom ? { gte: query.createdFrom } : {}), ...(query.createdTo ? { lte: query.createdTo } : {}) } }
        : {}),
      ...(query.purchaseStatus ? { purchases: { some: { status: query.purchaseStatus } } } : {}),
      serviceRequest: requestWhere,
    };

    const leads = await prisma.lead.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit,
      skip: query.offset,
      select: {
        id: true,
        status: true,
        createdAt: true,
        publishedAt: true,
        maxBuyers: true,
        publicationPrice: true,
        publicationCurrency: true,
        serviceRequest: {
          select: { categoryId: true, category: { select: { name: true } }, address: { select: { city: true, province: true } } },
        },
      },
    });
    if (leads.length === 0) return [];

    const leadIds = leads.map((l) => l.id);
    const purchases = await prisma.leadPurchase.findMany({
      where: { leadId: { in: leadIds } },
      select: { id: true, leadId: true, status: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: leadIds.length * PURCHASES_PER_LEAD_CAP,
    });
    const purchaseIds = purchases.map((p) => p.id);
    const [openClaims, openDisputes] = purchaseIds.length
      ? await Promise.all([
          prisma.leadQualityClaim.findMany({ where: { leadPurchaseId: { in: purchaseIds }, status: { in: [...OPEN_CLAIM_STATUSES] } }, select: { leadPurchaseId: true } }),
          prisma.leadFeeDispute.findMany({ where: { leadPurchaseId: { in: purchaseIds }, status: { in: [...OPEN_DISPUTE_STATUSES] } }, select: { leadPurchaseId: true } }),
        ])
      : [[], []];

    const leadOfPurchase = new Map(purchases.map((p) => [p.id, p.leadId]));
    const count = (rows: Array<{ leadPurchaseId: string }>) => {
      const m = new Map<string, number>();
      for (const r of rows) {
        const leadId = leadOfPurchase.get(r.leadPurchaseId);
        if (leadId) m.set(leadId, (m.get(leadId) ?? 0) + 1);
      }
      return m;
    };
    const claimsByLead = count(openClaims);
    const disputesByLead = count(openDisputes);

    return leads.map((l) => {
      const purchaseCounts: Partial<Record<LeadPurchaseStatus, number>> = {};
      for (const p of purchases) if (p.leadId === l.id) purchaseCounts[p.status] = (purchaseCounts[p.status] ?? 0) + 1;
      return {
        id: l.id,
        status: l.status,
        createdAt: l.createdAt,
        publishedAt: l.publishedAt,
        maxBuyers: l.maxBuyers,
        categoryId: l.serviceRequest.categoryId,
        categoryName: l.serviceRequest.category.name,
        city: l.serviceRequest.address.city,
        province: l.serviceRequest.address.province,
        publicationPrice: money(l.publicationPrice),
        publicationCurrency: l.publicationCurrency,
        purchaseCounts,
        openClaims: claimsByLead.get(l.id) ?? 0,
        openDisputes: disputesByLead.get(l.id) ?? 0,
        revokedPurchases: purchaseCounts.REVOKED ?? 0,
      };
    });
  }

  async getLeadDetail(leadId: string): Promise<AdminLeadDetailRecord | null> {
    // LEAD_V1 isolation is part of the QUERY (like listLeads): a lead whose request is in any other flow is "not found", never returned.
    const lead = await prisma.lead.findFirst({
      where: { id: leadId, serviceRequest: { flowVersion: "LEAD_V1" } },
      select: {
        id: true,
        serviceRequestId: true,
        status: true,
        maxBuyers: true,
        createdAt: true,
        updatedAt: true,
        publishedAt: true,
        publicationPrice: true,
        publicationCurrency: true,
        publicationPricingConfigVersion: true,
        publicationBuyerPolicyVersion: true,
        serviceRequest: {
          select: {
            status: true,
            flowVersion: true,
            categoryId: true,
            category: { select: { name: true } },
            address: { select: { city: true, province: true } },
            customer: { select: { userId: true } },
          },
        },
      },
    });
    if (!lead) return null;

    const purchaseRows = await prisma.leadPurchase.findMany({
      where: { leadId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: CAP,
      select: {
        id: true,
        professionalProfileId: true,
        status: true,
        price: true,
        currency: true,
        taxAmount: true,
        totalAmount: true,
        paymentReference: true, // read only to derive a boolean; never returned
        createdAt: true,
        confirmedAt: true,
        failedAt: true,
        cancelledAt: true,
        refundedAt: true,
        revokedAt: true,
        professional: { select: { userId: true } },
      },
    });
    const purchaseIds = purchaseRows.map((p) => p.id);

    const [claimRows, disputeRows, revocationRows, signalRows] = await Promise.all([
      purchaseIds.length
        ? prisma.leadQualityClaim.findMany({ where: { leadPurchaseId: { in: purchaseIds } }, select: CLAIM_SELECT, orderBy: [{ submittedAt: "asc" }, { id: "asc" }], take: CAP })
        : Promise.resolve([] as ClaimRow[]),
      purchaseIds.length
        ? prisma.leadFeeDispute.findMany({ where: { leadPurchaseId: { in: purchaseIds } }, select: DISPUTE_SELECT, orderBy: [{ openedAt: "asc" }, { id: "asc" }], take: CAP })
        : Promise.resolve([] as DisputeRow[]),
      purchaseIds.length
        ? prisma.leadPurchaseRevocation.findMany({
            where: { leadPurchaseId: { in: purchaseIds } },
            select: { id: true, leadPurchaseId: true, source: true, actorUserId: true, explanation: true, evidenceReference: true, leadFeeDisputeId: true, createdAt: true },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            take: CAP,
          })
        : Promise.resolve([]),
      prisma.leadAbuseSignal.findMany({ where: { targetLeadId: leadId }, select: SIGNAL_SELECT, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: CAP }),
    ]);

    const entityIds = [leadId, ...purchaseIds, ...claimRows.map((c) => c.id), ...disputeRows.map((d) => d.id), ...revocationRows.map((r) => r.id)];
    const auditRows = await prisma.auditLog.findMany({
      where: { entityId: { in: entityIds } },
      select: { id: true, action: true, entityType: true, entityId: true, actorUserId: true, createdAt: true, metadata: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: CAP,
    });

    const sr = lead.serviceRequest;
    return {
      lead: {
        id: lead.id,
        serviceRequestId: lead.serviceRequestId,
        status: lead.status,
        requestStatus: sr.status,
        flowVersion: sr.flowVersion,
        maxBuyers: lead.maxBuyers,
        createdAt: lead.createdAt,
        updatedAt: lead.updatedAt,
        publishedAt: lead.publishedAt,
        publicationPrice: money(lead.publicationPrice),
        publicationCurrency: lead.publicationCurrency,
        publicationPricingConfigVersion: lead.publicationPricingConfigVersion,
        publicationBuyerPolicyVersion: lead.publicationBuyerPolicyVersion,
        categoryId: sr.categoryId,
        categoryName: sr.category.name,
        city: sr.address.city,
        province: sr.address.province,
        customerUserId: sr.customer.userId,
      },
      purchases: purchaseRows.map((p) => ({
        id: p.id,
        professionalProfileId: p.professionalProfileId,
        professionalUserId: p.professional.userId,
        status: p.status,
        price: p.price.toFixed(2),
        currency: p.currency,
        taxAmount: money(p.taxAmount),
        totalAmount: money(p.totalAmount),
        hasPaymentReference: p.paymentReference !== null,
        createdAt: p.createdAt,
        confirmedAt: p.confirmedAt,
        failedAt: p.failedAt,
        cancelledAt: p.cancelledAt,
        refundedAt: p.refundedAt,
        revokedAt: p.revokedAt,
      })),
      claims: claimRows.map(toClaim),
      disputes: disputeRows.map(toDispute),
      revocations: revocationRows,
      signals: signalRows.map(toSignal),
      audit: auditRows.map((a) => ({
        id: a.id,
        action: a.action,
        entityType: a.entityType,
        entityId: a.entityId,
        actorUserId: a.actorUserId,
        createdAt: a.createdAt,
        metadata: auditMetadata(a.metadata),
      })),
    };
  }

  async listClaims(query: AdminClaimQueueQuery): Promise<AdminClaimQueueRow[]> {
    const rows = await prisma.leadQualityClaim.findMany({
      where: { status: query.status ? query.status : { in: [...OPEN_CLAIM_STATUSES] } },
      select: CLAIM_SELECT,
      orderBy: [{ respondBy: "asc" }, { id: "asc" }],
      take: query.limit,
      skip: query.offset,
    });
    if (rows.length === 0) return [];
    const purchases = await prisma.leadPurchase.findMany({ where: { id: { in: rows.map((r) => r.leadPurchaseId) } }, select: { id: true, leadId: true } });
    const leadOf = new Map(purchases.map((p) => [p.id, p.leadId]));
    return rows.map((r) => ({ ...toClaim(r), leadId: leadOf.get(r.leadPurchaseId) ?? "" }));
  }

  async listDisputes(query: AdminDisputeQueueQuery): Promise<AdminDisputeQueueRow[]> {
    const rows = await prisma.leadFeeDispute.findMany({
      where: { status: query.status ? query.status : { in: [...OPEN_DISPUTE_STATUSES] } },
      select: { ...DISPUTE_SELECT, purchase: { select: { leadId: true, status: true } } },
      orderBy: [{ openedAt: "asc" }, { id: "asc" }],
      take: query.limit,
      skip: query.offset,
    });
    return rows.map(({ purchase, ...dispute }) => ({ ...toDispute(dispute), leadId: purchase.leadId, purchaseStatus: purchase.status }));
  }

  async getAbuseSubject(subjectUserId: string): Promise<AdminAbuseSubjectRecord | null> {
    const user = await prisma.user.findFirst({ where: { id: subjectUserId, deletedAt: null }, select: { id: true } });
    if (!user) return null;
    const [signals, decisions] = await Promise.all([
      prisma.leadAbuseSignal.findMany({ where: { subjectUserId }, select: SIGNAL_SELECT, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: CAP }),
      prisma.leadAbuseDecision.findMany({ where: { subjectUserId }, select: DECISION_SELECT, orderBy: [{ decidedAt: "desc" }, { id: "desc" }], take: CAP }),
    ]);
    return { subjectUserId, signals: signals.map(toSignal), decisions: decisions.map(toDecision) };
  }
}
