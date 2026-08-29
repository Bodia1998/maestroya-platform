import { NotFoundError } from "@/domain/errors/domain-error";
import type {
  ReconciliationDiscrepancyRecord,
  ReconciliationDiscrepancyRepository,
} from "@/domain/repositories/reconciliation-repository";

/**
 * Module 81 — Reconciliation Admin Dashboard & Operations. Read-only.
 * The discrepancy detail page's own lookup — Module 80 already had
 * `ReconciliationDiscrepancyRepository.findById` (used internally by
 * `ResolveDiscrepancyUseCase`/`createOrTouch`) but never composed a
 * dedicated read-only use case or Server Action over it; every existing
 * discrepancy read path returned a list. This is the minimal addition
 * that exposes it for a single-record view, mirroring
 * `GetReconciliationRunUseCase` exactly (same not-found handling).
 */
export class GetDiscrepancyByIdUseCase {
  constructor(private readonly discrepancies: ReconciliationDiscrepancyRepository) {}

  async execute(discrepancyId: string): Promise<ReconciliationDiscrepancyRecord> {
    const discrepancy = await this.discrepancies.findById(discrepancyId);
    if (!discrepancy) throw new NotFoundError("ReconciliationDiscrepancy", discrepancyId);
    return discrepancy;
  }
}
