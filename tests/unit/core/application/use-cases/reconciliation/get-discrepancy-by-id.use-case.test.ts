import { describe, expect, it } from "vitest";

import { GetDiscrepancyByIdUseCase } from "@/application/use-cases/reconciliation/get-discrepancy-by-id.use-case";
import { NotFoundError } from "@/domain/errors/domain-error";
import { FakeReconciliationDiscrepancyRepository } from "./fakes";
import { makeDiscrepancyRecord } from "./module-81-fixtures";

describe("GetDiscrepancyByIdUseCase", () => {
  it("returns the discrepancy when it exists", async () => {
    const discrepancies = new FakeReconciliationDiscrepancyRepository();
    const record = makeDiscrepancyRecord({ id: "d-1" });
    discrepancies.byId.set(record.id, record);

    const useCase = new GetDiscrepancyByIdUseCase(discrepancies);
    const result = await useCase.execute("d-1");

    expect(result.id).toBe("d-1");
  });

  it("throws NotFoundError for a discrepancy id that doesn't exist", async () => {
    const discrepancies = new FakeReconciliationDiscrepancyRepository();
    const useCase = new GetDiscrepancyByIdUseCase(discrepancies);

    await expect(useCase.execute("missing")).rejects.toBeInstanceOf(NotFoundError);
  });
});
