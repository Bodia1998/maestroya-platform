import { NotFoundError } from "@/domain/errors/domain-error";
import type { ReconciliationRunRecord, ReconciliationRunRepository } from "@/domain/repositories/reconciliation-repository";

/** Module 80 — Financial Reconciliation & Observability. Read-only. */
export class GetReconciliationRunUseCase {
  constructor(private readonly runs: ReconciliationRunRepository) {}

  async execute(runId: string): Promise<ReconciliationRunRecord> {
    const run = await this.runs.findById(runId);
    if (!run) throw new NotFoundError("ReconciliationRun", runId);
    return run;
  }
}
