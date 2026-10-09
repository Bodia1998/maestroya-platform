import { describe, expect, it } from "vitest";

import { getNamespaceMessages } from "@/infrastructure/i18n/message-loader";
import { LOCALIZED_ERROR_CODES, localizeError } from "@/presentation/i18n/error-messages";
import { LEAD_PURCHASE_INELIGIBILITY_REASONS, LeadPurchaseNotEligibleError } from "@/domain/services/lead-purchase-eligibility";
import { SUPPORTED_LOCALES, type Locale } from "@/shared/i18n/locales";

/** Module 147 — every eligibility string exists in all 12 locales, for every closed reason code. */
const dig = (tree: unknown, dotted: string): unknown =>
  dotted.split(".").reduce<unknown>((node, key) => (node && typeof node === "object" ? (node as Record<string, unknown>)[key] : undefined), tree);

describe("M147 i18n — all 12 locales", () => {
  it.each([...SUPPORTED_LOCALES])("%s has the guidance title, every reason, every call-to-action and the error sentence", (locale) => {
    const professional = getNamespaceMessages(locale as Locale, "professional") as Record<string, unknown>;
    const keys = ["title", "cta.profile", "cta.verification", "cta.billing", ...LEAD_PURCHASE_INELIGIBILITY_REASONS.map((r) => `reason.${r}`)];
    for (const key of keys) {
      const value = dig(professional, `leadCheckout.eligibility.${key}`);
      expect(typeof value, `${locale}:${key}`).toBe("string");
      expect((value as string).trim().length, `${locale}:${key}`).toBeGreaterThan(0);
    }
    const errors = getNamespaceMessages(locale as Locale, "errors") as Record<string, unknown>;
    expect(typeof dig(errors, "byCode.LEAD_PURCHASE_NOT_ELIGIBLE"), locale).toBe("string");
  });

  it("the error code is registered as localized and resolves to a sentence (never the English developer message) outside English", () => {
    expect(LOCALIZED_ERROR_CODES).toContain("LEAD_PURCHASE_NOT_ELIGIBLE");
    const errors = getNamespaceMessages("es" as Locale, "errors") as { byCode: Record<string, string> };
    const t = ((key: string) => dig(errors, key) ?? key) as never;
    const message = localizeError(t, new LeadPurchaseNotEligibleError("BILLING_MISSING"));
    expect(message).toBe(errors.byCode.LEAD_PURCHASE_NOT_ELIGIBLE);
    expect(message).not.toBe("Complete your billing details before purchasing leads.");
  });
});
