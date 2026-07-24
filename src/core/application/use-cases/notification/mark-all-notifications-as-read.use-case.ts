import type { NotificationRepository } from "@/domain/repositories/notification-repository";

/**
 * Notifications module (Module 15): marks every currently-unread,
 * non-dismissed Notification belonging to the authenticated user as read
 * in one efficient bulk update (see
 * NotificationRepository.markAllAsRead's own doc comment — a single
 * UPDATE ... WHERE, never one query per row). Idempotent: calling it again
 * when nothing is unread is a harmless no-op.
 */
export class MarkAllNotificationsAsReadUseCase {
  constructor(private readonly notifications: NotificationRepository) {}

  async execute(userId: string): Promise<void> {
    await this.notifications.markAllAsRead(userId);
  }
}
