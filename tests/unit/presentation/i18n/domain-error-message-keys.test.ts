import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { createTranslator } from "use-intl/core";
import { describe, expect, it } from "vitest";

import { ConflictError, NotFoundError, RateLimitedError, ValidationError } from "@/domain/errors/domain-error";
import esErrors from "@/i18n/messages/es/errors.json";
import { getMessages } from "@/infrastructure/i18n/message-loader";
import { DOMAIN_ERROR_MESSAGE_KEYS } from "@/presentation/i18n/domain-error-message-keys";
import { localizeError } from "@/presentation/i18n/error-messages";
import type { Locale } from "@/shared/i18n/locales";
import type { Translator } from "@/shared/i18n/validation-messages";

/**
 * Module 120 — the domain-error registry stays in sync with the code that
 * throws and with the catalog that renders it.
 */

const ROOT = join(__dirname, "..", "..", "..", "..");

function collectSources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) collectSources(path, out);
    else if (/\.tsx?$/.test(name)) out.push(readFileSync(path, "utf8"));
  }
  return out;
}

const SOURCES = [...collectSources(join(ROOT, "src", "core")), ...collectSources(join(ROOT, "src", "app"))].join("\n");

function errorsTranslator(locale: Locale): Translator {
  return createTranslator({
    locale,
    messages: getMessages(locale) as never,
    namespace: "errors" as never,
  }) as unknown as Translator;
}

describe("DOMAIN_ERROR_MESSAGE_KEYS", () => {
  const entries = Object.entries(DOMAIN_ERROR_MESSAGE_KEYS);

  it("is populated", () => {
    expect(entries.length).toBeGreaterThan(100);
  });

  it("only lists messages that still exist verbatim as string literals in src/core or src/app", () => {
    const missing = entries
      .map(([message]) => message)
      .filter((message) => !SOURCES.includes(JSON.stringify(message)) && !SOURCES.includes(`"${message}"`));
    expect(missing, "reworded or removed domain messages — update the registry").toEqual([]);
  });

  it("maps every message to a key that exists in es/errors.json `domain`", () => {
    const domain = esErrors.domain as Record<string, string>;
    const missing = entries.filter(([, key]) => typeof domain[key] !== "string").map(([, key]) => key);
    expect(missing).toEqual([]);
  });

  it("uses every errors.domain key (no orphan catalog entries)", () => {
    const used = new Set(Object.values(DOMAIN_ERROR_MESSAGE_KEYS));
    const orphans = Object.keys(esErrors.domain).filter((key) => !used.has(key));
    expect(orphans).toEqual([]);
  });
});

describe("localizeError", () => {
  it("returns the Russian and Dutch sentence for a registered ValidationError", () => {
    const error = new ValidationError("Only an accepted quote can be paid.");
    expect(localizeError(errorsTranslator("ru"), error)).toBe("Оплатить можно только принятую смету.");
    expect(localizeError(errorsTranslator("nl"), error)).toBe("Alleen een geaccepteerde offerte kan worden betaald.");
    expect(localizeError(errorsTranslator("es"), error)).toBe("Solo se puede pagar un presupuesto aceptado.");
  });

  it("localises a registered ConflictError thrown from infrastructure", () => {
    const error = new ConflictError("An account with this email already exists.");
    expect(localizeError(errorsTranslator("ru"), error)).toBe(
      "Аккаунт с этим адресом электронной почты уже существует.",
    );
  });

  it("falls back to the byCode sentence for an unregistered message with a known code", () => {
    const t = errorsTranslator("es");
    expect(localizeError(t, new NotFoundError("Quote", "123"))).toBe(t("byCode.NOT_FOUND"));
    expect(localizeError(t, new ValidationError("some unregistered developer message"))).toBe(
      t("byCode.VALIDATION_ERROR"),
    );
  });

  it("returns the caller's fallback (or errors.generic) for a plain Error", () => {
    const t = errorsTranslator("nl");
    expect(localizeError(t, new Error("boom"), { fallback: "X" })).toBe("X");
    expect(localizeError(t, new Error("boom"))).toBe(t("generic"));
  });

  it("returns the rateLimitedRetry text for a RateLimitedError", () => {
    const t = errorsTranslator("en");
    expect(localizeError(t, new RateLimitedError(undefined, 4200))).toBe(t("rateLimitedRetry", { seconds: 5 }));
  });
});
