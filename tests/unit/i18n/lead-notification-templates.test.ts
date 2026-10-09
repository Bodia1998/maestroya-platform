import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { leadNotificationEnglishText } from "@/application/use-cases/notification/lead-notification-sender";
import { notificationTranslator } from "@/infrastructure/notifications/recipient-notification-localizer";
import { SUPPORTED_LOCALES } from "@/shared/i18n/locales";
import { localizeNotification } from "@/shared/i18n/notification-templates";

/** Module 145 — every LEAD_V1 notification type is localized in EVERY supported locale. */
const TYPES = ["LEAD_REQUEST_PUBLISHED", "LEAD_PURCHASED", "LEAD_PURCHASE_CONFIRMED", "LEAD_PURCHASE_CANCELLED"] as const;
const ROOT = join(__dirname, "..", "..", "..");
const catalog = (locale: string) =>
  JSON.parse(readFileSync(join(ROOT, "src", "i18n", "messages", locale, "notificationTemplates.json"), "utf8")) as Record<string, { title: string; message: string }>;

describe("LEAD_V1 notification templates", () => {
  it("the platform ships 12 locales and each has all four templates with a non-empty title and a {city} message", () => {
    expect(SUPPORTED_LOCALES).toHaveLength(12);
    for (const locale of SUPPORTED_LOCALES) {
      const messages = catalog(locale);
      for (const type of TYPES) {
        expect(messages[type]?.title?.trim(), `${locale}.${type}.title`).toBeTruthy();
        expect(messages[type]?.message, `${locale}.${type}.message`).toContain("{city}");
      }
    }
  });

  it("no template exposes a payment/purchase/contact placeholder (only {city} is ever interpolated)", () => {
    for (const locale of SUPPORTED_LOCALES) {
      for (const type of TYPES) {
        const { title, message } = catalog(locale)[type]!;
        const args = [...`${title} ${message}`.matchAll(/\{\s*([A-Za-z0-9_]+)/g)].map((m) => m[1]);
        expect(new Set(args), `${locale}.${type}`).toEqual(new Set(["city"]));
      }
    }
  });

  it("the stored English fallback equals the `en` template for every type", () => {
    const en = notificationTranslator("en");
    for (const type of TYPES) {
      const stored = leadNotificationEnglishText(type, "Madrid");
      expect(localizeNotification(en, { type, ...stored, metadata: { city: "Madrid" } })).toEqual(stored);
    }
  });

  it("renders in the recipient's language with the city, and every locale differs from English", () => {
    for (const locale of SUPPORTED_LOCALES) {
      const t = notificationTranslator(locale);
      for (const type of TYPES) {
        const stored = leadNotificationEnglishText(type, "Madrid");
        const out = localizeNotification(t, { type, ...stored, metadata: { city: "Madrid" } });
        expect(out.message).toContain("Madrid");
        expect(out.message).not.toContain("{");
        if (locale !== "en") expect(out.title, `${locale}.${type}`).not.toBe(stored.title);
      }
    }
  });

  it("falls back to the stored English text (never a half-rendered template) when the city metadata is missing", () => {
    const stored = leadNotificationEnglishText("LEAD_PURCHASED", "Madrid");
    expect(localizeNotification(notificationTranslator("de"), { type: "LEAD_PURCHASED", ...stored, metadata: {} }).message).toBe(stored.message);
  });
});
