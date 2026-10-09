import type {
  NotificationChannel,
  NotificationChannelAdapter,
  NotificationChannelPayload,
  NotificationChannelSendResult,
} from "@/application/ports/notification-channel";

/**
 * Module 32 — Notifications & Real-Time Communication.
 *
 * `IN_APP` channel adapter: writes to the existing Module 15 Notification
 * table via `CreateNotificationUseCase` — the exact same write path
 * `NotificationServiceCreator` (`infrastructure/notifications/
 * notification-service.ts`) already used directly. No new table, no new
 * validation — `CreateNotificationUseCase` still owns both.
 *
 * `makeCreateNotificationUseCase` is imported dynamically inside `send()`
 * (instead of as a static top-level import) to break a runtime circular
 * import: `notification/compose.ts` imports `NotificationServiceCreator`
 * from `notification-service.ts`, which imports `notificationService` from
 * `notification-dispatcher.compose.ts`, which constructs this class at
 * module scope, which used to statically import back into
 * `notification/compose.ts` — a cycle that threw `Cannot access
 * 'NotificationServiceCreator' before initialization` during Next.js page
 * data collection for callers (like `workflow-expiration/compose.ts`) that
 * import `NotificationServiceCreator` first. `send()` only ever runs at
 * request time, never at module init, so this is a load-time-only change:
 * zero behavior difference, same use case, same execute() call.
 *
 * Module 145: when the payload carries a `dedupeKey` the row is created through
 * `CreateIdempotentNotificationUseCase` (DB-enforced at-most-once per recipient + key) and
 * the adapter reports `"DUPLICATE"` if the row already existed, so the dispatcher does not
 * re-deliver the replayed event on any other channel. Without a key the path is unchanged.
 */
export class InAppNotificationChannel implements NotificationChannelAdapter {
  readonly channel: NotificationChannel = "IN_APP";

  async send(payload: NotificationChannelPayload): Promise<NotificationChannelSendResult> {
    const { makeCreateNotificationUseCase, makeCreateIdempotentNotificationUseCase } = await import(
      "@/application/use-cases/notification/compose"
    );
    if (payload.dedupeKey) {
      const { created } = await makeCreateIdempotentNotificationUseCase().execute({
        userId: payload.userId,
        type: payload.type,
        title: payload.title,
        message: payload.message,
        resourceType: payload.resourceType ?? null,
        resourceId: payload.resourceId ?? null,
        actionUrl: payload.actionUrl ?? null,
        metadata: payload.metadata ?? null,
        dedupeKey: payload.dedupeKey,
      });
      return { outcome: created ? "DELIVERED" : "DUPLICATE" };
    }
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
