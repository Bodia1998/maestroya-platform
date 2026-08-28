import type {
  DiscrepancySeverityValue,
  ReconciliationDiscrepancyRecord,
  ReconciliationDiscrepancyRepository,
} from "@/domain/repositories/reconciliation-repository";

/**
 * Module 80 — Financial Reconciliation & Observability. Read-only. The
 * default admin worklist view: every still-OPEN discrepancy at or above
 * `minSeverity` (defaults to ERROR — see the Server Action's own default
 * in reconciliation.dto.ts), newest first.
 */
export class ListUnresolvedHighSeverityDiscrepanciesUseCase {
  constructor(private readonly discrepancies: ReconciliationDiscrepancyRepository) {}

  async execute(minSeverity: DiscrepancySeverityValue, limit: number, offset: number): Promise<ReconciliationDiscrepancyRecord[]> {
    return this.discrepancies.listUnresolved({ minSeverity, limit, offset });
  }
}
