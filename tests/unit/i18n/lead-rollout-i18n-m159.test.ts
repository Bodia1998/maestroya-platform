import { describe, expect, it } from "vitest";

import { getNamespaceMessages } from "@/infrastructure/i18n/message-loader";
import { LOCALIZED_ERROR_CODES, localizeError } from "@/presentation/i18n/error-messages";
import { LeadV1RolloutDisabledError } from "@/domain/services/lead-rollout";
import { SUPPORTED_LOCALES, type Locale } from "@/shared/i18n/locales";

/** Module 159 — the uniform refusal is a real, localized sentence in all 12 locales (never the English developer message). */
const dig = (tree: unknown, dotted: string): unknown =>
  dotted.split(".").reduce<unknown>((node, key) => (node && typeof node === "object" ? (node as Record<string, unknown>)[key] : undefined), tree);

describe("M159 i18n", () => {
  it("the error code is registered as localized", () => {
    expect(LOCALIZED_ERROR_CODES).toContain("LEAD_V1_ROLLOUT_DISABLED");
  });

  it.each([...SUPPORTED_LOCALES])("%s has a non-empty sentence for the rollout refusal", (locale) => {
    const errors = getNamespaceMessages(locale as Locale, "errors") as Record<string, unknown>;
    const value = dig(errors, "byCode.LEAD_V1_ROLLOUT_DISABLED");
    expect(typeof value, locale).toBe("string");
    expect((value as string).trim().length, locale).toBeGreaterThan(0);
  });

  it.each([...SUPPORTED_LOCALES])("%s: the refusal resolves to that sentence, uniformly and without leaking configuration", (locale) => {
    const errors = getNamespaceMessages(locale as Locale, "errors") as { byCode: Record<string, string> };
    const t = ((key: string) => dig(errors, key) ?? key) as never;
    const message = localizeError(t, new LeadV1RolloutDisabledError());
    expect(message).toBe(errors.byCode.LEAD_V1_ROLLOUT_DISABLED);
    expect(message).not.toMatch(/ENTRY|PURCHASE|DISABLED|ENABLED|LEAD_V1|ROLLOUT/);
    if (locale !== "en") expect(message).not.toBe("This feature is not available right now.");
  });

  it.each(["en", "es"] as const)("%s has the admin rollout status strings", (locale) => {
    const admin = getNamespaceMessages(locale as Locale, "admin") as Record<string, unknown>;
    for (const key of ["leadOps.rolloutMode", "leadOps.rolloutMisconfigured"]) {
      expect(typeof dig(admin, key), `${locale}:${key}`).toBe("string");
    }
    expect(dig(admin, "leadOps.rolloutMode") as string).toContain("{mode}");
  });
});
