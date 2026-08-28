import { NotFoundError } from "@/domain/errors/domain-error";
import type { ReconciliationDataSource } from "@/application/ports/reconciliation-data-source";
import type { JobFinancialContext } from "@/domain/services/reconciliation/context";

/**
 * Module 80 — Financial Reconciliation & Observability.
 *
 * Read-only drill-down: given a Job id, returns every financial record
 * Module 80 gathered and reconciled for it (Payment(s), Commission, live
 * tax/commission recomputation, Invoice(s), Payout, Refund(s),
 * CreditNote(s)) — what an admin/financial operator opens from a
 * discrepancy row to actually investigate it. Read-only; identical data
 * source the reconciliation engine itself scans.
 */
export class GetFinancialEntitySnapshotUseCase {
  constructor(private readonly dataSource: ReconciliationDataSource) {}

  async execute(jobId: string): Promise<JobFinancialContext> {
    const context = await this.dataSource.getJobFinancialContext(jobId);
    if (!context) throw new NotFoundError("Job", jobId);
    return context;
  }
}
