import { Prisma } from "@prisma/client";

import { prisma } from "@/infrastructure/database/prisma/client";
import type { LeadPricingReviewRepository } from "@/domain/repositories/lead-pricing-review-repository";
import { REVIEW_REASON_CODES, isLeadCalibrationProvenance, type ReviewReasonCode } from "@/domain/services/lead-calibrated-estimate";
import { formatScaledDecimal, parseScaledDecimal } from "@/domain/services/fixed-point-decimal";
import {
  LEAD_PRICING_REVIEW_STATUSES,
  type LeadPricingReviewDecision,
  type LeadPricingReviewRecord,
  type LeadPricingReviewStatus,
  type OpenLeadPricingReviewInput,
} from "@/domain/services/lead-pricing-review";

/** Explicit column list. Ids, codes, slugs, a two-digit province code and provenance JSON only. */
const SELECT = {
  id: true,
  leadId: true,
  inputFingerprint: true,
  status: true,
  reasonCodes: true,
  categorySlug: true,
  parentCategorySlug: true,
  provinceCode: true,
  calibrationVersion: true,
  provenance: true,
  decidedAt: true,
  decidedByUserId: true,
  reviewedJobValue: true,
  decisionNote: true,
  createdAt: true,
} as const;

type Row = {
  id: string;
  leadId: string;
  inputFingerprint: string;
  status: string;
  reasonCodes: string[];
  categorySlug: string;
  parentCategorySlug: string | null;
  provinceCode: string;
  calibrationVersion: string;
  provenance: unknown;
  decidedAt: Date | null;
  decidedByUserId: string | null;
  reviewedJobValue: { toString(): string } | null;
  decisionNote: string | null;
  createdAt: Date;
};

function toRecord(row: Row): LeadPricingReviewRecord {
  if (!(LEAD_PRICING_REVIEW_STATUSES as readonly string[]).includes(row.status)) throw new Error(`Unknown lead pricing review status "${row.status}".`);
  if (!row.reasonCodes.every((r) => (REVIEW_REASON_CODES as readonly string[]).includes(r))) throw new Error(`Review "${row.id}" has an unknown reason code.`);
  // Stored JSON is untrusted until re-validated (defence in depth: the writer already validated it).
  if (!isLeadCalibrationProvenance(row.provenance)) throw new Error(`Review "${row.id}" has invalid provenance.`);
  let reviewedJobValue: string | null = null;
  if (row.reviewedJobValue !== null) {
    const parsed = parseScaledDecimal(row.reviewedJobValue.toString(), 2);
    if (parsed === null) throw new Error(`Review "${row.id}" has an invalid reviewed job value.`);
    reviewedJobValue = formatScaledDecimal(parsed, 2, 2);
  }
  return {
    id: row.id,
    leadId: row.leadId,
    inputFingerprint: row.inputFingerprint,
    status: row.status as LeadPricingReviewStatus,
    reasonCodes: row.reasonCodes as ReviewReasonCode[],
    categorySlug: row.categorySlug,
    parentCategorySlug: row.parentCategorySlug,
    provinceCode: row.provinceCode,
    calibrationVersion: row.calibrationVersion,
    provenance: row.provenance,
    createdAt: row.createdAt,
    decidedAt: row.decidedAt,
    decidedByUserId: row.decidedByUserId,
    reviewedJobValue,
    decisionNote: row.decisionNote,
  };
}

const isUniqueViolation = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

/** Module 164 — Prisma implementation of `LeadPricingReviewRepository` (table `lead_pricing_reviews`). */
export class PrismaLeadPricingReviewRepository implements LeadPricingReviewRepository {
  /**
   * Idempotent and race-safe. Order: return the row for (lead, fingerprint) if it exists; otherwise, in ONE transaction,
   * supersede this lead's still-pending reviews of OTHER fingerprints (their inputs changed) and insert the new pending row.
   * Two concurrent callers with the same inputs: one inserts, the other hits the unique constraint and reads the winner's row.
   * Two concurrent callers with different inputs: the partial unique index (one pending per lead) lets one win; the loser retries
   * and then supersedes the winner's now-stale row.
   */
  async openOrGet(input: OpenLeadPricingReviewInput): Promise<{ review: LeadPricingReviewRecord; created: boolean }> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const existing = await prisma.leadPricingReview.findUnique({
        where: { leadId_inputFingerprint: { leadId: input.leadId, inputFingerprint: input.inputFingerprint } },
        select: SELECT,
      });
      if (existing) return { review: toRecord(existing), created: false };

      try {
        const row = await prisma.$transaction(async (tx) => {
          await tx.leadPricingReview.updateMany({
            where: { leadId: input.leadId, status: "PENDING_REVIEW", inputFingerprint: { not: input.inputFingerprint } },
            data: { status: "SUPERSEDED", decidedAt: new Date() },
          });
          return tx.leadPricingReview.create({
            data: {
              leadId: input.leadId,
              inputFingerprint: input.inputFingerprint,
              reasonCodes: [...input.reasonCodes],
              categorySlug: input.categorySlug,
              parentCategorySlug: input.parentCategorySlug,
              provinceCode: input.provinceCode,
              calibrationVersion: input.calibrationVersion,
              provenance: input.provenance as unknown as Prisma.InputJsonValue,
            },
            select: SELECT,
          });
        });
        return { review: toRecord(row), created: true };
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        // Lost a race: loop re-reads the winner (same fingerprint) or retries the supersede (different fingerprint).
      }
    }
    throw new Error("Could not open the lead pricing review after concurrent attempts.");
  }

  async findByLeadAndFingerprint(leadId: string, inputFingerprint: string): Promise<LeadPricingReviewRecord | null> {
    const row = await prisma.leadPricingReview.findUnique({ where: { leadId_inputFingerprint: { leadId, inputFingerprint } }, select: SELECT });
    return row ? toRecord(row) : null;
  }

  async findById(id: string): Promise<LeadPricingReviewRecord | null> {
    const row = await prisma.leadPricingReview.findUnique({ where: { id }, select: SELECT });
    return row ? toRecord(row) : null;
  }

  async list(filter: { status: LeadPricingReviewStatus | null; limit: number; offset: number }): Promise<LeadPricingReviewRecord[]> {
    const rows = await prisma.leadPricingReview.findMany({
      where: filter.status ? { status: filter.status } : {},
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: filter.limit,
      skip: filter.offset,
      select: SELECT,
    });
    return rows.map(toRecord);
  }

  async decide(id: string, decision: LeadPricingReviewDecision, actorUserId: string, decidedAt: Date): Promise<LeadPricingReviewRecord | null> {
    // Status-conditional: the first decision wins; any later one matches 0 rows.
    const { count } = await prisma.leadPricingReview.updateMany({
      where: { id, status: "PENDING_REVIEW" },
      data:
        decision.outcome === "APPROVED"
          ? { status: "APPROVED", decidedAt, decidedByUserId: actorUserId, reviewedJobValue: decision.reviewedJobValue, decisionNote: decision.note }
          : { status: "REJECTED", decidedAt, decidedByUserId: actorUserId, decisionNote: decision.note },
    });
    if (count === 0) return null;
    return this.findById(id);
  }
}
