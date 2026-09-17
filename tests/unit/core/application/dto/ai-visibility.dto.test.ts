import { describe, expect, it } from "vitest";

import { listAiVisibilityObservationsSchema, recordAiVisibilityObservationSchema } from "@/application/dto/ai-visibility.dto";

const VALID = {
  queryId: "general-marketplace-find-es",
  provider: "MANUAL",
  observedAt: "2026-09-05T10:00:00.000Z",
  mentioned: true,
  identityAccuracy: "CORRECT",
  geographicAccuracy: "CORRECT",
  serviceAccuracy: "NOT_APPLICABLE",
  urlAccuracy: "CORRECT",
  citationPresent: true,
  citationCorrect: true,
  recommendationClassification: "RECOMMENDED",
  evidenceType: "MANUAL_TRANSCRIPT_EXCERPT",
};

describe("recordAiVisibilityObservationSchema", () => {
  it("accepts a valid observation", () => {
    const result = recordAiVisibilityObservationSchema.safeParse(VALID);
    expect(result.success).toBe(true);
  });

  it("rejects an unknown query id", () => {
    const result = recordAiVisibilityObservationSchema.safeParse({ ...VALID, queryId: "not-a-real-query" });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid provider value", () => {
    const result = recordAiVisibilityObservationSchema.safeParse({ ...VALID, provider: "CHATGPT_WEB_SCRAPE" });
    expect(result.success).toBe(false);
  });

  it("defaults detectedCompetitors and factualIssues to empty arrays", () => {
    const result = recordAiVisibilityObservationSchema.safeParse(VALID);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.detectedCompetitors).toEqual([]);
      expect(result.data.factualIssues).toEqual([]);
    }
  });

  it("rejects an evidence excerpt over the shared length limit", () => {
    const result = recordAiVisibilityObservationSchema.safeParse({ ...VALID, evidenceExcerpt: "a".repeat(5000) });
    expect(result.success).toBe(false);
  });

  it("never accepts a client-supplied recordedByUserId field as part of the schema shape", () => {
    // Structural guard: the schema has no such key at all — even if a
    // caller passes one, Zod's default (non-strict) parse simply ignores
    // unknown keys, so this asserts the parsed *output* never carries it.
    const result = recordAiVisibilityObservationSchema.safeParse({ ...VALID, recordedByUserId: "admin-9" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty("recordedByUserId");
    }
  });
});

describe("listAiVisibilityObservationsSchema", () => {
  it("applies safe default bounds", () => {
    const result = listAiVisibilityObservationsSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(20);
      expect(result.data.offset).toBe(0);
    }
  });

  it("rejects a limit above the max page size", () => {
    const result = listAiVisibilityObservationsSchema.safeParse({ limit: 10000 });
    expect(result.success).toBe(false);
  });
});
