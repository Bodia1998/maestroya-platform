import type { NotificationRepository } from "@/domain/repositories/notification-repository";

/**
 * Notifications module (Module 15): total unread, non-dismissed
 * notification count for the authenticated user — backs a single nav
 * badge, mirrors Chat's own GetUnreadCountUseCase exactly (see that file's
 * own doc comment on why there's no id-based authorization check needed
 * here beyond the userId scoping already baked into the repository call).
 */
export class GetUnreadNotificationCountUseCase {
  constructor(private readonly notifications: NotificationRepository) {}

  async execute(userId: string): Promise<number> {
    return this.notifications.countUnreadForUser(userId);
  }
}
