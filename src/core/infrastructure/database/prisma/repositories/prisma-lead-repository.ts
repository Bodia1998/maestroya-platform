import { Prisma } from "@prisma/client";

import { prisma } from "@/infrastructure/database/prisma/client";
import { NotFoundError } from "@/domain/errors/domain-error";
import type { CreateLeadData, LeadRecord, LeadRepository } from "@/domain/repositories/lead-repository";
import { formatScaledDecimal, parseScaledDecimal } from "@/domain/services/fixed-point-decimal";
import {
  LEAD_ELIGIBLE_REQUEST_STATUS,
  LEAD_FLOW_VERSION,
  LeadAlreadyExistsError,
  assertLeadEligibleFlow,
  isLeadStatus,
  leadStatusForRequestStatus,
  leadStatusesThatMayTransitionTo,
  normalizeLeadMaxBuyers,
} from "@/domain/services/lead";
import { assertValidLeadPublicationSnapshotData, isValidLeadPublicationSnapshotData, type LeadPublicationSnapshotData } from "@/domain/services/lead-publication";
import type { ServiceRequestStatusValue } from "@/domain/repositories/service-request-repository";
import type { TransactionFlowVersion } from "@/domain/services/transaction-flow";

/** Explicit column list. NEVER add customer/address/contact columns here —
 *  only `flowVersion` is read from the ServiceRequest. */
const SELECT = {
  id: true,
  serviceRequestId: true,
  status: true,
  maxBuyers: true,
  publishedAt: true,
  publicationPrice: true,
  publicationCurrency: true,
  publicationEstimatedJobValue: true,
  publicationPricingRate: true,
  publicationPricingConfidence: true,
  publicationPricingConfigVersion: true,
  publicationJobValueRuleVersion: true,
  publicationPricingRuleVersion: true,
  publicationBuyerPolicyVersion: true,
  createdAt: true,
  updatedAt: true,
  serviceRequest: { select: { flowVersion: true } },
} as const;

/** Prisma.Decimal is read through its exact decimal string; never converted to a JS number. */
type DecimalLike = { toString(): string };

type Row = {
  id: string;
  serviceRequestId: string;
  status: string;
  maxBuyers: number | null;
  publishedAt: Date | null;
  publicationPrice: DecimalLike | null;
  publicationCurrency: string | null;
  publicationEstimatedJobValue: DecimalLike | null;
  publicationPricingRate: DecimalLike | null;
  publicationPricingConfidence: string | null;
  publicationPricingConfigVersion: string | null;
  publicationJobValueRuleVersion: string | null;
  publicationPricingRuleVersion: string | null;
  publicationBuyerPolicyVersion: string | null;
  createdAt: Date;
  updatedAt: Date;
  serviceRequest: { flowVersion: string };
};

/** Exact Decimal -> normalised decimal string (fixed-point parse, no floating point). */
function exactDecimal(value: DecimalLike, scale: number, minFraction: number, column: string): string {
  const parsed = parseScaledDecimal(value.toString(), scale);
  if (parsed === null) throw new Error(`Lead ${column} is not a valid Decimal(${scale}).`);
  return formatScaledDecimal(parsed, scale, minFraction);
}

function toPublication(row: Row): LeadRecord["publication"] {
  const columns = [
    row.publishedAt,
    row.publicationPrice,
    row.publicationCurrency,
    row.publicationEstimatedJobValue,
    row.publicationPricingRate,
    row.publicationPricingConfidence,
    row.publicationPricingConfigVersion,
    row.publicationJobValueRuleVersion,
    row.publicationPricingRuleVersion,
    row.publicationBuyerPolicyVersion,
  ];
  if (columns.every((c) => c === null)) return null;
  // The migration's CHECK makes a partial snapshot impossible; if one ever appears it is corruption, never "no snapshot".
  if (columns.some((c) => c === null) || row.maxBuyers === null) throw new Error(`Lead "${row.id}" has an incomplete publication snapshot.`);
  const data = {
    price: exactDecimal(row.publicationPrice!, 2, 2, "publicationPrice"),
    currency: row.publicationCurrency,
    estimatedJobValue: exactDecimal(row.publicationEstimatedJobValue!, 2, 2, "publicationEstimatedJobValue"),
    pricingRate: exactDecimal(row.publicationPricingRate!, 6, 2, "publicationPricingRate"),
    pricingConfidence: row.publicationPricingConfidence,
    pricingConfigVersion: row.publicationPricingConfigVersion,
    jobValueRuleVersion: row.publicationJobValueRuleVersion,
    pricingRuleVersion: row.publicationPricingRuleVersion,
    buyerPolicyVersion: row.publicationBuyerPolicyVersion,
    maxBuyers: row.maxBuyers,
  };
  if (!isValidLeadPublicationSnapshotData(data)) throw new Error(`Lead "${row.id}" has an invalid publication snapshot.`);
  return { ...data, publishedAt: row.publishedAt! };
}

function toRecord(row: Row): LeadRecord {
  if (!isLeadStatus(row.status)) throw new Error(`Unknown Lead status "${row.status}".`);
  return {
    id: row.id,
    serviceRequestId: row.serviceRequestId,
    status: row.status,
    flowVersion: row.serviceRequest.flowVersion as TransactionFlowVersion,
    maxBuyers: row.maxBuyers,
    publication: toPublication(row),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Module 130 — ServiceRequest -> Lead propagation, run INSIDE the caller's
 * transaction (PrismaServiceRequestRepository.updateStatus) so the request
 * status and the lead status commit or roll back together.
 *
 * Deterministic: the target comes from the domain rule
 * `leadStatusForRequestStatus`. Idempotent and race-safe: a single
 * status-conditional `updateMany` that only moves leads whose current status
 * may legally transition to the target (DRAFT/PUBLISHED); terminal leads, and
 * a repeat of the same propagation, match 0 rows. Scoped to the request's own
 * lead and to LEAD_V1 (a legacy request can never have a lead; the filter
 * makes that boundary explicit). Touches only `leads.status` — never
 * LeadPurchase, Quote, Payment, Commission or Payout.
 *
 * Returns the number of leads moved (0 or 1).
 */
export async function propagateServiceRequestStatusToLead(
  tx: Pick<Prisma.TransactionClient, "lead">,
  serviceRequestId: string,
  requestStatus: ServiceRequestStatusValue,
): Promise<number> {
  const target = leadStatusForRequestStatus(requestStatus);
  if (target === null) return 0;
  const { count } = await tx.lead.updateMany({
    where: {
      serviceRequestId,
      status: { in: leadStatusesThatMayTransitionTo(target) },
      serviceRequest: { flowVersion: LEAD_FLOW_VERSION },
    },
    data: { status: target },
  });
  return count;
}

/**
 * Module 123 — Prisma implementation of `LeadRepository`. `create` is the
 * ONLY write path for the `leads` table; it enforces "Lead -> LEAD_V1" by
 * reading the ServiceRequest's flowVersion in the same transaction as the
 * insert (a static contract test forbids other `lead.create` call sites).
 */
export class PrismaLeadRepository implements LeadRepository {
  async create(data: CreateLeadData): Promise<LeadRecord> {
    const maxBuyers = normalizeLeadMaxBuyers(data.maxBuyers);
    try {
      const row = await prisma.$transaction(async (tx) => {
        const request = await tx.serviceRequest.findUnique({
          where: { id: data.serviceRequestId },
          select: { flowVersion: true, deletedAt: true },
        });
        if (!request || request.deletedAt) throw new NotFoundError("ServiceRequest", data.serviceRequestId);
        assertLeadEligibleFlow(request.flowVersion);
        return tx.lead.create({
          data: { serviceRequestId: data.serviceRequestId, maxBuyers },
          select: SELECT,
        });
      });
      return toRecord(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new LeadAlreadyExistsError(data.serviceRequestId);
      }
      throw error;
    }
  }

  /**
   * Module 133: status and snapshot are written by ONE conditional UPDATE, so
   * a Lead can never be PUBLISHED without its snapshot (nor the reverse), and
   * only the first of several concurrent publishes matches. The condition
   * also re-checks, in the same statement, that the Lead is still DRAFT, has
   * no snapshot yet, and that its request is still an open, non-deleted
   * LEAD_V1 request. A terminal Lead, an already-published Lead (its snapshot
   * and maxBuyers are never overwritten) or a closed request match 0 rows.
   * The migration's CHECKs and immutability trigger back this up in the DB.
   */
  async publish(id: string, snapshot: LeadPublicationSnapshotData): Promise<LeadRecord | null> {
    assertValidLeadPublicationSnapshotData(snapshot);
    const { count } = await prisma.lead.updateMany({
      where: {
        id,
        status: "DRAFT",
        publishedAt: null,
        serviceRequest: { flowVersion: LEAD_FLOW_VERSION, deletedAt: null, status: LEAD_ELIGIBLE_REQUEST_STATUS },
      },
      data: {
        status: "PUBLISHED",
        publishedAt: new Date(),
        publicationPrice: snapshot.price,
        publicationCurrency: snapshot.currency,
        publicationEstimatedJobValue: snapshot.estimatedJobValue,
        publicationPricingRate: snapshot.pricingRate,
        publicationPricingConfidence: snapshot.pricingConfidence,
        publicationPricingConfigVersion: snapshot.pricingConfigVersion,
        publicationJobValueRuleVersion: snapshot.jobValueRuleVersion,
        publicationPricingRuleVersion: snapshot.pricingRuleVersion,
        publicationBuyerPolicyVersion: snapshot.buyerPolicyVersion,
        maxBuyers: snapshot.maxBuyers,
      },
    });
    if (count === 0) return null;
    return this.findById(id);
  }

  async findById(id: string): Promise<LeadRecord | null> {
    const row = await prisma.lead.findUnique({ where: { id }, select: SELECT });
    return row ? toRecord(row) : null;
  }

  async findByServiceRequestId(serviceRequestId: string): Promise<LeadRecord | null> {
    const row = await prisma.lead.findUnique({ where: { serviceRequestId }, select: SELECT });
    return row ? toRecord(row) : null;
  }
}
