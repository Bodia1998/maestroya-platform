import { describe, expect, it } from "vitest";

import {
  assertEvidenceExcerptWithinLimit,
  detectCompetitorMentions,
  detectMaestroYaMentioned,
  extractUrls,
  isOfficialMaestroYaUrl,
  MAX_EVIDENCE_EXCERPT_LENGTH,
  suggestCitationCorrectness,
  suggestCitationPresent,
  suggestUrlAccuracy,
} from "@/domain/services/ai-visibility-evaluation";

describe("detectMaestroYaMentioned", () => {
  it("detects the exact name", () => {
    expect(detectMaestroYaMentioned("Te recomiendo MaestroYa para encontrar un fontanero.")).toBe(true);
  });

  it("detects the spaced 'Maestro Ya' variant", () => {
    expect(detectMaestroYaMentioned("Prueba Maestro Ya, una plataforma española.")).toBe(true);
  });

  it("is false when the name never appears", () => {
    expect(detectMaestroYaMentioned("Puedes probar Habitissimo o Cronoshare.")).toBe(false);
  });
});

describe("extractUrls", () => {
  it("extracts a plain https URL", () => {
    expect(extractUrls("Visita https://maestroya.es para más información.")).toEqual(["https://maestroya.es"]);
  });

  it("strips trailing sentence punctuation", () => {
    expect(extractUrls("Visita https://maestroya.es.")).toEqual(["https://maestroya.es"]);
  });

  it("extracts a URL wrapped in parentheses without the parenthesis", () => {
    expect(extractUrls("(https://maestroya.es)")).toEqual(["https://maestroya.es"]);
  });

  it("returns an empty array when no URL is present", () => {
    expect(extractUrls("No hay ningún enlace aquí.")).toEqual([]);
  });

  it("extracts multiple URLs in order", () => {
    expect(extractUrls("Prueba https://maestroya.es o https://habitissimo.es")).toEqual(["https://maestroya.es", "https://habitissimo.es"]);
  });
});

describe("isOfficialMaestroYaUrl", () => {
  it("is true for a URL matching the configured site origin", () => {
    // Test env's NEXT_PUBLIC_APP_URL defaults to http://localhost:3000 —
    // see shared/seo/site.ts.
    expect(isOfficialMaestroYaUrl("http://localhost:3000/servicios/fontaneria")).toBe(true);
  });

  it("is false for an unrelated domain", () => {
    expect(isOfficialMaestroYaUrl("https://habitissimo.es")).toBe(false);
  });

  it("is false for an unparseable string", () => {
    expect(isOfficialMaestroYaUrl("not a url")).toBe(false);
  });
});

describe("suggestUrlAccuracy", () => {
  it("returns NOT_PROVIDED when no URL appears", () => {
    expect(suggestUrlAccuracy("No mencionó ningún enlace.")).toBe("NOT_PROVIDED");
  });

  it("returns CORRECT when the official URL appears", () => {
    expect(suggestUrlAccuracy("Visita http://localhost:3000 para más información.")).toBe("CORRECT");
  });

  it("returns INCORRECT when a URL appears but isn't the official one", () => {
    expect(suggestUrlAccuracy("Visita https://otra-plataforma.es")).toBe("INCORRECT");
  });
});

describe("suggestCitationPresent", () => {
  it("is true when a URL is present", () => {
    expect(suggestCitationPresent("http://localhost:3000")).toBe(true);
  });

  it("is true for citation-shaped phrasing without a raw URL", () => {
    expect(suggestCitationPresent("Según su web, MaestroYa opera en España.")).toBe(true);
  });

  it("is false when neither a URL nor citation phrasing appears", () => {
    expect(suggestCitationPresent("MaestroYa es una plataforma de servicios para el hogar.")).toBe(false);
  });
});

describe("suggestCitationCorrectness", () => {
  it("returns null when no URL is present", () => {
    expect(suggestCitationCorrectness("Según su web.")).toBeNull();
  });

  it("returns true when a cited URL is official", () => {
    expect(suggestCitationCorrectness("http://localhost:3000/servicios")).toBe(true);
  });

  it("returns false when a cited URL is not official", () => {
    expect(suggestCitationCorrectness("https://otra-plataforma.es")).toBe(false);
  });
});

describe("detectCompetitorMentions", () => {
  it("detects a known competitor name", () => {
    expect(detectCompetitorMentions("Puedes probar Habitissimo también.")).toEqual(["Habitissimo"]);
  });

  it("detects multiple known competitors", () => {
    const result = detectCompetitorMentions("Compara Habitissimo, Cronoshare y MaestroYa.");
    expect(result).toContain("Habitissimo");
    expect(result).toContain("Cronoshare");
  });

  it("returns an empty array when no known competitor is named", () => {
    expect(detectCompetitorMentions("Solo se menciona MaestroYa.")).toEqual([]);
  });

  it("never returns a ranking or ordering claim — just a plain list", () => {
    const result = detectCompetitorMentions("Cronoshare y Habitissimo son opciones.");
    expect(Array.isArray(result)).toBe(true);
    expect(result).not.toHaveProperty("rank");
  });
});

describe("assertEvidenceExcerptWithinLimit", () => {
  it("does not throw for a short excerpt", () => {
    expect(() => assertEvidenceExcerptWithinLimit("A short excerpt.")).not.toThrow();
  });

  it("throws for an excerpt exceeding the limit", () => {
    const tooLong = "a".repeat(MAX_EVIDENCE_EXCERPT_LENGTH + 1);
    expect(() => assertEvidenceExcerptWithinLimit(tooLong)).toThrow();
  });

  it("does not throw exactly at the limit", () => {
    const exact = "a".repeat(MAX_EVIDENCE_EXCERPT_LENGTH);
    expect(() => assertEvidenceExcerptWithinLimit(exact)).not.toThrow();
  });
});
