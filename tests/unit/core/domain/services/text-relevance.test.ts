import { describe, expect, it } from "vitest";

import { computeTextRelevance } from "@/domain/services/text-relevance";

describe("computeTextRelevance", () => {
  it("returns 0 for an empty/undefined query", () => {
    expect(computeTextRelevance(undefined, ["Electrician"])).toBe(0);
    expect(computeTextRelevance("   ", ["Electrician"])).toBe(0);
  });

  it("returns 1 when every query token is present", () => {
    expect(computeTextRelevance("air conditioning", ["Air Conditioning Repair Specialist"])).toBe(1);
  });

  it("returns a partial fraction when only some tokens match", () => {
    // "air" matches, "plumbing" does not -> 1/2
    expect(computeTextRelevance("air plumbing", ["Air Conditioning Repair"])).toBeCloseTo(0.5, 5);
  });

  it("returns 0 when nothing matches", () => {
    expect(computeTextRelevance("plumbing", ["Electrician headline"])).toBe(0);
  });

  it("is case-insensitive and accent-insensitive", () => {
    expect(computeTextRelevance("ELECTRICISTA", ["electricista en Gandía"])).toBe(1);
    expect(computeTextRelevance("gandia", ["Servicios en Gandía"])).toBe(1);
  });

  it("ignores null fields in the searchable set", () => {
    expect(computeTextRelevance("plumber", [null, "Plumber Pro", null])).toBe(1);
  });

  it("is deterministic for identical inputs", () => {
    const a = computeTextRelevance("electrician gandia", ["Electrician in Gandia"]);
    const b = computeTextRelevance("electrician gandia", ["Electrician in Gandia"]);
    expect(a).toBe(b);
  });
});
