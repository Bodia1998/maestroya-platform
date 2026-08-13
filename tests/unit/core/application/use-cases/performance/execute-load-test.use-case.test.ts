import { describe, expect, it, vi } from "vitest";

import { ExecuteLoadTestUseCase } from "@/application/use-cases/performance/execute-load-test.use-case";
import type { LoadTestingService } from "@/application/services/performance/load-testing-service";
import { NotFoundError } from "@/domain/errors/domain-error";
import type { PerformanceScenario } from "@/domain/entities/performance-scenario";

describe("application/use-cases/performance/execute-load-test — ExecuteLoadTestUseCase", () => {
  it("resolves the scenario from the catalog and delegates to LoadTestingService.run", async () => {
    const run = vi.fn(async (_scenario: PerformanceScenario, _seed?: number) => ({ id: "result-1" }));
    const useCase = new ExecuteLoadTestUseCase({ run } as unknown as LoadTestingService);

    const result = await useCase.execute({ scenarioId: "authentication", seed: 5 });

    expect(result).toEqual({ id: "result-1" });
    expect(run).toHaveBeenCalledTimes(1);
    const call = run.mock.calls.at(0);
    expect(call?.[0]?.id).toBe("authentication");
    expect(call?.[1]).toBe(5);
  });

  it("throws NotFoundError for an unknown scenario id", async () => {
    const run = vi.fn();
    const useCase = new ExecuteLoadTestUseCase({ run } as unknown as LoadTestingService);
    await expect(useCase.execute({ scenarioId: "does-not-exist" })).rejects.toThrow(NotFoundError);
    expect(run).not.toHaveBeenCalled();
  });
});
