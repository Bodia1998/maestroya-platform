import { NotFoundError } from "@/domain/errors/domain-error";
import type { LoadTestResult } from "@/domain/entities/load-test-result";
import type { LoadTestingService } from "@/application/services/performance/load-testing-service";
import { findScenarioById } from "@/application/services/performance/performance-scenario-catalog";

export interface ExecuteLoadTestInput {
  scenarioId: string;
  /** Pin the simulation's PRNG seed for exact reproducibility — omitted means `LoadTestingService` derives a stable seed from the run's own generated id. */
  seed?: number;
}

/**
 * Module 57 — Load Testing & Capacity Planning.
 *
 * Thin use case: resolve a scenario id against the code-defined catalog,
 * then delegate the actual run to `LoadTestingService`. Mirrors
 * `CreateBackupUseCase`'s "thin, single-purpose, takes a constructor-
 * injected dependency bag" convention — every real decision (planning,
 * aggregation, persistence) already lives in the service it calls.
 */
export class ExecuteLoadTestUseCase {
  constructor(private readonly loadTestingService: LoadTestingService) {}

  async execute(input: ExecuteLoadTestInput): Promise<LoadTestResult> {
    const scenario = findScenarioById(input.scenarioId);
    if (!scenario) {
      throw new NotFoundError("PerformanceScenario", input.scenarioId);
    }
    return this.loadTestingService.run(scenario, input.seed);
  }
}
