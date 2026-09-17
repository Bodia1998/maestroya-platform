import type {
  AiVisibilityObservationRecord,
  AiVisibilityObservationRepository,
  ListAiVisibilityObservationsOptions,
} from "@/domain/repositories/ai-visibility-observation-repository";

/** Module 119 — AI Recommendation Monitoring: read-only, paginated access
 *  to the observation trail — same thin pass-through shape as
 *  `ListAdminAuditLogsUseCase`. No mutation of any kind exists here. */
export class ListAiVisibilityObservationsUseCase {
  constructor(private readonly observations: AiVisibilityObservationRepository) {}

  async execute(options: ListAiVisibilityObservationsOptions): Promise<AiVisibilityObservationRecord[]> {
    return this.observations.list(options);
  }
}
