import { describe, expect, it } from "vitest";

import {
  LOCATION_CONTENT,
  getLocationContentBySlug,
  localizeCountryName,
  resolveLocationContent,
} from "@/shared/content/locations";
import { SUPPORTED_LOCALES } from "@/shared/i18n/locales";
import { testTranslator } from "../../../test-utils/intl";
import { rawTranslator } from "./raw-catalog";

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
    expect(gandia).toMatchObject({
      cityName: "Gandia",
      provinceName: "Valencia",
      countryCode: "ES",
    });
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
    for (const locale of ["es", "en"] as const) {
      const t = rawTranslator("knowledge", locale);
      for (const location of LOCATION_CONTENT) {
        const text = resolveLocationContent(location, t);
        const joined = [text.intro, ...text.faqs.flatMap((f) => [f.question, f.answer])].join(" ");
        expect(joined, `${locale}/${location.slug}`).not.toMatch(forbidden);
      }
    }
  });

  it("getLocationContentBySlug returns undefined for an unknown slug", () => {
    expect(getLocationContentBySlug("madrid")).toBeUndefined();
  });

  it.each([...SUPPORTED_LOCALES])("resolves every location knowledge key in %s", (locale) => {
    const t = rawTranslator("knowledge", locale);
    for (const location of LOCATION_CONTENT) {
      for (const key of [
        `locations.${location.slug}.intro`,
        ...location.faqs.map((f) => `locations.${location.slug}.faqs.${f}.answer`),
      ]) {
        expect(t.has(key as never), `${locale}: ${key}`).toBe(true);
      }
    }
  });

  it("keeps city names untranslated and localizes the country name", () => {
    const ru = resolveLocationContent(
      getLocationContentBySlug("gandia")!,
      testTranslator("knowledge", "ru"),
    );
    expect(ru.intro).toContain("Gandia");
    expect(localizeCountryName(testTranslator("services", "es"), "ES")).toBe("España");
    expect(localizeCountryName(testTranslator("services", "nl"), "ES")).toBe("Spanje");
    expect(localizeCountryName(testTranslator("services", "en"), "XX")).toBe("XX");
  });
});
