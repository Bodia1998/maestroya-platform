import { ValidationError } from "@/domain/errors/domain-error";

/**
 * Module 57 — Load Testing & Capacity Planning.
 *
 * `CapacityReport` aggregates load-test results across scenarios into
 * per-user-tier projections and a set of actionable recommendations —
 * the production-readiness sign-off artifact this whole module exists to
 * produce. Like `PerformanceRegression`, it is a computed snapshot, not a
 * state machine: `CapacityPlanningService`/`PerformanceAnalysisService`
 * build a fresh one on every `GenerateCapacityReportUseCase.execute()`
 * call rather than mutating a persisted aggregate.
 */
export const CAPACITY_USER_TIERS = [100, 500, 1000, 5000, 10000, 50000, 100000] as const;
export type CapacityUserTier = (typeof CAPACITY_USER_TIERS)[number];

export type RecommendationCategory =
  | "DATABASE_SCALING"
  | "READ_REPLICAS"
  | "REDIS_SCALING"
  | "HORIZONTAL_INSTANCES"
  | "STORAGE"
  | "BANDWIDTH"
  | "WORKER_COUNT"
  | "QUEUE_THROUGHPUT";

export type RecommendationUrgency = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

/** One actionable capacity-planning suggestion. A plain, immutable value object — no lifecycle, no persistence identity of its own. */
export class CapacityRecommendation {
  constructor(
    readonly category: RecommendationCategory,
    readonly description: string,
    readonly urgency: RecommendationUrgency,
  ) {
    if (!description.trim()) {
      throw new ValidationError("CapacityRecommendation.description must not be empty.");
    }
  }
}

/** Extrapolated behaviour for one scenario at one concurrent-user tier — see `CapacityPlanningService.projectForScenario`'s own doc comment for the extrapolation method. */
export interface CapacityProjection {
  scenarioId: string;
  userTier: CapacityUserTier;
  projectedRequestsPerSecond: number;
  projectedP95LatencyMs: number;
  projectedCpuPercent: number;
  projectedMemoryMB: number;
  projectedDbConnectionPoolUtilizationPercent: number;
}

/** A scenario ranked as a worst performer — the input `PerformanceAnalysisService.identifyBottlenecks` ranks by p95 latency and error rate. */
export interface CapacityBottleneck {
  scenarioId: string;
  scenarioName: string;
  p95LatencyMs: number;
  errorRate: number;
  reason: string;
}

export class CapacityReport {
  private constructor(
    readonly id: string,
    readonly generatedAt: Date,
    readonly projections: readonly CapacityProjection[],
    readonly recommendations: readonly CapacityRecommendation[],
    readonly bottlenecks: readonly CapacityBottleneck[],
    /** 0 (not production ready) to 100 (no concerns identified) — see `PerformanceAnalysisService.computeProductionReadinessScore`'s own doc comment for the scoring formula. */
    readonly productionReadinessScore: number,
  ) {}

  static build(fields: {
    id: string;
    generatedAt: Date;
    projections: readonly CapacityProjection[];
    recommendations: readonly CapacityRecommendation[];
    bottlenecks: readonly CapacityBottleneck[];
    productionReadinessScore: number;
  }): CapacityReport {
    if (!Number.isFinite(fields.productionReadinessScore) || fields.productionReadinessScore < 0 || fields.productionReadinessScore > 100) {
      throw new ValidationError(
        `CapacityReport.productionReadinessScore must be between 0 and 100, received ${String(fields.productionReadinessScore)}.`,
      );
    }
    return new CapacityReport(
      fields.id,
      fields.generatedAt,
      fields.projections,
      fields.recommendations,
      fields.bottlenecks,
      fields.productionReadinessScore,
    );
  }

  /** Whether this report reflects a deployment `PerformanceAnalysisService` considers ready to sign off on — a simple, documented cut line rather than a magic number scattered across call sites. */
  get isProductionReady(): boolean {
    return this.productionReadinessScore >= 70 && !this.bottlenecks.some((b) => b.errorRate > 0.05);
  }
}
