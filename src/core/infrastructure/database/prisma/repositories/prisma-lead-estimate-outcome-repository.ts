import { Prisma } from "@prisma/client";

import { prisma } from "@/infrastructure/database/prisma/client";
import type { LeadEstimateObservationReader, LeadEstimateOutcomeRepository } from "@/domain/repositories/lead-estimate-outcome-repository";
import { formatScaledDecimal, parseScaledDecimal } from "@/domain/services/fixed-point-decimal";
import { isLeadCalibrationProvenance } from "@/domain/services/lead-calibrated-estimate";
import type { EstimateObservation } from "@/domain/services/lead-estimate-accuracy";
import { LEAD_ESTIMATE_OUTCOME_SOURCES, type LeadEstimateOutcomeRecord, type LeadEstimateOutcomeSource } from "@/domain/services/lead-estimate-outcome";

const SELECT = { id: true, leadId: true, actualJobValue: true, source: true, recordedByUserId: true, recordedAt: true, note: true } as const;

type Row = {
  id: string;
  leadId: string;
  actualJobValue: { toString(): string };
  source: string;
  recordedByUserId: string | null;
  recordedAt: Date;
  note: string | null;
};

function toRecord(row: Row): LeadEstimateOutcomeRecord {
  const cents = parseScaledDecimal(row.actualJobValue.toString(), 2);
  if (cents === null) throw new Error(`Outcome "${row.id}" has an invalid actual job value.`);
  if (!(LEAD_ESTIMATE_OUTCOME_SOURCES as readonly string[]).includes(row.source)) throw new Error(`Outcome "${row.id}" has an unknown source.`);
  if (row.recordedByUserId === null) throw new Error(`Outcome "${row.id}" has no recorder.`);
  return {
    id: row.id,
    leadId: row.leadId,
    actualJobValue: formatScaledDecimal(cents, 2, 2),
    source: row.source as LeadEstimateOutcomeSource,
    recordedByUserId: row.recordedByUserId,
    recordedAt: row.recordedAt,
    note: row.note,
  };
}

/** Module 164 — Prisma implementation of the actual-job-value store (table `lead_estimate_outcomes`). */
export class PrismaLeadEstimateOutcomeRepository implements LeadEstimateOutcomeRepository, LeadEstimateObservationReader {
  async record(input: Parameters<LeadEstimateOutcomeRepository["record"]>[0]) {
    try {
      const row = await prisma.leadEstimateOutcome.create({
        data: {
          leadId: input.leadId,
          actualJobValue: input.actualJobValue,
          source: input.source,
          recordedByUserId: input.recordedByUserId,
          recordedAt: input.recordedAt,
          note: input.note,
        },
        select: SELECT,
      });
      return { outcome: toRecord(row), created: true };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const existing = await this.findByLeadId(input.leadId);
        if (existing) return { outcome: existing, created: false };
      }
      throw error;
    }
  }

  async findByLeadId(leadId: string): Promise<LeadEstimateOutcomeRecord | null> {
    const row = await prisma.leadEstimateOutcome.findUnique({ where: { leadId }, select: SELECT });
    return row ? toRecord(row) : null;
  }

  /**
   * Published estimates joined to recorded outcomes. Only leads with BOTH a snapshot and an outcome appear; nothing is inferred
   * for the rest. The province comes from the snapshot's calibration provenance (so it is the province the price was based on);
   * leads priced by the Module 132 pipeline have none.
   */
  async listObservations(limit: number): Promise<EstimateObservation[]> {
    const take = Number.isSafeInteger(limit) && limit > 0 && limit <= 100_000 ? limit : 10_000;
    const rows = await prisma.leadEstimateOutcome.findMany({ orderBy: { recordedAt: "asc" }, take, select: { leadId: true, actualJobValue: true } });
    if (rows.length === 0) return [];
    const leads = await prisma.lead.findMany({
      where: { id: { in: rows.map((r) => r.leadId) }, publishedAt: { not: null } },
      select: {
        id: true,
        publicationEstimatedJobValue: true,
        publicationPricingConfidence: true,
        publicationPricingConfigVersion: true,
        publicationScopeQuestionnaireVersion: true,
        publicationCalibrationProvenance: true,
        serviceRequest: { select: { category: { select: { slug: true } } } },
      },
    });
    const actualByLead = new Map(rows.map((r) => [r.leadId, r.actualJobValue.toString()]));
    const observations: EstimateObservation[] = [];
    for (const lead of leads) {
      const actual = actualByLead.get(lead.id);
      if (actual === undefined || lead.publicationEstimatedJobValue === null || lead.publicationPricingConfigVersion === null) continue;
      const provenance = isLeadCalibrationProvenance(lead.publicationCalibrationProvenance) ? lead.publicationCalibrationProvenance : null;
      observations.push({
        id: lead.id,
        estimate: lead.publicationEstimatedJobValue.toString(),
        actual,
        categorySlug: lead.serviceRequest.category.slug,
        provinceCode: provenance?.provinceCode ?? null,
        confidenceBand: lead.publicationPricingConfidence,
        questionnaireVersion: lead.publicationScopeQuestionnaireVersion,
        calibrationVersion: lead.publicationPricingConfigVersion,
      });
    }
    return observations;
  }
}
