import type {
  ReconciliationDiscrepancyRecord,
  ReconciliationDiscrepancyRepository,
} from "@/domain/repositories/reconciliation-repository";

/** Module 80 — Financial Reconciliation & Observability. Read-only. */
export class ListDiscrepanciesForRunUseCase {
  constructor(private readonly discrepancies: ReconciliationDiscrepancyRepository) {}

  async execute(runId: string, limit: number, offset: number): Promise<ReconciliationDiscrepancyRecord[]> {
    return this.discrepancies.listForRun({ runId, limit, offset });
  }
}
