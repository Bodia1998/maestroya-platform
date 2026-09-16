import { describe, expect, it } from "vitest";

import {
  JUSTIFIED_SERVICE_LOCATION_PAIRS,
  isJustifiedServiceLocationPair,
} from "@/shared/content/service-location-pairs";
import { SERVICE_CONTENT } from "@/shared/content/services";
import { LOCATION_CONTENT } from "@/shared/content/locations";

/**
 * Module 118 — AI-Readable Service & Location Knowledge — Phase 5.
 *
 * Guards the "do not auto-generate the full cross-product" rule at the
 * data level: every listed pair must reference a real catalog entry on
 * both sides, pairs must be unique, and `isJustifiedServiceLocationPair`
 * must reject anything not explicitly listed — including a syntactically
 * valid service/location combination that was never reviewed.
 */
describe("JUSTIFIED_SERVICE_LOCATION_PAIRS", () => {
  it("every pair references a real service and a real location", () => {
    const serviceSlugs = new Set(SERVICE_CONTENT.map((s) => s.slug));
    const locationSlugs = new Set(LOCATION_CONTENT.map((l) => l.slug));

    for (const pair of JUSTIFIED_SERVICE_LOCATION_PAIRS) {
      expect(serviceSlugs.has(pair.serviceSlug), pair.serviceSlug).toBe(true);
      expect(locationSlugs.has(pair.locationSlug), pair.locationSlug).toBe(true);
    }
  });

  it("has no duplicate pairs", () => {
    const keys = JUSTIFIED_SERVICE_LOCATION_PAIRS.map((p) => `${p.serviceSlug}::${p.locationSlug}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("confirms every real service is paired with Gandia (the only verified location)", () => {
    const pairedServices = new Set(JUSTIFIED_SERVICE_LOCATION_PAIRS.map((p) => p.serviceSlug));
    for (const service of SERVICE_CONTENT) {
      expect(pairedServices.has(service.slug), service.slug).toBe(true);
    }
  });

  it("isJustifiedServiceLocationPair is true only for listed pairs", () => {
    expect(isJustifiedServiceLocationPair("fontaneria", "gandia")).toBe(true);
    expect(isJustifiedServiceLocationPair("fontaneria", "madrid")).toBe(false);
    expect(isJustifiedServiceLocationPair("unknown-service", "gandia")).toBe(false);
  });
});
