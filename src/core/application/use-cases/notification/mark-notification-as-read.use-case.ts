import { NotFoundError } from "@/domain/errors/domain-error";
import type { NotificationRecord, NotificationRepository } from "@/domain/repositories/notification-repository";

/**
 * Notifications module (Module 15): marks a single Notification as read
 * for the *authenticated* owner. Idempotent — calling it again on an
 * already-read notification is a harmless no-op (see
 * NotificationRepository.markAsRead's own doc comment), same convention as
 * MarkConversationReadUseCase.
 *
 * Authorization: same ownership check as GetNotificationUseCase — a
 * notification that exists but belongs to another user surfaces as the
 * identical NotFoundError a nonexistent id would produce.
 */
export class MarkNotificationAsReadUseCase {
  constructor(private readonly notifications: NotificationRepository) {}

  async execute(userId: string, notificationId: string): Promise<NotificationRecord> {
    const updated = await this.notifications.markAsRead(notificationId, userId);
    if (!updated) {
      throw new NotFoundError("Notification", notificationId);
    }
    return updated;
  }
}
