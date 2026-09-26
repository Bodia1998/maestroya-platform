/**
 * Module 120 — Multilingual Localization: localized rendering of stored
 * notifications for the presentation edge. The implementation is shared
 * with the infrastructure delivery channels (email/realtime render in the
 * recipient's language) — see `shared/i18n/notification-templates.ts`.
 */
export {
  NOTIFICATION_TEMPLATE_VARIANTS,
  localizeNotification,
  type LocalizedNotificationText,
  type NotificationTemplateTranslator,
  type StoredNotificationText,
} from "@/shared/i18n/notification-templates";
