import { describe, expect, it } from "vitest";

import { getNamespaceMessages } from "@/infrastructure/i18n/message-loader";
import { LOCALIZED_ERROR_CODES, localizeError } from "@/presentation/i18n/error-messages";
import { LegacyRequestCreationRedirectedError } from "@/domain/services/new-request-flow";
import { SUPPORTED_LOCALES, type Locale } from "@/shared/i18n/locales";

/** Module 165 - the redirect refusal of the legacy creation path is a real, localized sentence in all 12 locales. */
const dig = (tree: unknown, dotted: string): unknown =>
  dotted.split(".").reduce<unknown>((node, key) => (node && typeof node === "object" ? (node as Record<string, unknown>)[key] : undefined), tree);

describe("M165 i18n", () => {
  it("the error code is registered as localized", () => {
    expect(LOCALIZED_ERROR_CODES).toContain("LEGACY_REQUEST_CREATION_REDIRECTED");
  });

  it.each([...SUPPORTED_LOCALES])("%s has a non-empty sentence for the redirect refusal", (locale) => {
    const errors = getNamespaceMessages(locale as Locale, "errors") as Record<string, unknown>;
    const value = dig(errors, "byCode.LEGACY_REQUEST_CREATION_REDIRECTED");
    expect(typeof value, locale).toBe("string");
    expect((value as string).trim().length, locale).toBeGreaterThan(0);
  });

  it.each([...SUPPORTED_LOCALES])("%s: the refusal resolves to that sentence, never the English developer message, without leaking configuration", (locale) => {
    const errors = getNamespaceMessages(locale as Locale, "errors") as { byCode: Record<string, string> };
    const t = ((key: string) => dig(errors, key) ?? key) as never;
    const message = localizeError(t, new LegacyRequestCreationRedirectedError());
    expect(message).toBe(errors.byCode.LEGACY_REQUEST_CREATION_REDIRECTED);
    expect(message).not.toMatch(/ENTRY|PURCHASE|DISABLED|ENABLED|LEAD_V1|ROLLOUT|LEGACY/);
    if (locale !== "en") expect(message).not.toBe(new LegacyRequestCreationRedirectedError().message);
  });
});
