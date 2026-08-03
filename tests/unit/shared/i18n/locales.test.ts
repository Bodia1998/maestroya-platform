import { describe, expect, it } from "vitest";

import {
  DEFAULT_LOCALE,
  LOCALE_DESCRIPTORS,
  SUPPORTED_LOCALES,
  getLocaleDescriptor,
  isSupportedLocale,
  toLocale,
} from "@/shared/i18n/locales";

describe("supported locales", () => {
  it("ships exactly the ten languages this module specifies, Spanish first", () => {
    expect([...SUPPORTED_LOCALES]).toEqual([
      "es",
      "en",
      "uk",
      "cs",
      "de",
      "fr",
      "it",
      "pt",
      "ro",
      "pl",
    ]);
    expect(DEFAULT_LOCALE).toBe("es");
  });

  it("has a descriptor for every supported locale and no orphans", () => {
    // This is the assertion that makes `getLocaleDescriptor`'s throw
    // unreachable: adding a locale without a descriptor fails here, at
    // test time, rather than in a rendered picker.
    expect(LOCALE_DESCRIPTORS.map((d) => d.code).sort()).toEqual([...SUPPORTED_LOCALES].sort());
    for (const descriptor of LOCALE_DESCRIPTORS) {
      expect(descriptor.nativeName.length).toBeGreaterThan(0);
      expect(descriptor.englishName.length).toBeGreaterThan(0);
    }
  });

  it("resolves a descriptor by code", () => {
    expect(getLocaleDescriptor("uk").nativeName).toBe("Українська");
  });
});

describe("isSupportedLocale / toLocale", () => {
  it("accepts shipped codes", () => {
    expect(isSupportedLocale("pl")).toBe(true);
    expect(toLocale("pl")).toBe("pl");
  });

  it("rejects everything else, including near-misses and non-strings", () => {
    for (const value of ["ca", "EN", "es-ES", "", "../../etc/passwd", null, undefined, 42, {}]) {
      expect(isSupportedLocale(value)).toBe(false);
      expect(toLocale(value)).toBeNull();
    }
  });
});
