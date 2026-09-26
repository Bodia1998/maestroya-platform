import { describe, expect, it } from "vitest";

import {
  NATIONAL_COVERAGE_CONTENT,
  resolveNationalCoverageContent,
} from "@/shared/content/national-coverage";
import { SUPPORTED_LOCALES } from "@/shared/i18n/locales";
import { testTranslator } from "../../../test-utils/intl";
import { rawTranslator } from "./raw-catalog";

// The canonical (Spanish) copy — what crawlers without language signals get.
const ES = resolveNationalCoverageContent(
  NATIONAL_COVERAGE_CONTENT,
  testTranslator("knowledge", "es"),
);

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
      ES.intro,
      ES.coverageStatement,
      ES.howLocalAvailabilityWorks,
      ...ES.faqs.flatMap((f) => [f.question, f.answer]),
    ].join(" ");

    expect(text).not.toMatch(
      /profesionales? (activos?|disponibles?) en (cada|todas?|todos los)? ?(municipio|ciudad|localidad)/i,
    );
    expect(text).not.toMatch(/\b100\s?%|garantizad|24\/7|gratis\b/i);
    expect(text).not.toMatch(/\d+\s*(profesionales|empresas|clientes|años)/i);
  });

  it("explicitly distinguishes platform scope from verified local availability", () => {
    expect(ES.coverageStatement).toMatch(/disponibilidad real/i);
    expect(ES.howLocalAvailabilityWorks).toMatch(/no garantiza/i);
    const en = resolveNationalCoverageContent(
      NATIONAL_COVERAGE_CONTENT,
      testTranslator("knowledge", "en"),
    );
    expect(en.coverageStatement).toMatch(/actual availability/i);
    expect(en.howLocalAvailabilityWorks).toMatch(/does not guarantee/i);
  });

  it("has at least one FAQ answered on the page", () => {
    expect(NATIONAL_COVERAGE_CONTENT.faqs.length).toBeGreaterThan(0);
  });

  it.each([...SUPPORTED_LOCALES])("has every national-coverage knowledge key in %s", (locale) => {
    const t = rawTranslator("knowledge", locale);
    const keys = [
      "nationalCoverage.intro",
      "nationalCoverage.coverageStatement",
      "nationalCoverage.howLocalAvailabilityWorks",
      "nationalCoverage.structuredData.name",
      "nationalCoverage.structuredData.description",
      ...NATIONAL_COVERAGE_CONTENT.faqs.map((f) => `nationalCoverage.faqs.${f}.answer`),
    ];
    for (const key of keys) expect(t.has(key as never), `${locale}: ${key}`).toBe(true);
  });
});
