import { beforeEach, describe, expect, it } from "vitest";

import { RecordAiVisibilityObservationUseCase } from "@/application/use-cases/ai-visibility/record-observation.use-case";
import { ListAiVisibilityObservationsUseCase } from "@/application/use-cases/ai-visibility/list-observations.use-case";
import { ValidationError } from "@/domain/errors/domain-error";
import { EVALUATION_RULES_VERSION } from "@/domain/services/ai-visibility-evaluation";
import { InMemoryAiVisibilityObservationRepository } from "./fakes";

const VALID_INPUT = {
  queryId: "general-marketplace-find-es",
  provider: "MANUAL" as const,
  providerModel: null,
  observedAt: new Date("2026-09-01T10:00:00.000Z"),
  mentioned: true,
  identityAccuracy: "CORRECT" as const,
  geographicAccuracy: "CORRECT" as const,
  serviceAccuracy: "NOT_APPLICABLE" as const,
  urlAccuracy: "CORRECT" as const,
  citationPresent: true,
  citationCorrect: true,
  recommendationClassification: "RECOMMENDED" as const,
  detectedCompetitors: ["Habitissimo"],
  factualIssues: [],
  evaluatorNotes: null,
  evidenceType: "MANUAL_TRANSCRIPT_EXCERPT" as const,
  evidenceReference: null,
  evidenceExcerpt: "MaestroYa se recomienda como opción principal.",
};

describe("RecordAiVisibilityObservationUseCase", () => {
  let repo: InMemoryAiVisibilityObservationRepository;
  let useCase: RecordAiVisibilityObservationUseCase;

  beforeEach(() => {
    repo = new InMemoryAiVisibilityObservationRepository();
    useCase = new RecordAiVisibilityObservationUseCase(repo);
  });

  it("records a valid observation with the recorder's id and default rules version", async () => {
    const result = await useCase.execute("admin-1", VALID_INPUT);
    expect(result.recordedByUserId).toBe("admin-1");
    expect(result.evaluationRulesVersion).toBe(EVALUATION_RULES_VERSION);
    expect(result.queryId).toBe(VALID_INPUT.queryId);
  });

  it("allows a null recorder id (system-recorded entry)", async () => {
    const result = await useCase.execute(null, VALID_INPUT);
    expect(result.recordedByUserId).toBeNull();
  });

  it("rejects an unknown query id", async () => {
    await expect(useCase.execute("admin-1", { ...VALID_INPUT, queryId: "does-not-exist" })).rejects.toThrow(ValidationError);
  });

  it("rejects an evidence excerpt over the length limit", async () => {
    await expect(
      useCase.execute("admin-1", { ...VALID_INPUT, evidenceExcerpt: "a".repeat(2000) }),
    ).rejects.toThrow();
  });

  it("rejects recommendationClassification RECOMMENDED when mentioned is false", async () => {
    await expect(
      useCase.execute("admin-1", { ...VALID_INPUT, mentioned: false, recommendationClassification: "RECOMMENDED" }),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects recommendationClassification NOT_MENTIONED when mentioned is true", async () => {
    await expect(
      useCase.execute("admin-1", { ...VALID_INPUT, mentioned: true, recommendationClassification: "NOT_MENTIONED" }),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects a non-null citationCorrect when citationPresent is false", async () => {
    await expect(
      useCase.execute("admin-1", { ...VALID_INPUT, citationPresent: false, citationCorrect: true }),
    ).rejects.toThrow(ValidationError);
  });

  it("accepts a not-mentioned observation with NOT_MENTIONED classification", async () => {
    const result = await useCase.execute("admin-1", {
      ...VALID_INPUT,
      mentioned: false,
      recommendationClassification: "NOT_MENTIONED",
      identityAccuracy: "NOT_APPLICABLE",
      geographicAccuracy: "NOT_APPLICABLE",
      serviceAccuracy: "NOT_APPLICABLE",
      urlAccuracy: "NOT_PROVIDED",
      citationPresent: false,
      citationCorrect: null,
    });
    expect(result.mentioned).toBe(false);
  });

  it("preserves history: recording twice for the same query creates two distinct observations, not an overwrite", async () => {
    await useCase.execute("admin-1", VALID_INPUT);
    await useCase.execute("admin-1", { ...VALID_INPUT, observedAt: new Date("2026-09-08T10:00:00.000Z"), mentioned: false, recommendationClassification: "NOT_MENTIONED", identityAccuracy: "NOT_APPLICABLE", geographicAccuracy: "NOT_APPLICABLE", urlAccuracy: "NOT_PROVIDED", citationPresent: false, citationCorrect: null });
    expect(repo.allRows()).toHaveLength(2);
    expect(repo.allRows()[0]!.mentioned).not.toBe(repo.allRows()[1]!.mentioned);
  });

  it("a duplicate submission of the exact same observation still creates a second, separate row (no forced dedupe)", async () => {
    await useCase.execute("admin-1", VALID_INPUT);
    await useCase.execute("admin-1", VALID_INPUT);
    expect(repo.allRows()).toHaveLength(2);
    expect(repo.allRows()[0]!.id).not.toBe(repo.allRows()[1]!.id);
  });
});

describe("ListAiVisibilityObservationsUseCase", () => {
  it("lists recorded observations", async () => {
    const repo = new InMemoryAiVisibilityObservationRepository();
    const recordUseCase = new RecordAiVisibilityObservationUseCase(repo);
    const listUseCase = new ListAiVisibilityObservationsUseCase(repo);

    await recordUseCase.execute("admin-1", VALID_INPUT);
    const results = await listUseCase.execute({ limit: 10, offset: 0 });
    expect(results).toHaveLength(1);
    expect(results[0]!.queryId).toBe(VALID_INPUT.queryId);
  });

  it("returns an empty list when nothing has been recorded", async () => {
    const repo = new InMemoryAiVisibilityObservationRepository();
    const listUseCase = new ListAiVisibilityObservationsUseCase(repo);
    expect(await listUseCase.execute({ limit: 10, offset: 0 })).toEqual([]);
  });
});
