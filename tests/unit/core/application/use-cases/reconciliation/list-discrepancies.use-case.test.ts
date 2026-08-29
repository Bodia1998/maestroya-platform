import { describe, expect, it } from "vitest";

import { ListDiscrepanciesUseCase } from "@/application/use-cases/reconciliation/list-discrepancies.use-case";
import { FakeReconciliationDiscrepancyRepository } from "./fakes";
import { makeDiscrepancyRecord } from "./module-81-fixtures";

describe("ListDiscrepanciesUseCase", () => {
  it("filters by resolution status, severity, category, entity type, and detected-at range all at once", async () => {
    const discrepancies = new FakeReconciliationDiscrepancyRepository();
    const match = makeDiscrepancyRecord({
      id: "match",
      resolutionStatus: "OPEN",
      severity: "CRITICAL",
      category: "PAYMENT_AMOUNT_MISMATCH",
      entityType: "PAYMENT",
      detectedAt: new Date("2026-08-15T00:00:00.000Z"),
    });
    const wrongSeverity = makeDiscrepancyRecord({ id: "wrong-severity", resolutionStatus: "OPEN", severity: "INFO" });
    const resolved = makeDiscrepancyRecord({
      id: "resolved",
      resolutionStatus: "RESOLVED",
      severity: "CRITICAL",
      resolution: { resolvedByUserId: "admin-1", resolvedAt: new Date(), reason: "fixed", metadata: null },
    });
    const outOfRange = makeDiscrepancyRecord({
      id: "out-of-range",
      resolutionStatus: "OPEN",
      severity: "CRITICAL",
      detectedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    for (const d of [match, wrongSeverity, resolved, outOfRange]) discrepancies.byId.set(d.id, d);

    const useCase = new ListDiscrepanciesUseCase(discrepancies);
    const result = await useCase.execute({
      resolutionStatus: "OPEN",
      severity: "CRITICAL",
      category: "PAYMENT_AMOUNT_MISMATCH",
      entityType: "PAYMENT",
      detectedFrom: new Date("2026-08-01T00:00:00.000Z"),
      detectedTo: new Date("2026-08-31T00:00:00.000Z"),
      limit: 20,
      offset: 0,
    });

    expect(result.map((d) => d.id)).toEqual(["match"]);
  });

  it("paginates server-side rather than returning every matching row", async () => {
    const discrepancies = new FakeReconciliationDiscrepancyRepository();
    for (let i = 0; i < 45; i += 1) {
      const record = makeDiscrepancyRecord({ id: `d-${i}` });
      discrepancies.byId.set(record.id, record);
    }

    const useCase = new ListDiscrepanciesUseCase(discrepancies);
    const page = await useCase.execute({ limit: 20, offset: 0 });

    expect(page).toHaveLength(20);
  });
});
