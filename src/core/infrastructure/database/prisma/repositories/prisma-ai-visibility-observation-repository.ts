import type { Prisma } from "@prisma/client";

import { prisma } from "@/infrastructure/database/prisma/client";
import type {
  AiVisibilityObservationRecord,
  AiVisibilityObservationRepository,
  ListAiVisibilityObservationsOptions,
  RecordAiVisibilityObservationData,
} from "@/domain/repositories/ai-visibility-observation-repository";

const SELECT = {
  id: true,
  queryId: true,
  provider: true,
  providerModel: true,
  observedAt: true,
  recordedByUserId: true,
  evaluationRulesVersion: true,
  mentioned: true,
  identityAccuracy: true,
  geographicAccuracy: true,
  serviceAccuracy: true,
  urlAccuracy: true,
  citationPresent: true,
  citationCorrect: true,
  recommendationClassification: true,
  detectedCompetitors: true,
  factualIssues: true,
  evaluatorNotes: true,
  evidenceType: true,
  evidenceReference: true,
  evidenceExcerpt: true,
  createdAt: true,
} as const;

type Row = Prisma.AiVisibilityObservationGetPayload<{ select: typeof SELECT }>;

/** Both `detectedCompetitors` and `factualIssues` are persisted as a
 *  plain JSON string array (see the Prisma model's own doc comment) —
 *  this repository is the one place that (de)serializes them, so no
 *  caller elsewhere needs to know the storage representation. */
function toStringArray(value: Prisma.JsonValue | null): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function toRecord(row: Row): AiVisibilityObservationRecord {
  return {
    id: row.id,
    queryId: row.queryId,
    provider: row.provider,
    providerModel: row.providerModel,
    observedAt: row.observedAt,
    recordedByUserId: row.recordedByUserId,
    evaluationRulesVersion: row.evaluationRulesVersion,
    mentioned: row.mentioned,
    identityAccuracy: row.identityAccuracy,
    geographicAccuracy: row.geographicAccuracy,
    serviceAccuracy: row.serviceAccuracy,
    urlAccuracy: row.urlAccuracy,
    citationPresent: row.citationPresent,
    citationCorrect: row.citationCorrect,
    recommendationClassification: row.recommendationClassification,
    detectedCompetitors: toStringArray(row.detectedCompetitors),
    factualIssues: toStringArray(row.factualIssues),
    evaluatorNotes: row.evaluatorNotes,
    evidenceType: row.evidenceType,
    evidenceReference: row.evidenceReference,
    evidenceExcerpt: row.evidenceExcerpt,
    createdAt: row.createdAt,
  };
}

/**
 * Module 119 — AI Recommendation Monitoring: Prisma implementation of
 * `AiVisibilityObservationRepository`, backed by the new, append-only
 * `AiVisibilityObservation` model (see `prisma/schema.prisma`'s own doc
 * comment on that model for why it is a new table rather than reusing
 * `AuditLog` — a monitoring observation has a materially different,
 * much wider shape than a generic actor/action/target audit entry, and
 * forcing it into `AuditLog.metadata` would make every one of Module
 * 119's own reporting queries (Phase 9) an unindexed JSON scan).
 *
 * No `update`/`delete` method exists — see the repository interface's
 * own doc comment.
 */
export class PrismaAiVisibilityObservationRepository implements AiVisibilityObservationRepository {
  async record(data: RecordAiVisibilityObservationData): Promise<AiVisibilityObservationRecord> {
    const row = await prisma.aiVisibilityObservation.create({
      data: {
        queryId: data.queryId,
        provider: data.provider,
        providerModel: data.providerModel,
        observedAt: data.observedAt,
        recordedByUserId: data.recordedByUserId,
        evaluationRulesVersion: data.evaluationRulesVersion,
        mentioned: data.mentioned,
        identityAccuracy: data.identityAccuracy,
        geographicAccuracy: data.geographicAccuracy,
        serviceAccuracy: data.serviceAccuracy,
        urlAccuracy: data.urlAccuracy,
        citationPresent: data.citationPresent,
        citationCorrect: data.citationCorrect,
        recommendationClassification: data.recommendationClassification,
        detectedCompetitors: data.detectedCompetitors as Prisma.InputJsonValue,
        factualIssues: data.factualIssues as Prisma.InputJsonValue,
        evaluatorNotes: data.evaluatorNotes,
        evidenceType: data.evidenceType,
        evidenceReference: data.evidenceReference,
        evidenceExcerpt: data.evidenceExcerpt,
      },
      select: SELECT,
    });
    return toRecord(row);
  }

  async list(options: ListAiVisibilityObservationsOptions): Promise<AiVisibilityObservationRecord[]> {
    const rows = await prisma.aiVisibilityObservation.findMany({
      select: SELECT,
      where: {
        queryId: options.queryId,
        provider: options.provider,
        observedAt: {
          gte: options.observedFrom,
          lte: options.observedTo,
        },
      },
      // `id desc` tiebreak, same reasoning as
      // PrismaAdminAuditLogRepository.list's own doc comment — createdAt
      // alone does not guarantee a deterministic order for two rows
      // written in the same millisecond.
      orderBy: [{ observedAt: "desc" }, { id: "desc" }],
      take: options.limit,
      skip: options.offset,
    });
    return rows.map(toRecord);
  }

  async listForPeriod(period: { from: Date | null; to: Date | null }): Promise<AiVisibilityObservationRecord[]> {
    const rows = await prisma.aiVisibilityObservation.findMany({
      select: SELECT,
      where: {
        observedAt: {
          gte: period.from ?? undefined,
          lte: period.to ?? undefined,
        },
      },
      orderBy: [{ observedAt: "desc" }, { id: "desc" }],
    });
    return rows.map(toRecord);
  }
}
