import { PrismaAiVisibilityObservationRepository } from "@/infrastructure/database/prisma/repositories/prisma-ai-visibility-observation-repository";
import { RecordAiVisibilityObservationUseCase } from "@/application/use-cases/ai-visibility/record-observation.use-case";
import { ListAiVisibilityObservationsUseCase } from "@/application/use-cases/ai-visibility/list-observations.use-case";
import { GetAiVisibilityMetricsUseCase } from "@/application/use-cases/ai-visibility/get-ai-visibility-metrics.use-case";

/**
 * Module 119 — AI Recommendation Monitoring: composition root — same
 * "one shared repository instance, one factory function per use case"
 * convention as `admin/compose.ts`.
 */

const observations = new PrismaAiVisibilityObservationRepository();

export function makeRecordAiVisibilityObservationUseCase(): RecordAiVisibilityObservationUseCase {
  return new RecordAiVisibilityObservationUseCase(observations);
}

export function makeListAiVisibilityObservationsUseCase(): ListAiVisibilityObservationsUseCase {
  return new ListAiVisibilityObservationsUseCase(observations);
}

export function makeGetAiVisibilityMetricsUseCase(): GetAiVisibilityMetricsUseCase {
  return new GetAiVisibilityMetricsUseCase(observations);
}
