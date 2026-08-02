import { describe, expect, it } from "vitest";

import { normalizeLocationText } from "@/infrastructure/geocoding/normalize-location-text";

/** Module 27 — Spain Location Services hardening. */
describe("normalizeLocationText", () => {
  it("produces the identical key for case, whitespace, and accent variants of the same city", () => {
    const variants = ["Valencia", "VALENCIA", "valencia", " València ", "valéncia", "Valéncia"];
    const normalized = variants.map(normalizeLocationText);

    expect(new Set(normalized).size).toBe(1);
    expect(normalized[0]).toBe("valencia");
  });

  it("collapses duplicate internal whitespace to a single space", () => {
    expect(normalizeLocationText("Alcalá   de     Henares")).toBe("alcala de henares");
    expect(normalizeLocationText("Alcalá de Henares")).toBe(normalizeLocationText("Alcalá   de     Henares"));
  });

  it("trims leading/trailing whitespace", () => {
    expect(normalizeLocationText("   Gandia\t\n")).toBe("gandia");
  });

  it("is idempotent", () => {
    const once = normalizeLocationText("São Paulo");
    expect(normalizeLocationText(once)).toBe(once);
  });
});
