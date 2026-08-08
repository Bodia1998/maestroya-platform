import { getSmsCatalog, type SmsTemplateKey } from "@/infrastructure/sms/sms-message-catalog";

/** GSM-03.38 single-segment budget. A body longer than this is still sent
 *  (carriers/aggregators concatenate multi-segment SMS transparently) —
 *  this constant exists only so templates can be authored with a concrete
 *  target in mind and so a test can flag one that has drifted long. */
export const SMS_SINGLE_SEGMENT_LIMIT = 160;

/**
 * Module 49 — SMS Notifications.
 *
 * Renders one SMS template: looks up `key` in `locale`'s catalog (falling
 * back to the default locale for an unsupported code — see
 * `getSmsCatalog`), then substitutes `{variableName}` placeholders with
 * `variables`.
 *
 * A small hand-rolled `{name}`-style substitution, not next-intl's ICU
 * engine (`createTranslator`, used by `getTranslations()`/
 * `useTranslations()` for UI copy) — deliberately. ICU is built for
 * plurals, dates, and rich formatting rendered in a UI; an SMS body is
 * plain text with a handful of simple values (a code, an amount already
 * formatted by its caller, a short status word) and a hard length budget.
 * Reaching for the full ICU pipeline here would mean formatting `amount`/
 * `date` values through `Intl` before they can even reach a template
 * that then discards all of that formatting's markup anyway — the
 * caller already has the finished string it wants substituted in.
 *
 * A placeholder present in the template but missing from `variables`
 * (or vice versa) is not an error: it is left as literal `{text}` in the
 * template case (visible, debuggable, never a thrown exception on a
 * best-effort delivery channel — the same "must never fail the primary
 * operation" posture every other notification channel adapter takes) and
 * silently unused in the extra-variable case.
 */
export function renderSmsTemplate(
  key: SmsTemplateKey,
  locale: string | null | undefined,
  variables: Record<string, string | number>,
): string {
  const template = getSmsCatalog(locale)[key];
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = variables[name];
    return value === undefined || value === null ? match : String(value);
  });
}
