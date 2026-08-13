import "server-only";

import type { CapacityBottleneck, CapacityProjection, CapacityRecommendation, CapacityReport } from "@/domain/entities/capacity-report";
import type { LoadTestResult } from "@/domain/entities/load-test-result";
import type { PerformanceScenario } from "@/domain/entities/performance-scenario";

/**
 * Module 57 — Load Testing & Capacity Planning.
 *
 * Turns a `CapacityReport` (plus the `LoadTestResult`s it was built from,
 * and the scenario catalog they belong to) into a structured,
 * presentation-ready shape and both a human-readable Markdown rendering
 * and a JSON serialization — the artifacts an operator/reviewer/CI step
 * actually reads for a production-readiness sign-off. Deliberately kept
 * in infrastructure, not application: this is presentation/formatting of
 * already-computed domain facts, not a new decision — the same
 * "reporting is a rendering concern" boundary `collectBackupHealth`/
 * `collectRecoveryHealth` (Module 54) draw for their own health reports.
 *
 * This module has no persistence layer or API route — `npm run
 * capacity-report` (`scripts/run-capacity-report.ts`) is the only caller,
 * writing the output of `renderMarkdownReport`/`toJsonReport` to
 * `reports/capacity-report.md` / `reports/capacity-report.json`.
 */

export type ReadinessStatus = "Green" | "Yellow" | "Red";

/** Maps a 0–100 production readiness score to a traffic-light band — `>=90` Green, `70-89` Yellow (still within `CapacityReport.isProductionReady`'s own `>=70` cut line), `<70` Red. */
export function readinessStatusFor(score: number): ReadinessStatus {
  if (score >= 90) return "Green";
  if (score >= 70) return "Yellow";
  return "Red";
}

export interface ScenarioReportRow {
  scenarioId: string;
  scenarioName: string;
  averageMs: number;
  medianMs: number;
  p95Ms: number;
  p99Ms: number;
  throughputReqPerSec: number;
  errorRatePercent: number;
  status: "PASS" | "FAIL";
}

export interface CapacityProjectionRow {
  userTier: CapacityProjection["userTier"];
  estimatedLatencyMs: number;
  estimatedThroughputReqPerSec: number;
  cpuUsagePercent: number;
  memoryUsageMB: number;
  dbConnectionPoolUtilizationPercent: number;
  recommendation: string;
}

export interface StructuredCapacityReport {
  generatedAt: string;
  overallScore: number;
  productionReady: boolean;
  readinessStatus: ReadinessStatus;
  scenarios: ScenarioReportRow[];
  capacityProjections: CapacityProjectionRow[];
  bottlenecks: readonly CapacityBottleneck[];
  recommendations: readonly CapacityRecommendation[];
}

/** One row per completed `LoadTestResult`, in scenario-catalog order — the "PASS"/"FAIL" verdict reuses `PerformanceAnalysisService.identifyBottlenecks`'s own thresholds (a scenario in `report.bottlenecks` is FAIL) rather than re-deriving a second set of thresholds here. */
function buildScenarioRows(results: readonly LoadTestResult[], scenarioById: ReadonlyMap<string, PerformanceScenario>, bottlenecks: readonly CapacityBottleneck[]): ScenarioReportRow[] {
  const failingScenarioIds = new Set(bottlenecks.map((b) => b.scenarioId));

  return results
    .filter((result) => result.status === "COMPLETED" && result.latency && result.throughput)
    .map((result) => {
      const scenario = scenarioById.get(result.scenarioId);
      return {
        scenarioId: result.scenarioId,
        scenarioName: scenario?.name ?? result.scenarioId,
        averageMs: result.latency!.average,
        medianMs: result.latency!.median,
        p95Ms: result.latency!.p95,
        p99Ms: result.latency!.p99,
        throughputReqPerSec: result.throughput!.requestsPerSecond,
        errorRatePercent: result.errorRate * 100,
        status: failingScenarioIds.has(result.scenarioId) ? "FAIL" : "PASS",
      } satisfies ScenarioReportRow;
    });
}

/** Every `CapacityRecommendation`'s description names the tier its saturation was first observed at (`"... at N concurrent users ..."`, from `CapacityPlanningService.recommendationsFor`) — extracts that number so a per-tier row can decide which recommendations are already "live" by the time it's reached. Returns `null` when a description doesn't match the expected shape (defensively; every recommendation this module actually produces does). */
function extractTriggerTier(description: string): number | null {
  const match = /at ([\d,]+) concurrent users/.exec(description);
  if (!match?.[1]) return null;
  const value = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
}

const RECOMMENDATION_CATEGORY_LABELS: Record<CapacityRecommendation["category"], string> = {
  DATABASE_SCALING: "Database Scaling",
  READ_REPLICAS: "Read Replicas",
  REDIS_SCALING: "Redis Scaling",
  HORIZONTAL_INSTANCES: "Horizontal Instances",
  STORAGE: "Storage",
  BANDWIDTH: "Bandwidth",
  WORKER_COUNT: "Worker Count",
  QUEUE_THROUGHPUT: "Queue Throughput",
};

const URGENCY_RANK: Record<CapacityRecommendation["urgency"], number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };

/** Every description `CapacityPlanningService.recommendationsFor` produces starts `"${scenario.name}" ...` — extracts that leading quoted scenario name. Falls back to the full description when the shape doesn't match (defensive; every recommendation this module actually produces does match). */
function extractScenarioName(description: string): string {
  const match = /^"([^"]+)"/.exec(description);
  return match?.[1] ?? description;
}

/** Strips the leading quoted scenario name off a description, leaving just the category-level reason every recommendation in the same category expresses in essentially the same words (e.g. `"Booking" projects 92.1% CPU at 500 concurrent users — add instances before reaching this tier.` becomes `projects 92.1% CPU at 500 concurrent users — add instances before reaching this tier.`). */
function reasonFor(description: string): string {
  return description.replace(/^"[^"]+"\s*/, "");
}

interface GroupedRecommendation {
  categoryLabel: string;
  scenarioNames: string[];
  reason: string;
}

/**
 * Groups a flat recommendation list into one row per category instead of
 * one row per scenario. `CapacityPlanningService.recommendationsFor` runs
 * once per scenario, so a platform with e.g. ten scenarios all projecting
 * high DB-pool utilization previously produced ten near-identical
 * sentences differing only in scenario name — repetitive and, once
 * concatenated across every applicable recommendation for a tier, hard to
 * read. Grouping surfaces the same information (which categories need
 * attention, which scenarios are affected, why) in one line per category.
 * The reason shown is the highest-urgency scenario's — the one that
 * actually determines whether the category needs attention at this tier.
 */
function groupRecommendationsByCategory(recommendations: readonly CapacityRecommendation[]): GroupedRecommendation[] {
  const byCategory = new Map<CapacityRecommendation["category"], CapacityRecommendation[]>();
  for (const recommendation of recommendations) {
    const bucket = byCategory.get(recommendation.category) ?? [];
    bucket.push(recommendation);
    byCategory.set(recommendation.category, bucket);
  }

  return [...byCategory.entries()].map(([category, group]) => {
    const worst = group.reduce((a, b) => (URGENCY_RANK[b.urgency] > URGENCY_RANK[a.urgency] ? b : a));
    return {
      categoryLabel: RECOMMENDATION_CATEGORY_LABELS[category],
      scenarioNames: [...new Set(group.map((r) => extractScenarioName(r.description)))],
      reason: reasonFor(worst.description),
    } satisfies GroupedRecommendation;
  });
}

/** Renders `groupRecommendationsByCategory`'s output as the "Recommendation:" field's content — one line per category, or the unchanged "No action needed" fallback when the tier has nothing applicable yet. */
function renderGroupedRecommendations(grouped: readonly GroupedRecommendation[]): string {
  if (grouped.length === 0) return "No action needed at this tier.";
  return grouped.map((g) => `${g.categoryLabel} — Affected: ${g.scenarioNames.join(", ")}. Reason: ${g.reason}`).join("\n");
}

/** One row per `CAPACITY_USER_TIERS` tier — the system-wide view across every scenario at that tier, not a per-scenario breakdown (that's what the per-scenario section above is for). Latency/CPU/DB-pool are worst-case across scenarios (the figure that actually determines whether the *platform* is fine at a tier); throughput/memory are summed (aggregate load the platform would carry). The recommendation text surfaces every `CapacityRecommendation` whose saturation tier has already been reached by this row's tier. */
function buildProjectionRows(report: CapacityReport): CapacityProjectionRow[] {
  const tiers = [...new Set(report.projections.map((p) => p.userTier))].sort((a, b) => a - b);

  return tiers.map((userTier) => {
    const atTier = report.projections.filter((p) => p.userTier === userTier);
    const applicableRecommendations = report.recommendations.filter((r) => {
      const triggerTier = extractTriggerTier(r.description);
      return triggerTier !== null && triggerTier <= userTier;
    });

    return {
      userTier,
      estimatedLatencyMs: maxOf(atTier, (p) => p.projectedP95LatencyMs),
      estimatedThroughputReqPerSec: sumOf(atTier, (p) => p.projectedRequestsPerSecond),
      cpuUsagePercent: maxOf(atTier, (p) => p.projectedCpuPercent),
      memoryUsageMB: sumOf(atTier, (p) => p.projectedMemoryMB),
      dbConnectionPoolUtilizationPercent: maxOf(atTier, (p) => p.projectedDbConnectionPoolUtilizationPercent),
      recommendation: renderGroupedRecommendations(groupRecommendationsByCategory(applicableRecommendations)),
    } satisfies CapacityProjectionRow;
  });
}

function maxOf(items: readonly CapacityProjection[], selector: (item: CapacityProjection) => number): number {
  return items.reduce((max, item) => Math.max(max, selector(item)), 0);
}

function sumOf(items: readonly CapacityProjection[], selector: (item: CapacityProjection) => number): number {
  return items.reduce((sum, item) => sum + selector(item), 0);
}

export function buildStructuredReport(report: CapacityReport, results: readonly LoadTestResult[], scenarioById: ReadonlyMap<string, PerformanceScenario>): StructuredCapacityReport {
  return {
    generatedAt: report.generatedAt.toISOString(),
    overallScore: report.productionReadinessScore,
    productionReady: report.isProductionReady,
    readinessStatus: readinessStatusFor(report.productionReadinessScore),
    scenarios: buildScenarioRows(results, scenarioById, report.bottlenecks),
    capacityProjections: buildProjectionRows(report),
    bottlenecks: report.bottlenecks,
    recommendations: report.recommendations,
  };
}

/** Renders `buildStructuredReport`'s output as Markdown, matching the module's documented report shape exactly — one fenced scenario block per completed run, one capacity-projection section per `CAPACITY_USER_TIERS` tier, and a closing production-readiness section. */
export function renderMarkdownReport(report: CapacityReport, results: readonly LoadTestResult[], scenarioById: ReadonlyMap<string, PerformanceScenario>): string {
  const structured = buildStructuredReport(report, results, scenarioById);
  const lines: string[] = [];
  const divider = "-".repeat(50);

  lines.push("# MaestroYa Capacity Report", "");
  lines.push(`Overall Score: ${structured.overallScore} / 100`);
  lines.push(`Production Ready: ${structured.productionReady ? "YES" : "NO"}`, "");

  for (const scenario of structured.scenarios) {
    lines.push(divider);
    lines.push(`Scenario: ${scenario.scenarioName}`);
    lines.push(`Average: ${scenario.averageMs.toFixed(0)} ms`);
    lines.push(`Median: ${scenario.medianMs.toFixed(0)} ms`);
    lines.push(`P95: ${scenario.p95Ms.toFixed(0)} ms`);
    lines.push(`P99: ${scenario.p99Ms.toFixed(0)} ms`);
    lines.push(`Throughput: ${scenario.throughputReqPerSec.toFixed(0)} req/s`);
    lines.push(`Error Rate: ${scenario.errorRatePercent.toFixed(1)}%`);
    lines.push(`Status: ${scenario.status}`);
  }
  lines.push(divider, "");

  lines.push("## Capacity Projection", "");
  for (const projection of structured.capacityProjections) {
    lines.push(`### ${projection.userTier.toLocaleString()} users`);
    lines.push(`Estimated Latency: ${projection.estimatedLatencyMs.toFixed(0)} ms`);
    lines.push(`Estimated Throughput: ${projection.estimatedThroughputReqPerSec.toFixed(1)} req/s`);
    lines.push(`CPU Usage: ${projection.cpuUsagePercent.toFixed(1)}%`);
    lines.push(`Memory Usage: ${Math.round(projection.memoryUsageMB)} MB`);
    lines.push("Recommendation:");
    for (const line of projection.recommendation.split("\n")) {
      lines.push(line.startsWith("No action needed") ? line : `- ${line}`);
    }
    lines.push("");
  }

  lines.push("## Production Readiness", "");
  lines.push(`Overall Score: ${structured.overallScore} / 100`);
  lines.push(`Status: ${structured.readinessStatus}`);
  lines.push("Bottlenecks:");
  if (structured.bottlenecks.length === 0) {
    lines.push("- None identified.");
  } else {
    for (const bottleneck of structured.bottlenecks) {
      lines.push(`- ${bottleneck.scenarioName}: ${bottleneck.reason}`);
    }
  }

  return lines.join("\n");
}

/** JSON-serializable form of the same report — same data as `renderMarkdownReport`, structured for machine consumption (e.g. a CI step that diffs successive reports). */
export function toJsonReport(report: CapacityReport, results: readonly LoadTestResult[], scenarioById: ReadonlyMap<string, PerformanceScenario>): StructuredCapacityReport {
  return buildStructuredReport(report, results, scenarioById);
}
