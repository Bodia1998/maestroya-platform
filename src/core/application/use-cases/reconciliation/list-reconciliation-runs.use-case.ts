import type { ListReconciliationRunsInput } from "@/application/dto/reconciliation.dto";
import type { ReconciliationRunRecord, ReconciliationRunRepository } from "@/domain/repositories/reconciliation-repository";

/**
 * Module 81 — Reconciliation Admin Dashboard & Operations. Read-only.
 * The admin Runs list's own query — newest-first, optionally filtered by
 * status, always paginated. `ReconciliationRunRepository.list` already did
 * everything this needs (Module 80 built it for exactly this purpose but
 * never wired a use case or Server Action on top of it) — this class adds
 * no query logic of its own, only the composition-root seam every other
 * reconciliation use case already goes through.
 */
export class ListReconciliationRunsUseCase {
  constructor(private readonly runs: ReconciliationRunRepository) {}

  async execute(input: ListReconciliationRunsInput): Promise<ReconciliationRunRecord[]> {
    return this.runs.list(input);
  }
}
