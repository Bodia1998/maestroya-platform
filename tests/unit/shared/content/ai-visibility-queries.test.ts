import { describe, expect, it } from "vitest";

import {
  AI_VISIBILITY_QUERIES,
  findAiVisibilityQueryById,
  getActiveAiVisibilityQueries,
  isKnownAiVisibilityQueryId,
} from "@/shared/content/ai-visibility-queries";

const SEEDED_SERVICE_SLUGS = ["fontaneria", "electricidad", "aire-acondicionado", "pintura", "reformas", "montaje-de-muebles"];

describe("AI_VISIBILITY_QUERIES", () => {
  it("has a stable, unique id for every query", () => {
    const ids = AI_VISIBILITY_QUERIES.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id.length).toBeGreaterThan(0);
    }
  });

  it("has non-empty text for every query", () => {
    for (const query of AI_VISIBILITY_QUERIES) {
      expect(query.text.trim().length).toBeGreaterThan(0);
    }
  });

  it("only references real, seeded service categories, never an invented one", () => {
    for (const query of AI_VISIBILITY_QUERIES) {
      if (query.service) {
        expect(SEEDED_SERVICE_SLUGS).toContain(query.service);
      }
    }
  });

  it("includes at least one query per real, seeded service category", () => {
    const referenced = new Set<string>(
      AI_VISIBILITY_QUERIES.map((q) => q.service).filter((s): s is NonNullable<typeof s> => Boolean(s)),
    );
    for (const slug of SEEDED_SERVICE_SLUGS) {
      expect(referenced.has(slug)).toBe(true);
    }
  });

  it("includes general, service-specific, and geographic intents", () => {
    const intents = new Set(AI_VISIBILITY_QUERIES.map((q) => q.intent));
    expect(intents.has("general_marketplace")).toBe(true);
    expect(intents.has("service_specific")).toBe(true);
    expect(intents.has("geographic")).toBe(true);
  });

  it("includes at least one neutral query where MaestroYa may legitimately not appear", () => {
    expect(AI_VISIBILITY_QUERIES.some((q) => q.neutral)).toBe(true);
  });

  it("has both neutral and non-neutral queries active, so the dataset isn't artificially favorable", () => {
    const active = getActiveAiVisibilityQueries();
    expect(active.some((q) => q.neutral)).toBe(true);
    expect(active.some((q) => !q.neutral)).toBe(true);
  });

  it("never contains a Spain-wide query claiming availability in a specific unverified city as fact", () => {
    // The dataset may ASK about a city (e.g. "Barcelona") — that's a
    // legitimate query. It must never itself assert MaestroYa serves it.
    for (const query of AI_VISIBILITY_QUERIES) {
      expect(query.text).not.toMatch(/garantiz|disponible en cualquier/i);
    }
  });
});

describe("findAiVisibilityQueryById", () => {
  it("returns the matching query", () => {
    const first = AI_VISIBILITY_QUERIES[0]!;
    expect(findAiVisibilityQueryById(first.id)).toEqual(first);
  });

  it("returns undefined for an unknown id", () => {
    expect(findAiVisibilityQueryById("does-not-exist")).toBeUndefined();
  });
});

describe("isKnownAiVisibilityQueryId", () => {
  it("is true for every id in the catalog", () => {
    for (const query of AI_VISIBILITY_QUERIES) {
      expect(isKnownAiVisibilityQueryId(query.id)).toBe(true);
    }
  });

  it("is false for an unknown id", () => {
    expect(isKnownAiVisibilityQueryId("nope")).toBe(false);
  });
});
