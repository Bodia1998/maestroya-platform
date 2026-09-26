import { createTranslator } from "use-intl/core";

import { getMessages } from "@/infrastructure/i18n/message-loader";
import { DEFAULT_LOCALE, toLocale, type Locale } from "@/shared/i18n/locales";
import {
  localizeNotification,
  type LocalizedNotificationText,
  type NotificationTemplateTranslator,
  type StoredNotificationText,
} from "@/shared/i18n/notification-templates";

/**
 * Module 120 — Multilingual Localization: renders a notification in the
 * *recipient's* language for the out-of-band delivery channels (email,
 * realtime push). These run inside whatever request triggered the event —
 * e.g. the customer accepting a quote — so the request locale is the
 * actor's, not the recipient's, and must not be used.
 *
 * Locale resolution, in order:
 * 1. an explicit locale the caller already resolved for this recipient
 *    (`NotificationChannelPayload.locale`, e.g. the SMS subscriber);
 * 2. the recipient's stored `User.preferredLocale`, read through the
 *    existing `GetUserLanguagePreferenceUseCase` (never Prisma directly);
 * 3. Spanish (`DEFAULT_LOCALE`).
 * A lookup failure degrades to the next step — delivery is best-effort and
 * must never fail because of localization.
 *
 * The stored English title/message are only read, never modified.
 */
export interface RecipientLocalePreference {
  execute(userId: string): Promise<Locale | null>;
}

export interface RecipientNotification extends StoredNotificationText {
  userId: string;
  locale?: string | null;
}

export class RecipientNotificationLocalizer {
  constructor(private readonly preference: RecipientLocalePreference) {}

  async resolveLocale(userId: string, hint?: string | null): Promise<Locale> {
    const fromHint = toLocale(hint);
    if (fromHint) return fromHint;
    try {
      return (await this.preference.execute(userId)) ?? DEFAULT_LOCALE;
    } catch {
      return DEFAULT_LOCALE;
    }
  }

  async localize(notification: RecipientNotification): Promise<LocalizedNotificationText & { locale: Locale }> {
    const locale = await this.resolveLocale(notification.userId, notification.locale);
    return { locale, ...localizeNotification(notificationTranslator(locale), notification) };
  }
}

export function notificationTranslator(locale: Locale): NotificationTemplateTranslator {
  return createTranslator({
    locale,
    messages: getMessages(locale) as never,
    namespace: "notificationTemplates" as never,
    // Missing keys/arguments are handled by `localizeNotification`
    // (it checks `has` first and falls back to the stored text).
    onError: () => undefined,
  }) as unknown as NotificationTemplateTranslator;
}
