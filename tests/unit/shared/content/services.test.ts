import { describe, expect, it } from "vitest";

import { SERVICE_CONTENT, getServiceContentBySlug } from "@/shared/content/services";

/**
 * Module 118 — AI-Readable Service & Location Knowledge.
 *
 * Guards the non-negotiable "do not invent a service" rule at the
 * content-catalog level: the exact six slugs `prisma/seed.ts`'s
 * `SERVICE_CATEGORIES` seeds, and nothing else — in particular, no
 * "repairs" entry (mentioned in earlier planning material but never a
 * seeded category — see the Module 118 report, "Pages Intentionally NOT
 * Created").
 */
const EXPECTED_SEEDED_SLUGS = [
  "fontaneria",
  "electricidad",
  "aire-acondicionado",
  "pintura",
  "reformas",
  "montaje-de-muebles",
].sort();

describe("SERVICE_CONTENT", () => {
  it("contains exactly the slugs prisma/seed.ts seeds as top-level service categories", () => {
    expect(SERVICE_CONTENT.map((s) => s.slug).sort()).toEqual(EXPECTED_SEEDED_SLUGS);
  });

  it("never includes a 'repairs' entry (not a seeded category)", () => {
    expect(SERVICE_CONTENT.some((s) => s.slug.includes("repair"))).toBe(false);
  });

  it("has no duplicate slugs", () => {
    const slugs = SERVICE_CONTENT.map((s) => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("every relatedServiceSlugs entry points at another slug in this same catalog", () => {
    const knownSlugs = new Set(SERVICE_CONTENT.map((s) => s.slug));
    for (const service of SERVICE_CONTENT) {
      for (const related of service.relatedServiceSlugs) {
        expect(knownSlugs.has(related), `${service.slug} -> ${related}`).toBe(true);
        expect(related).not.toBe(service.slug);
      }
    }
  });

  it("every entry has at least one job type, one consideration, and one FAQ", () => {
    for (const service of SERVICE_CONTENT) {
      expect(service.commonJobTypes.length, service.slug).toBeGreaterThan(0);
      expect(service.considerations.length, service.slug).toBeGreaterThan(0);
      expect(service.faqs.length, service.slug).toBeGreaterThan(0);
    }
  });

  it("never mentions price, guarantee, or availability-count claims", () => {
    const forbidden = /\b(precio|gratis|garantizado|garantía|24\/7|urgencias 24|mejor valorado)\b/i;
    for (const service of SERVICE_CONTENT) {
      const text = [
        service.intro,
        ...service.commonJobTypes,
        ...service.whatProfessionalsTypicallyProvide,
        ...service.considerations,
        ...service.faqs.flatMap((f) => [f.question, f.answer]),
      ].join(" ");
      expect(text, service.slug).not.toMatch(forbidden);
    }
  });

  it("getServiceContentBySlug returns undefined for an unknown slug", () => {
    expect(getServiceContentBySlug("does-not-exist")).toBeUndefined();
  });
});
