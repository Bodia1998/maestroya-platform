import es_sms from "@/i18n/messages/es/sms.json";
import en_sms from "@/i18n/messages/en/sms.json";
import uk_sms from "@/i18n/messages/uk/sms.json";
import cs_sms from "@/i18n/messages/cs/sms.json";
import de_sms from "@/i18n/messages/de/sms.json";
import fr_sms from "@/i18n/messages/fr/sms.json";
import it_sms from "@/i18n/messages/it/sms.json";
import pt_sms from "@/i18n/messages/pt/sms.json";
import ro_sms from "@/i18n/messages/ro/sms.json";
import pl_sms from "@/i18n/messages/pl/sms.json";

import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type Locale } from "@/shared/i18n/locales";

/**
 * Module 49 — SMS Notifications.
 *
 * The static SMS message catalog — the SMS-specific counterpart of
 * `infrastructure/i18n/message-catalog.ts`, following that file's exact
 * "hand-maintained, statically-imported, one entry per (locale, file)"
 * shape for the same static-analysis reason documented there.
 *
 * Deliberately **not** folded into `NAMESPACES`/`MESSAGE_CATALOG`
 * (Module 29's shared next-intl catalog). Two reasons:
 *
 *  1. **Different rendering engine.** Module 29's catalog is rendered by
 *     next-intl's ICU `createTranslator` (ARIA-plural rules, `{date, date,
 *     medium}`-style formatters, ...) — the right tool for UI copy, but
 *     more than a 160-character SMS body needs. `sms-template-renderer.ts`
 *     uses a small `{variable}` substitution instead (see that file's own
 *     doc comment for why).
 *  2. **Different completeness contract.** Module 29's
 *     `messages-completeness.test.ts` renders every message in the shared
 *     catalog against one fixed set of ICU argument names
 *     (`name`/`language`/`count`/`min`/`max`/`year`/`date`) shared by every
 *     namespace. This module's templates need their own argument names
 *     (`code`, `amount`, `caseNumber`, `status`, `preview`, `time`) that
 *     don't belong in that shared set — this module ships its own
 *     completeness test instead
 *     (`tests/unit/core/infrastructure/sms/sms-message-catalog.test.ts`),
 *     scoped to exactly this catalog.
 *
 * Every locale `shared/i18n/locales.ts` lists is covered here too — the
 * same "every supported locale, no exceptions" bar Module 29's own catalog
 * holds itself to.
 */
export type SmsTemplateKey =
  | "bookingConfirmed"
  | "appointmentReminder"
  | "professionalAssigned"
  | "quoteAccepted"
  | "quoteRejected"
  | "serviceRequestUpdated"
  | "chatNotification"
  | "disputeNotification"
  | "passwordReset"
  | "phoneVerification"
  | "twoFactorAuthentication";

export type SmsCatalog = Record<SmsTemplateKey, string>;

export const SMS_MESSAGE_CATALOG: Record<Locale, SmsCatalog> = {
  es: es_sms,
  en: en_sms,
  uk: uk_sms,
  cs: cs_sms,
  de: de_sms,
  fr: fr_sms,
  it: it_sms,
  pt: pt_sms,
  ro: ro_sms,
  pl: pl_sms,
};

/**
 * Resolves one locale's catalog, falling back to `DEFAULT_LOCALE` for an
 * unrecognized/unsupported code — the same defensive posture
 * `toLocale`/`getLocaleCatalog` take for untrusted input (a stored
 * `User.preferredLocale`, a caller-supplied string) rather than throwing
 * mid-dispatch over a bad locale on what is already a best-effort
 * notification channel.
 */
export function getSmsCatalog(locale: string | null | undefined): SmsCatalog {
  const resolved = (SUPPORTED_LOCALES as readonly string[]).includes(locale ?? "")
    ? (locale as Locale)
    : DEFAULT_LOCALE;
  return SMS_MESSAGE_CATALOG[resolved];
}
