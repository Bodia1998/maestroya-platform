import { describe, expect, it, vi } from "vitest";

import { createTranslator, mergeWithFallback } from "@/shared/i18n/translator";

const messages = {
  title: "Ajustes",
  language: { title: "Idioma", switchTo: "Cambiar a {language}" },
};

describe("createTranslator", () => {
  it("resolves dotted key paths", () => {
    const t = createTranslator({ locale: "es", messages });
    expect(t("title")).toBe("Ajustes");
    expect(t("language.title")).toBe("Idioma");
  });

  it("renders ICU values", () => {
    const t = createTranslator({ locale: "es", messages });
    expect(t("language.switchTo", { language: "Polski" })).toBe("Cambiar a Polski");
  });

  it("returns the qualified key and reports a miss instead of throwing", () => {
    const onMissingKey = vi.fn();
    const t = createTranslator({ locale: "es", messages, namespace: "settings", onMissingKey });

    expect(t("language.nope")).toBe("settings.language.nope");
    expect(onMissingKey).toHaveBeenCalledWith("settings.language.nope");
  });

  it("does not resolve a key that lands on an object rather than a string", () => {
    const t = createTranslator({
      locale: "es",
      messages,
      namespace: "settings",
      onMissingKey: () => {},
    });
    expect(t("language")).toBe("settings.language");
  });

  it("exposes has() and raw()", () => {
    const t = createTranslator({ locale: "es", messages });
    expect(t.has("language.title")).toBe(true);
    expect(t.has("language.missing")).toBe(false);
    expect(t.raw("language.switchTo")).toBe("Cambiar a {language}");
  });
});

describe("mergeWithFallback", () => {
  it("fills gaps from the fallback without mutating either input", () => {
    const fallback = { a: "es-a", nested: { x: "es-x", y: "es-y" } };
    const override = { nested: { y: "en-y" } };

    const merged = mergeWithFallback(fallback, override);

    expect(merged).toEqual({ a: "es-a", nested: { x: "es-x", y: "en-y" } });
    expect(fallback).toEqual({ a: "es-a", nested: { x: "es-x", y: "es-y" } });
    expect(override).toEqual({ nested: { y: "en-y" } });
  });
});
