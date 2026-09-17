import { describe, expect, it, vi } from "vitest";

vi.mock("@/infrastructure/database/prisma/client", () => ({
  prisma: {
    aiVisibilityObservation: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

const now = new Date("2026-09-05T10:00:00.000Z");
const row = {
  id: "obs-1",
  queryId: "svc-fontaneria-find-es",
  provider: "MANUAL",
  providerModel: null,
  observedAt: now,
  recordedByUserId: "admin-1",
  evaluationRulesVersion: "2026-09-17.1",
  mentioned: true,
  identityAccuracy: "CORRECT",
  geographicAccuracy: "CORRECT",
  serviceAccuracy: "CORRECT",
  urlAccuracy: "CORRECT",
  citationPresent: true,
  citationCorrect: true,
  recommendationClassification: "RECOMMENDED",
  detectedCompetitors: ["Habitissimo"],
  factualIssues: [],
  evaluatorNotes: null,
  evidenceType: "MANUAL_TRANSCRIPT_EXCERPT",
  evidenceReference: null,
  evidenceExcerpt: "MaestroYa se recomienda.",
  createdAt: now,
};

describe("infrastructure/database/prisma/repositories/prisma-ai-visibility-observation-repository", () => {
  it("creates a row and maps JSON array fields back to string[]", async () => {
    const { prisma } = await import("@/infrastructure/database/prisma/client");
    (prisma as unknown as { aiVisibilityObservation: { create: ReturnType<typeof vi.fn> } }).aiVisibilityObservation.create.mockResolvedValue(row);

    const { PrismaAiVisibilityObservationRepository } = await import(
      "@/infrastructure/database/prisma/repositories/prisma-ai-visibility-observation-repository"
    );
    const repo = new PrismaAiVisibilityObservationRepository();
    const result = await repo.record({
      queryId: row.queryId,
      provider: "MANUAL",
      providerModel: null,
      observedAt: now,
      recordedByUserId: "admin-1",
      evaluationRulesVersion: row.evaluationRulesVersion,
      mentioned: true,
      identityAccuracy: "CORRECT",
      geographicAccuracy: "CORRECT",
      serviceAccuracy: "CORRECT",
      urlAccuracy: "CORRECT",
      citationPresent: true,
      citationCorrect: true,
      recommendationClassification: "RECOMMENDED",
      detectedCompetitors: ["Habitissimo"],
      factualIssues: [],
      evaluatorNotes: null,
      evidenceType: "MANUAL_TRANSCRIPT_EXCERPT",
      evidenceReference: null,
      evidenceExcerpt: "MaestroYa se recomienda.",
    });

    expect(result.id).toBe("obs-1");
    expect(result.detectedCompetitors).toEqual(["Habitissimo"]);
    expect(Array.isArray(result.factualIssues)).toBe(true);
  });

  it("treats a non-array JSON value for detectedCompetitors as an empty array (defensive read)", async () => {
    const { prisma } = await import("@/infrastructure/database/prisma/client");
    (prisma as unknown as { aiVisibilityObservation: { findMany: ReturnType<typeof vi.fn> } }).aiVisibilityObservation.findMany.mockResolvedValue([
      { ...row, detectedCompetitors: null, factualIssues: null },
    ]);

    const { PrismaAiVisibilityObservationRepository } = await import(
      "@/infrastructure/database/prisma/repositories/prisma-ai-visibility-observation-repository"
    );
    const repo = new PrismaAiVisibilityObservationRepository();
    const results = await repo.list({ limit: 10, offset: 0 });

    expect(results[0]!.detectedCompetitors).toEqual([]);
    expect(results[0]!.factualIssues).toEqual([]);
  });

  it("list() passes through filters to the Prisma where clause", async () => {
    const { prisma } = await import("@/infrastructure/database/prisma/client");
    const findManyMock = (prisma as unknown as { aiVisibilityObservation: { findMany: ReturnType<typeof vi.fn> } }).aiVisibilityObservation.findMany;
    findManyMock.mockResolvedValue([row]);

    const { PrismaAiVisibilityObservationRepository } = await import(
      "@/infrastructure/database/prisma/repositories/prisma-ai-visibility-observation-repository"
    );
    const repo = new PrismaAiVisibilityObservationRepository();
    await repo.list({ limit: 5, offset: 0, queryId: "svc-fontaneria-find-es", provider: "MANUAL" });

    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ queryId: "svc-fontaneria-find-es", provider: "MANUAL" }),
        take: 5,
        skip: 0,
      }),
    );
  });
});
