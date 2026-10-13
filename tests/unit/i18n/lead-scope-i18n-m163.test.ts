import { describe, expect, it } from "vitest";

import { getNamespaceMessages } from "@/infrastructure/i18n/message-loader";
import { LEAD_SCOPE_QUESTIONNAIRES_V1 } from "@/infrastructure/pricing/lead-scope-questionnaires.v1";
import { SUPPORTED_LOCALES, type Locale } from "@/shared/i18n/locales";
import { SCOPE_ANSWER_ISSUE_CODES_FOR_TEST } from "./scope-issue-codes";

/** Module 163 — generic scope strings exist in all 12 locales, and no released questionnaire can ship without translated labels. */
const dig = (tree: unknown, dotted: string): unknown =>
  dotted.split(".").reduce<unknown>((node, key) => (node && typeof node === "object" ? (node as Record<string, unknown>)[key] : undefined), tree);
const leadForm = (locale: Locale) => dig(getNamespaceMessages(locale, "customer"), "requests.leadForm");

describe("M163 i18n", () => {
  it.each([...SUPPORTED_LOCALES])("%s has the generic scope strings and a localized sentence for every answer issue", (locale) => {
    const form = leadForm(locale as Locale);
    const keys = ["sections.scope", "sections.scopeDescription", "scope.selectOption", "scope.integerHint", "errors.scopeInvalid", ...SCOPE_ANSWER_ISSUE_CODES_FOR_TEST.map((c) => `scope.errors.${c}`)];
    for (const key of keys) {
      const value = dig(form, key);
      expect(typeof value, `${locale}:${key}`).toBe("string");
      expect((value as string).trim().length, `${locale}:${key}`).toBeGreaterThan(0);
    }
    expect(dig(form, "scope.integerHint") as string, locale).toMatch(/\{min\}/);
    expect(dig(form, "scope.integerHint") as string, locale).toMatch(/\{max\}/);
  });

  it("every released questionnaire has a label and every option translated in all 12 locales (vacuous while the registry is empty)", () => {
    for (const definition of Object.values(LEAD_SCOPE_QUESTIONNAIRES_V1)) {
      for (const locale of SUPPORTED_LOCALES) {
        const form = leadForm(locale as Locale);
        for (const q of definition.questions) {
          expect(typeof dig(form, `scopeQuestions.${definition.categorySlug}.${q.id}.label`), `${locale}:${q.id}`).toBe("string");
          if (q.kind === "SINGLE_CHOICE") for (const o of q.options) expect(typeof dig(form, `scopeQuestions.${definition.categorySlug}.${q.id}.options.${o.value}`), `${locale}:${q.id}:${o.value}`).toBe("string");
        }
      }
    }
    expect(true).toBe(true);
  });
});
