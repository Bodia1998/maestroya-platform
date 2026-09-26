import { describe, expect, it } from "vitest";

import {
  matchSupportedLocale,
  parseAcceptLanguage,
  resolveAuthenticatedLocale,
  resolveGuestLocale,
  resolveLocale,
} from "@/shared/i18n/negotiate-locale";

describe("parseAcceptLanguage", () => {
  it("returns tags ordered by descending q-value", () => {
    expect(parseAcceptLanguage("de;q=0.5,uk;q=0.9,en;q=0.7")).toEqual(["uk", "en", "de"]);
  });

  it("treats a missing q as 1 and keeps client order among equals", () => {
    expect(parseAcceptLanguage("fr,it,pt")).toEqual(["fr", "it", "pt"]);
    expect(parseAcceptLanguage("cs;q=0.5,de")).toEqual(["de", "cs"]);
  });

  it("survives the junk real clients send", () => {
    expect(parseAcceptLanguage("  en-GB ; q=0.8 , *;q=0.1 , xx;q=notanumber ")).toEqual([
      "xx",
      "en-GB",
    ]);
    expect(parseAcceptLanguage("en;q=0")).toEqual([]);
    expect(parseAcceptLanguage("")).toEqual([]);
    expect(parseAcceptLanguage(null)).toEqual([]);
    expect(parseAcceptLanguage(undefined)).toEqual([]);
  });
});

describe("matchSupportedLocale", () => {
  it("matches on the primary subtag so regional variants resolve", () => {
    expect(matchSupportedLocale(["pt-BR"])).toBe("pt");
    expect(matchSupportedLocale(["en-US"])).toBe("en");
    expect(matchSupportedLocale(["DE-at"])).toBe("de");
  });

  it("skips unsupported candidates and returns the first supported one", () => {
    expect(matchSupportedLocale(["ca", "eu", "gl", "fr"])).toBe("fr");
  });

  it("returns null when nothing matches", () => {
    expect(matchSupportedLocale(["ja", "zh", null, undefined, ""])).toBeNull();
    expect(matchSupportedLocale([])).toBeNull();
  });
});

describe("guest resolution chain: localStorage -> browser -> Spanish", () => {
  it("prefers the stored preference over the browser", () => {
    expect(resolveGuestLocale({ storedPreference: "uk", acceptLanguage: "de,fr;q=0.8" })).toEqual({
      locale: "uk",
      source: "stored-preference",
    });
  });

  it("falls back to the browser when nothing is stored", () => {
    expect(
      resolveGuestLocale({ storedPreference: null, acceptLanguage: "pl-PL,en;q=0.5" }),
    ).toEqual({ locale: "pl", source: "browser" });
  });

  it("falls back to Spanish when the browser asks for nothing we speak", () => {
    expect(resolveGuestLocale({ storedPreference: null, acceptLanguage: "ja,zh" })).toEqual({
      locale: "es",
      source: "default",
    });
    expect(resolveGuestLocale({})).toEqual({ locale: "es", source: "default" });
  });

  it("ignores a stored value that is not a shipped locale", () => {
    // e.g. a language removed from the product, or a hand-edited cookie.
    expect(resolveGuestLocale({ storedPreference: "ca", acceptLanguage: "it" })).toEqual({
      locale: "it",
      source: "browser",
    });
  });
});

describe("authenticated resolution chain: database -> browser -> Spanish", () => {
  it("prefers the stored account preference", () => {
    expect(resolveAuthenticatedLocale({ userPreference: "cs", acceptLanguage: "en" })).toEqual({
      locale: "cs",
      source: "user-preference",
    });
  });

  it("falls back to the browser, then to Spanish", () => {
    expect(resolveAuthenticatedLocale({ userPreference: null, acceptLanguage: "ro" })).toEqual({
      locale: "ro",
      source: "browser",
    });
    expect(resolveAuthenticatedLocale({ userPreference: null, acceptLanguage: "ja" })).toEqual({
      locale: "es",
      source: "default",
    });
  });

  it("does not consult the guest cookie — the account is authoritative", () => {
    expect(
      resolveAuthenticatedLocale({
        userPreference: null,
        storedPreference: "de",
        acceptLanguage: "fr",
      }),
    ).toEqual({ locale: "fr", source: "browser" });
  });
});

describe("resolveLocale dispatch", () => {
  it("routes to the chain matching the authentication state", () => {
    const input = { userPreference: "de", storedPreference: "it", acceptLanguage: "pl" };
    expect(resolveLocale({ ...input, isAuthenticated: true }).locale).toBe("de");
    expect(resolveLocale({ ...input, isAuthenticated: false }).locale).toBe("it");
  });
});

describe("Module 120 — Russian and Dutch negotiation and fallback", () => {
  it("matches ru and nl from regional browser tags", () => {
    expect(matchSupportedLocale(parseAcceptLanguage("ru-RU,ru;q=0.9,en;q=0.5"))).toBe("ru");
    expect(matchSupportedLocale(parseAcceptLanguage("nl-BE,nl;q=0.9"))).toBe("nl");
  });

  it("honours a stored ru/nl choice over the browser for guests and accounts", () => {
    expect(resolveGuestLocale({ storedPreference: "nl", acceptLanguage: "ru" })).toEqual({
      locale: "nl",
      source: "stored-preference",
    });
    expect(resolveAuthenticatedLocale({ userPreference: "ru", acceptLanguage: "nl" })).toEqual({
      locale: "ru",
      source: "user-preference",
    });
  });

  it("falls back deterministically: unsupported → browser → Spanish", () => {
    expect(resolveGuestLocale({ storedPreference: "xx", acceptLanguage: "nl" }).locale).toBe("nl");
    expect(resolveGuestLocale({ storedPreference: "zz", acceptLanguage: "ja-JP" })).toEqual({
      locale: "es",
      source: "default",
    });
    expect(resolveAuthenticatedLocale({ userPreference: "tlh", acceptLanguage: null }).locale).toBe("es");
    // A regional variant of a supported language collapses to its primary subtag.
    expect(resolveAuthenticatedLocale({ userPreference: "ru-UA", acceptLanguage: null }).locale).toBe("ru");
  });
});
