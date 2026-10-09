import { describe, expect, it } from "vitest";

import { getNamespaceMessages } from "@/infrastructure/i18n/message-loader";
import { SUPPORTED_LOCALES, type Locale } from "@/shared/i18n/locales";
import { BILLING_ENTITY_TYPES, BILLING_IDENTITY_REJECTION_REASONS } from "@/domain/services/professional-billing-identity";

/**
 * Module 146 — every professional-facing billing string exists, is non-empty and keeps its ICU
 * placeholders / rich tags in all 12 locales. (The generic messages-completeness test already
 * enforces key parity with `es`; this pins the M146-specific content and the state/reason/type
 * coverage so a new enum value cannot ship without a translation.)
 */
const STATES = ["MISSING", "PENDING_REVIEW", "VERIFIED", "NEEDS_CORRECTION"] as const;

function dig(tree: unknown, dotted: string): unknown {
  return dotted.split(".").reduce<unknown>((node, key) => (node && typeof node === "object" ? (node as Record<string, unknown>)[key] : undefined), tree);
}

const REQUIRED_KEYS = [
  "metaTitle", "title", "subtitle", "noProfile", "verifiedOn", "notVerificationNotice",
  ...STATES.flatMap((s) => [`state.${s}.label`, `state.${s}.description`]),
  ...BILLING_IDENTITY_REJECTION_REASONS.map((r) => `rejectionReason.${r}`),
  ...BILLING_ENTITY_TYPES.map((t) => `form.entityTypes.${t}`),
  "form.detailsSection", "form.addressSection", "form.entityType", "form.legalName", "form.legalNameHint", "form.taxId", "form.taxIdHint",
  "form.taxCountry", "form.countryHint", "form.addressLine1", "form.addressLine2", "form.city", "form.region", "form.postalCode", "form.country",
  "form.save", "form.saving", "form.saved", "form.changeWarning", "errors.fixErrors", "errors.save",
];

describe("M146 i18n — all 12 locales", () => {
  it("covers exactly the 12 supported locales", () => {
    expect([...SUPPORTED_LOCALES].sort()).toEqual(["cs", "de", "en", "es", "fr", "it", "nl", "pl", "pt", "ro", "ru", "uk"]);
  });

  it.each([...SUPPORTED_LOCALES])("%s has every billing string, the placeholders and the dashboard link", (locale) => {
    const professional = getNamespaceMessages(locale as Locale, "professional") as Record<string, unknown>;
    const billing = professional.billing;
    for (const key of REQUIRED_KEYS) {
      const value = dig(billing, key);
      expect(typeof value, `${locale}:${key}`).toBe("string");
      expect((value as string).trim().length, `${locale}:${key}`).toBeGreaterThan(0);
    }
    expect(dig(billing, "verifiedOn")).toContain("{date}");
    expect(dig(billing, "noProfile")).toMatch(/<link>.+<\/link>/);
    expect(typeof dig(professional, "dashboard.billingLink")).toBe("string");

    const validation = getNamespaceMessages(locale as Locale, "validation") as Record<string, unknown>;
    expect(typeof dig(validation, "dto.billingIdentity.taxId")).toBe("string");
    expect(typeof dig(validation, "dto.billingIdentity.country")).toBe("string");
  });

  it.each(["es", "en"])("%s has the admin action error fallback", (locale) => {
    const admin = getNamespaceMessages(locale as Locale, "admin") as Record<string, unknown>;
    expect(typeof dig(admin, "actionErrors.reviewingThisBillingIdentity")).toBe("string");
  });

  it("the not-verified notice is present in every locale and distinct from the verified state wording", () => {
    for (const locale of SUPPORTED_LOCALES) {
      const billing = (getNamespaceMessages(locale as Locale, "professional") as Record<string, unknown>).billing;
      expect(dig(billing, "notVerificationNotice")).not.toBe(dig(billing, "state.VERIFIED.description"));
      expect(dig(billing, "form.saved")).not.toBe(dig(billing, "state.VERIFIED.label"));
    }
  });
});
