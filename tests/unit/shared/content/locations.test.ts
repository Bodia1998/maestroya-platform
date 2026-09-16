import { describe, expect, it } from "vitest";

import { LOCATION_CONTENT, getLocationContentBySlug } from "@/shared/content/locations";

/**
 * Module 118 — AI-Readable Service & Location Knowledge.
 *
 * Guards the non-negotiable "do not assume a location exists" rule:
 * exactly the one city `prisma/seed.ts`'s `seedGeography()` seeds
 * (Spain → Valencia → Gandia), and never "Playa de Gandia" — a
 * neighbourhood, not a distinct `City` row (see the Module 118 report,
 * "Pages Intentionally NOT Created").
 */
describe("LOCATION_CONTENT", () => {
  it("contains exactly the one city prisma/seed.ts seeds", () => {
    expect(LOCATION_CONTENT.map((l) => l.slug)).toEqual(["gandia"]);
  });

  it("matches the seeded city/province/country names exactly", () => {
    const gandia = getLocationContentBySlug("gandia");
    expect(gandia).toMatchObject({ cityName: "Gandia", provinceName: "Valencia", countryCode: "ES" });
  });

  it("never includes a 'Playa de Gandia' entry", () => {
    expect(LOCATION_CONTENT.some((l) => l.slug.includes("playa"))).toBe(false);
  });

  it("has no duplicate slugs", () => {
    const slugs = LOCATION_CONTENT.map((l) => l.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("every relatedLocationSlugs entry points at another slug in this same catalog", () => {
    const knownSlugs = new Set(LOCATION_CONTENT.map((l) => l.slug));
    for (const location of LOCATION_CONTENT) {
      for (const related of location.relatedLocationSlugs) {
        expect(knownSlugs.has(related), `${location.slug} -> ${related}`).toBe(true);
      }
    }
  });

  it("never claims current professional availability counts", () => {
    const forbidden = /\d+\s*(profesionales|professionals)/i;
    for (const location of LOCATION_CONTENT) {
      const text = [location.intro, ...location.faqs.flatMap((f) => [f.question, f.answer])].join(" ");
      expect(text, location.slug).not.toMatch(forbidden);
    }
  });

  it("getLocationContentBySlug returns undefined for an unknown slug", () => {
    expect(getLocationContentBySlug("madrid")).toBeUndefined();
  });
});
