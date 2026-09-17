import { beforeEach, describe, expect, it } from "vitest";

import { GetAiVisibilityMetricsUseCase } from "@/application/use-cases/ai-visibility/get-ai-visibility-metrics.use-case";
import { RecordAiVisibilityObservationUseCase } from "@/application/use-cases/ai-visibility/record-observation.use-case";
import type { RecordAiVisibilityObservationInput } from "@/application/use-cases/ai-visibility/record-observation.use-case";
import { InMemoryAiVisibilityObservationRepository } from "./fakes";

function baseInput(overrides: Partial<RecordAiVisibilityObservationInput> = {}): RecordAiVisibilityObservationInput {
  return {
    queryId: "svc-fontaneria-find-es",
    provider: "MANUAL",
    providerModel: null,
    observedAt: new Date("2026-09-05T10:00:00.000Z"),
    mentioned: true,
    identityAccuracy: "CORRECT",
    geographicAccuracy: "CORRECT",
    serviceAccuracy: "CORRECT",
    urlAccuracy: "CORRECT",
    citationPresent: true,
    citationCorrect: true,
    recommendationClassification: "RECOMMENDED",
    detectedCompetitors: [],
    factualIssues: [],
    evaluatorNotes: null,
    evidenceType: "MANUAL_TRANSCRIPT_EXCERPT",
    evidenceReference: null,
    evidenceExcerpt: null,
    ...overrides,
  };
}

describe("GetAiVisibilityMetricsUseCase", () => {
  let repo: InMemoryAiVisibilityObservationRepository;
  let recordUseCase: RecordAiVisibilityObservationUseCase;
  let metricsUseCase: GetAiVisibilityMetricsUseCase;

  beforeEach(() => {
    repo = new InMemoryAiVisibilityObservationRepository();
    recordUseCase = new RecordAiVisibilityObservationUseCase(repo);
    metricsUseCase = new GetAiVisibilityMetricsUseCase(repo);
  });

  it("returns zeroed rates (0/0) when there are no observations", async () => {
    const report = await metricsUseCase.execute({ from: null, to: null });
    expect(report.totalObservations).toBe(0);
    expect(report.mentionRate).toEqual({ numerator: 0, denominator: 0 });
  });

  it("computes mention rate as numerator/denominator, excluding neutral queries", async () => {
    await recordUseCase.execute("admin-1", baseInput({ mentioned: true }));
    await recordUseCase.execute(
      "admin-1",
      baseInput({
        queryId: "general-marketplace-find-es",
        mentioned: false,
        recommendationClassification: "NOT_MENTIONED",
        identityAccuracy: "NOT_APPLICABLE",
        geographicAccuracy: "NOT_APPLICABLE",
        serviceAccuracy: "NOT_APPLICABLE",
        urlAccuracy: "NOT_PROVIDED",
        citationPresent: false,
        citationCorrect: null,
      }),
    );
    const report = await metricsUseCase.execute({ from: null, to: null });
    expect(report.mentionRate).toEqual({ numerator: 1, denominator: 2 });
  });

  it("tracks neutral-query mentions separately from the main mention rate", async () => {
    await recordUseCase.execute(
      "admin-1",
      baseInput({ queryId: "neutral-generic-home-improvement-tips-es", mentioned: false, recommendationClassification: "NOT_MENTIONED", identityAccuracy: "NOT_APPLICABLE", geographicAccuracy: "NOT_APPLICABLE", serviceAccuracy: "NOT_APPLICABLE", urlAccuracy: "NOT_PROVIDED", citationPresent: false, citationCorrect: null }),
    );
    const report = await metricsUseCase.execute({ from: null, to: null });
    // Neutral-query observation must not count toward the main
    // (non-neutral) mention rate's denominator.
    expect(report.mentionRate).toEqual({ numerator: 0, denominator: 0 });
    expect(report.neutralQueryMentionRate).toEqual({ numerator: 0, denominator: 1 });
  });

  it("computes citation rate only among mentioned observations", async () => {
    await recordUseCase.execute("admin-1", baseInput({ mentioned: true, citationPresent: true }));
    await recordUseCase.execute("admin-1", baseInput({ queryId: "svc-electricidad-hire-es", mentioned: true, citationPresent: false, citationCorrect: null }));
    const report = await metricsUseCase.execute({ from: null, to: null });
    expect(report.citationRate).toEqual({ numerator: 1, denominator: 2 });
  });

  it("computes correctIdentityRate only where identityAccuracy is applicable", async () => {
    await recordUseCase.execute("admin-1", baseInput({ identityAccuracy: "CORRECT" }));
    await recordUseCase.execute("admin-1", baseInput({ queryId: "svc-electricidad-hire-es", identityAccuracy: "INCORRECT" }));
    const report = await metricsUseCase.execute({ from: null, to: null });
    expect(report.correctIdentityRate).toEqual({ numerator: 1, denominator: 2 });
  });

  it("computes correctUrlRate only among observations where a URL was provided", async () => {
    await recordUseCase.execute("admin-1", baseInput({ urlAccuracy: "CORRECT" }));
    await recordUseCase.execute("admin-1", baseInput({ queryId: "svc-electricidad-hire-es", urlAccuracy: "NOT_PROVIDED" }));
    const report = await metricsUseCase.execute({ from: null, to: null });
    expect(report.urlProvidedRate).toEqual({ numerator: 1, denominator: 2 });
    expect(report.correctUrlRate).toEqual({ numerator: 1, denominator: 1 });
  });

  it("never averages recommendationClassification — reports a per-bucket count", async () => {
    await recordUseCase.execute("admin-1", baseInput({ recommendationClassification: "RECOMMENDED" }));
    await recordUseCase.execute("admin-1", baseInput({ queryId: "svc-electricidad-hire-es", recommendationClassification: "LISTED_AMONG_OPTIONS" }));
    const report = await metricsUseCase.execute({ from: null, to: null });
    expect(report.recommendationClassificationCounts.RECOMMENDED).toBe(1);
    expect(report.recommendationClassificationCounts.LISTED_AMONG_OPTIONS).toBe(1);
    expect(report.recommendationClassificationCounts.NOT_MENTIONED).toBe(0);
  });

  it("breaks mention rate down by query intent and by service", async () => {
    await recordUseCase.execute("admin-1", baseInput({ queryId: "svc-fontaneria-find-es" }));
    const report = await metricsUseCase.execute({ from: null, to: null });
    const serviceEntry = report.byService.find((e) => e.key === "fontaneria");
    expect(serviceEntry?.totalObservations).toBe(1);
    const intentEntry = report.byQueryIntent.find((e) => e.key === "service_specific");
    expect(intentEntry?.totalObservations).toBe(1);
  });

  it("records competitor mentions as a plain count, never a ranking/winner claim", async () => {
    await recordUseCase.execute("admin-1", baseInput({ detectedCompetitors: ["Habitissimo", "Cronoshare"] }));
    await recordUseCase.execute("admin-1", baseInput({ queryId: "svc-electricidad-hire-es", detectedCompetitors: ["Habitissimo"] }));
    const report = await metricsUseCase.execute({ from: null, to: null });
    const habitissimo = report.competitorMentionCounts.find((c) => c.name === "Habitissimo");
    expect(habitissimo?.count).toBe(2);
    // The report type has no "winner"/"rank" field — a structural guard,
    // not a runtime one, but this asserts the shape holds no such key.
    expect(report).not.toHaveProperty("winner");
  });

  it("restricts the report to the given observation period", async () => {
    await recordUseCase.execute("admin-1", baseInput({ observedAt: new Date("2026-01-01T00:00:00.000Z") }));
    await recordUseCase.execute("admin-1", baseInput({ queryId: "svc-electricidad-hire-es", observedAt: new Date("2026-09-05T00:00:00.000Z") }));
    const report = await metricsUseCase.execute({ from: new Date("2026-09-01T00:00:00.000Z"), to: new Date("2026-09-30T00:00:00.000Z") });
    expect(report.totalObservations).toBe(1);
  });

  it("preserves every historical observation across repeated metrics calls (read-only, no mutation)", async () => {
    await recordUseCase.execute("admin-1", baseInput());
    await metricsUseCase.execute({ from: null, to: null });
    await metricsUseCase.execute({ from: null, to: null });
    expect(repo.allRows()).toHaveLength(1);
  });
});
