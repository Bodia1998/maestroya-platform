import { describe, expect, it } from "vitest";

import { NATIONAL_COVERAGE_CONTENT } from "@/shared/content/national-coverage";

/**
 * Module 118 (continuation) — Spain-wide geographic coverage.
 *
 * Guards the core distinction this continuation exists to enforce:
 * MaestroYa's platform SCOPE is Spain-wide, but the content must never
 * read as a claim that professionals are currently active in every
 * municipality, nor invent a coverage percentage, professional count, or
 * response-time guarantee.
 */
describe("NATIONAL_COVERAGE_CONTENT", () => {
  it("is keyed to the real seeded Country (Spain, code ES)", () => {
    expect(NATIONAL_COVERAGE_CONTENT.slug).toBe("espana");
    expect(NATIONAL_COVERAGE_CONTENT.countryCode).toBe("ES");
    expect(NATIONAL_COVERAGE_CONTENT.countryName).toBe("Spain");
  });

  it("never claims professionals are active in every municipality", () => {
    const text = [
      NATIONAL_COVERAGE_CONTENT.intro,
      NATIONAL_COVERAGE_CONTENT.coverageStatement,
      NATIONAL_COVERAGE_CONTENT.howLocalAvailabilityWorks,
      ...NATIONAL_COVERAGE_CONTENT.faqs.flatMap((f) => [f.question, f.answer]),
    ].join(" ");

    expect(text).not.toMatch(/profesionales? (activos?|disponibles?) en (cada|todas?|todos los)? ?(municipio|ciudad|localidad)/i);
    expect(text).not.toMatch(/\b100\s?%|garantizad|24\/7|gratis\b/i);
    expect(text).not.toMatch(/\d+\s*(profesionales|empresas|clientes|años)/i);
  });

  it("explicitly distinguishes platform scope from verified local availability", () => {
    expect(NATIONAL_COVERAGE_CONTENT.coverageStatement).toMatch(/disponibilidad real/i);
    expect(NATIONAL_COVERAGE_CONTENT.howLocalAvailabilityWorks).toMatch(/no garantiza/i);
  });

  it("has at least one FAQ answered on the page", () => {
    expect(NATIONAL_COVERAGE_CONTENT.faqs.length).toBeGreaterThan(0);
  });
});
