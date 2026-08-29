import { describe, expect, it } from "vitest";

import { GetReconciliationOverviewUseCase } from "@/application/use-cases/reconciliation/get-reconciliation-overview.use-case";
import { FakeReconciliationDiscrepancyRepository, FakeReconciliationRunRepository } from "./fakes";
import { makeDiscrepancyRecord, makeRunRecord } from "./module-81-fixtures";

describe("GetReconciliationOverviewUseCase", () => {
  it("aggregates latest/last-successful/last-failed runs, total run count, and discrepancy breakdowns", async () => {
    const runs = new FakeReconciliationRunRepository();
    const completed = makeRunRecord({ id: "run-completed", status: "COMPLETED" });
    const failed = makeRunRecord({ id: "run-failed", status: "FAILED" });
    runs.byId.set(completed.id, completed);
    runs.byId.set(failed.id, failed);

    const discrepancies = new FakeReconciliationDiscrepancyRepository();
    const open1 = makeDiscrepancyRecord({ id: "open-1", resolutionStatus: "OPEN", severity: "CRITICAL", category: "PAYMENT_AMOUNT_MISMATCH" });
    const open2 = makeDiscrepancyRecord({ id: "open-2", resolutionStatus: "OPEN", severity: "WARNING", category: "PAYMENT_AMOUNT_MISMATCH" });
    const resolved = makeDiscrepancyRecord({
      id: "resolved-1",
      resolutionStatus: "RESOLVED",
      resolution: { resolvedByUserId: "admin-1", resolvedAt: new Date(), reason: "fixed", metadata: null },
    });
    for (const d of [open1, open2, resolved]) discrepancies.byId.set(d.id, d);

    const useCase = new GetReconciliationOverviewUseCase(runs, discrepancies);
    const overview = await useCase.execute();

    expect(overview.totalRuns).toBe(2);
    expect(overview.lastSuccessfulRun?.id).toBe("run-completed");
    expect(overview.lastFailedRun?.id).toBe("run-failed");
    expect(overview.discrepancies.open).toBe(2);
    expect(overview.discrepancies.resolved).toBe(1);
    expect(overview.discrepancies.bySeverity.CRITICAL).toBe(1);
    expect(overview.discrepancies.bySeverity.WARNING).toBe(1);
    expect(overview.discrepancies.bySeverity.INFO).toBe(0);
    expect(overview.discrepancies.byCategory).toEqual([{ category: "PAYMENT_AMOUNT_MISMATCH", count: 2 }]);
  });

  it("returns nulls (not an error) when no run has ever executed", async () => {
    const runs = new FakeReconciliationRunRepository();
    const discrepancies = new FakeReconciliationDiscrepancyRepository();
    const useCase = new GetReconciliationOverviewUseCase(runs, discrepancies);

    const overview = await useCase.execute();

    expect(overview.latestRun).toBeNull();
    expect(overview.lastSuccessfulRun).toBeNull();
    expect(overview.lastFailedRun).toBeNull();
    expect(overview.totalRuns).toBe(0);
    expect(overview.discrepancies.open).toBe(0);
    expect(overview.discrepancies.byCategory).toEqual([]);
  });
});
