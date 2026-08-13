import type { ProfessionalVerificationRepository } from "@/domain/repositories/professional-verification-repository";
import type { RefreshVerificationStatusUseCase } from "@/application/use-cases/verification/refresh-verification-status.use-case";

export interface SynchronizeVerificationSummary {
  checked: number;
  changed: number;
  failed: number;
  errors: { verificationId: string; message: string }[];
}

/**
 * Module 59 — Professional Verification (Persona): the batch
 * "SynchronizeVerification" use case from the module brief. Runs
 * `RefreshVerificationStatusUseCase` over every case
 * `ProfessionalVerificationRepository.findSyncable()` returns — every
 * PERSONA-provider case still awaiting a decision — so an operator (via
 * `npm run verification-report`, or in the future a scheduled cron
 * mirroring `RunWorkflowExpirationsUseCase`) can pull decisions for the
 * whole PENDING/UNDER_REVIEW queue in one call, rather than relying solely
 * on `RefreshVerificationStatusUseCase` being called one case at a time
 * from the professional's own dashboard.
 *
 * One case's provider failure (network error, provider outage) never
 * aborts the batch — recorded in `errors` and counted in `failed`,
 * exactly the same "one bad record doesn't stop the run" guarantee
 * `ExpireProfessionalVerificationsUseCase`'s own per-record try/catches
 * give the expiration batch.
 */
export class SynchronizeVerificationUseCase {
  constructor(
    private readonly verifications: ProfessionalVerificationRepository,
    private readonly refresh: RefreshVerificationStatusUseCase,
  ) {}

  async execute(): Promise<SynchronizeVerificationSummary> {
    const candidates = await this.verifications.findSyncable();
    const summary: SynchronizeVerificationSummary = { checked: 0, changed: 0, failed: 0, errors: [] };

    for (const candidate of candidates) {
      summary.checked += 1;
      try {
        const result = await this.refresh.execute(candidate.id);
        if (result.changed) summary.changed += 1;
      } catch (error) {
        summary.failed += 1;
        summary.errors.push({
          verificationId: candidate.id,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return summary;
  }
}
