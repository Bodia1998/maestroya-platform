import type { ListDiscrepanciesInput } from "@/application/dto/reconciliation.dto";
import type {
  ReconciliationDiscrepancyRecord,
  ReconciliationDiscrepancyRepository,
} from "@/domain/repositories/reconciliation-repository";

/**
 * Module 81 — Reconciliation Admin Dashboard & Operations. Read-only.
 * Backs the admin Discrepancies investigation table's filters (resolution
 * status, severity, category, entity type, detected-at date range) —
 * see `ReconciliationDiscrepancyRepository.list`'s own doc comment for why
 * this exists alongside `ListDiscrepanciesForRunUseCase`/
 * `ListUnresolvedHighSeverityDiscrepanciesUseCase` rather than replacing
 * either of them (both cover one fixed, already-relied-upon shape).
 */
export class ListDiscrepanciesUseCase {
  constructor(private readonly discrepancies: ReconciliationDiscrepancyRepository) {}

  async execute(input: ListDiscrepanciesInput): Promise<ReconciliationDiscrepancyRecord[]> {
    return this.discrepancies.list(input);
  }
}
