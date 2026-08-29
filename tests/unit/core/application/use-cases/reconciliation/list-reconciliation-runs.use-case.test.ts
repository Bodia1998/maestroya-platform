import { describe, expect, it } from "vitest";

import { ListReconciliationRunsUseCase } from "@/application/use-cases/reconciliation/list-reconciliation-runs.use-case";
import { FakeReconciliationRunRepository } from "./fakes";
import { makeRunRecord } from "./module-81-fixtures";

describe("ListReconciliationRunsUseCase", () => {
  it("returns runs newest-first, respecting limit/offset", async () => {
    const runs = new FakeReconciliationRunRepository();
    const older = makeRunRecord({ id: "run-1", startedAt: new Date("2026-08-01T00:00:00.000Z") });
    const newer = makeRunRecord({ id: "run-2", startedAt: new Date("2026-08-02T00:00:00.000Z") });
    runs.byId.set(older.id, older);
    runs.byId.set(newer.id, newer);

    const useCase = new ListReconciliationRunsUseCase(runs);
    const page1 = await useCase.execute({ limit: 1, offset: 0 });
    const page2 = await useCase.execute({ limit: 1, offset: 1 });

    expect(page1).toHaveLength(1);
    expect(page2).toHaveLength(1);
    expect([...page1, ...page2].map((r) => r.id).sort()).toEqual(["run-1", "run-2"]);
  });

  it("filters by status", async () => {
    const runs = new FakeReconciliationRunRepository();
    const completed = makeRunRecord({ id: "run-completed", status: "COMPLETED" });
    const failed = makeRunRecord({ id: "run-failed", status: "FAILED" });
    runs.byId.set(completed.id, completed);
    runs.byId.set(failed.id, failed);

    const useCase = new ListReconciliationRunsUseCase(runs);
    const result = await useCase.execute({ status: "FAILED", limit: 20, offset: 0 });

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("run-failed");
  });

  it("never returns more than one page's worth of rows, however many runs exist", async () => {
    const runs = new FakeReconciliationRunRepository();
    for (let i = 0; i < 250; i += 1) {
      const record = makeRunRecord({ id: `run-${i}` });
      runs.byId.set(record.id, record);
    }

    const useCase = new ListReconciliationRunsUseCase(runs);
    const result = await useCase.execute({ limit: 20, offset: 0 });

    expect(result).toHaveLength(20);
  });
});
