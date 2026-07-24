import type { ListNotificationsOptions, NotificationRecord, NotificationRepository } from "@/domain/repositories/notification-repository";

/**
 * Notifications module (Module 15): paginated listing of the
 * *authenticated* user's own notifications, newest first, excluding
 * dismissed ones — backs the notification bell/inbox UI. `userId` always
 * comes from the server-side session (see the Server Action boundary),
 * never accepted as client input — there is no other user's notifications
 * this use case can be made to return, since NotificationRepository's own
 * `listForUser` is unconditionally scoped to the userId passed in.
 */
export class ListNotificationsUseCase {
  constructor(private readonly notifications: NotificationRepository) {}

  async execute(userId: string, options: ListNotificationsOptions): Promise<NotificationRecord[]> {
    return this.notifications.listForUser(userId, options);
  }
}
