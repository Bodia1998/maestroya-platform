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
 */
export const NOTIFICATION_CHANNELS = ["IN_APP", "EMAIL", "WEB_PUSH", "REALTIME"] as const;

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
