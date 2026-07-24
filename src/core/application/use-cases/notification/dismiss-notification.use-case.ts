import { NotFoundError } from "@/domain/errors/domain-error";
import type { NotificationRecord, NotificationRepository } from "@/domain/repositories/notification-repository";

/**
 * Notifications module (Module 15): dismisses (soft-deletes) a single
 * Notification for the *authenticated* owner — sets `dismissedAt`, never a
 * hard DELETE (see NotificationRepository.dismiss's own doc comment).
 * Idempotent: dismissing an already-dismissed notification is a harmless
 * no-op that still returns the (unchanged) record rather than erroring.
 *
 * Authorization: same ownership check as every other user-scoped
 * Notification use case — another user's notification behaves exactly
 * like a nonexistent one.
 */
export class DismissNotificationUseCase {
  constructor(private readonly notifications: NotificationRepository) {}

  async execute(userId: string, notificationId: string): Promise<NotificationRecord> {
    const updated = await this.notifications.dismiss(notificationId, userId);
    if (!updated) {
      throw new NotFoundError("Notification", notificationId);
    }
    return updated;
  }
}
