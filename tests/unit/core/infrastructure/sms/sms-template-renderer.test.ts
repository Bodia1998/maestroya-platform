import { describe, expect, it } from "vitest";

import { SUPPORTED_LOCALES } from "@/shared/i18n/locales";
import { SMS_MESSAGE_CATALOG, getSmsCatalog, type SmsTemplateKey } from "@/infrastructure/sms/sms-message-catalog";
import { renderSmsTemplate, SMS_SINGLE_SEGMENT_LIMIT } from "@/infrastructure/sms/sms-template-renderer";

const ALL_KEYS: SmsTemplateKey[] = [
  "bookingConfirmed",
  "appointmentReminder",
  "professionalAssigned",
  "quoteAccepted",
  "quoteRejected",
  "serviceRequestUpdated",
  "chatNotification",
  "disputeNotification",
  "passwordReset",
  "phoneVerification",
  "twoFactorAuthentication",
];

/** Every argument name any shipped SMS template references. */
const SAMPLE_VALUES: Record<string, string> = {
  name: "Ana",
  date: "2026-08-10",
  time: "10:00",
  amount: "€120",
  status: "COMPLETED",
  preview: "See you tomorrow",
  caseNumber: "D-1001",
  code: "482913",
};

describe("SMS message catalog completeness", () => {
  it("covers every supported locale, and nothing else", () => {
    expect(Object.keys(SMS_MESSAGE_CATALOG).sort()).toEqual([...SUPPORTED_LOCALES].sort());
  });

  it("gives every locale every template key", () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(Object.keys(SMS_MESSAGE_CATALOG[locale]).sort()).toEqual([...ALL_KEYS].sort());
    }
  });

  it("has no empty templates", () => {
    for (const locale of SUPPORTED_LOCALES) {
      for (const key of ALL_KEYS) {
        expect(SMS_MESSAGE_CATALOG[locale][key].trim(), `${locale}/${key}`).not.toBe("");
      }
    }
  });

  it("renders every shipped template without leaving any placeholder unresolved", () => {
    for (const locale of SUPPORTED_LOCALES) {
      for (const key of ALL_KEYS) {
        const rendered = renderSmsTemplate(key, locale, SAMPLE_VALUES);
        expect(rendered, `${locale}/${key}`).not.toMatch(/\{\w+\}/);
      }
    }
  });
});

describe("getSmsCatalog", () => {
  it("falls back to the default locale for an unsupported/unknown code", () => {
    expect(getSmsCatalog("xx")).toBe(SMS_MESSAGE_CATALOG.es);
    expect(getSmsCatalog(null)).toBe(SMS_MESSAGE_CATALOG.es);
    expect(getSmsCatalog(undefined)).toBe(SMS_MESSAGE_CATALOG.es);
  });

  it("resolves a supported locale directly", () => {
    expect(getSmsCatalog("en")).toBe(SMS_MESSAGE_CATALOG.en);
  });
});

describe("renderSmsTemplate", () => {
  it("substitutes every provided variable", () => {
    const rendered = renderSmsTemplate("quoteAccepted", "en", { amount: "€120" });
    expect(rendered).toBe("Your quote for €120 has been accepted. MaestroYa");
  });

  it("leaves an unresolved placeholder literal rather than throwing", () => {
    const rendered = renderSmsTemplate("quoteAccepted", "en", {});
    expect(rendered).toContain("{amount}");
  });

  it("ignores extra variables not referenced by the template", () => {
    const rendered = renderSmsTemplate("quoteRejected", "en", { unused: "value" });
    expect(rendered).toBe("Your quote has been declined. MaestroYa");
  });
});

describe("SMS_SINGLE_SEGMENT_LIMIT", () => {
  it("is the standard GSM-03.38 single-segment budget", () => {
    expect(SMS_SINGLE_SEGMENT_LIMIT).toBe(160);
  });
});
