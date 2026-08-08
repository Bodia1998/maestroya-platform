import type { NotificationCategory } from "@/domain/value-objects/notification-category";
import type { NotificationTypeValue } from "@/domain/repositories/notification-repository";

/**
 * Module 32 — Notifications & Real-Time Communication.
 *
 * The set of delivery mechanisms a notification can go out over. `IN_APP`
 * and `EMAIL` have real, wired implementations (see
 * `infrastructure/notifications/channels/`), reusing this codebase's
 * existing Module 15 in-app Notification pipeline and existing
 * `EmailSender`/Resend infrastructure respectively — neither channel
 * introduces a new provider or storage. `WEB_PUSH` and `REALTIME` are
 * future-ready stubs only: no web push provider (VAPID/Push API) and no
 * real-time transport (WebSocket/SSE/Pusher-style) exists anywhere in this
 * codebase today, and none is added by this module (see the module
 * instructions' explicit "do not introduce WebSockets unless already
 * present" constraint). Their adapters implement this same interface so a
 * future module can wire a real provider in without touching this port or
 * any call site.
 *
 * `SMS` was added by Module 49 — SMS Notifications, real as of that
 * module: `SmsNotificationChannel`
 * (`infrastructure/notifications/channels/sms-notification-channel.ts`)
 * enqueues onto the same Module 45 background-job queue every other
 * at-least-once delivery mechanism in this codebase uses (see that
 * class's own doc comment), backed by `TwilioSmsSender`/`MockSmsSender`
 * (`infrastructure/sms/`). Adding this member to the union is additive
 * and source-compatible: every existing `NotificationRequest`/
 * `NotificationEvent` caller that does not request `"SMS"` is completely
 * unaffected, exactly as adding `REALTIME` was in Module 48.
 */
export const NOTIFICATION_CHANNELS = ["IN_APP", "EMAIL", "WEB_PUSH", "REALTIME", "SMS"] as const;

export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/**
 * Everything a channel adapter could plausibly need to deliver a
 * notification, independent of the channel. Individual adapters use only
 * the subset relevant to them (e.g. `EmailNotificationChannel` needs
 * `email`; `InAppNotificationChannel` never reads it).
 */
export interface NotificationChannelPayload {
  userId: string;
  /** Recipient email — required for the `EMAIL` channel, unused by the
   *  others. `null`/`undefined` means "no address available"; adapters
   *  must treat that as a safe no-op, never throw. */
  email?: string | null;
  /** Recipient phone number (E.164, e.g. `+34600000000`) — required for
   *  the `SMS` channel (Module 49), unused by the others. `null`/
   *  `undefined` means "no number available"; `SmsNotificationChannel`
   *  treats that as a safe no-op, never throw — the identical contract
   *  `email` already establishes for `EMAIL`. */
  phone?: string | null;
  /** BCP-47-ish locale code (e.g. `"es"`, `"en"`) used by `SMS` (Module
   *  49) to pick which localized template to render. Unused by every
   *  other channel. Falls back to the platform default locale
   *  (`DEFAULT_LOCALE`, `shared/i18n/locales.ts`) when omitted. */
  locale?: string | null;
  category: NotificationCategory;
  type: NotificationTypeValue;
  title: string;
  message: string;
  resourceType?: string | null;
  resourceId?: string | null;
  actionUrl?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * One channel's delivery mechanism. Mirrors `NotificationCreator`'s own
 * discipline: adapters do not swallow errors themselves (the dispatcher's
 * own caller wraps `notify` in try/catch, same as every existing
 * `NotificationCreator`/`ChatAppointmentNotifier`/`ChatJobNotifier` call
 * site), so real failures stay visible in logs.
 */
export interface NotificationChannelAdapter {
  readonly channel: NotificationChannel;
  send(payload: NotificationChannelPayload): Promise<void>;
}
