import { describe, expect, it } from "vitest";

import { GetReconciliationRunSeverityBreakdownUseCase } from "@/application/use-cases/reconciliation/get-reconciliation-run-severity-breakdown.use-case";
import { FakeReconciliationDiscrepancyRepository } from "./fakes";
import { makeDiscrepancyRecord } from "./module-81-fixtures";

describe("GetReconciliationRunSeverityBreakdownUseCase", () => {
  it("counts every discrepancy detected by the given run, by severity, regardless of resolution status", async () => {
    const discrepancies = new FakeReconciliationDiscrepancyRepository();
    const inRunOpen = makeDiscrepancyRecord({ id: "a", detectedByRunId: "run-1", severity: "CRITICAL", resolutionStatus: "OPEN" });
    const inRunResolved = makeDiscrepancyRecord({
      id: "b",
      detectedByRunId: "run-1",
      severity: "CRITICAL",
      resolutionStatus: "RESOLVED",
      resolution: { resolvedByUserId: "admin-1", resolvedAt: new Date(), reason: "fixed", metadata: null },
    });
    const otherRun = makeDiscrepancyRecord({ id: "c", detectedByRunId: "run-2", severity: "CRITICAL" });
    for (const d of [inRunOpen, inRunResolved, otherRun]) discrepancies.byId.set(d.id, d);

    const useCase = new GetReconciliationRunSeverityBreakdownUseCase(discrepancies);
    const breakdown = await useCase.execute("run-1");

    expect(breakdown.CRITICAL).toBe(2);
    expect(breakdown.INFO).toBe(0);
  });
});
