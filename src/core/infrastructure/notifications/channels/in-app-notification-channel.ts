import type {
  NotificationChannel,
  NotificationChannelAdapter,
  NotificationChannelPayload,
} from "@/application/ports/notification-channel";
import { makeCreateNotificationUseCase } from "@/application/use-cases/notification/compose";

/**
 * Module 32 — Notifications & Real-Time Communication.
 *
 * `IN_APP` channel adapter: writes to the existing Module 15 Notification
 * table via `CreateNotificationUseCase` — the exact same write path
 * `NotificationServiceCreator` (`infrastructure/notifications/
 * notification-service.ts`) already used directly. No new table, no new
 * validation — `CreateNotificationUseCase` still owns both.
 */
export class InAppNotificationChannel implements NotificationChannelAdapter {
  readonly channel: NotificationChannel = "IN_APP";

  async send(payload: NotificationChannelPayload): Promise<void> {
    await makeCreateNotificationUseCase().execute({
      userId: payload.userId,
      type: payload.type,
      title: payload.title,
      message: payload.message,
      resourceType: payload.resourceType ?? null,
      resourceId: payload.resourceId ?? null,
      actionUrl: payload.actionUrl ?? null,
      metadata: payload.metadata ?? null,
    });
  }
}
