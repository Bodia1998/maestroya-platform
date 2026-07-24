import { NotFoundError } from "@/domain/errors/domain-error";
import type { NotificationRecord, NotificationRepository } from "@/domain/repositories/notification-repository";

/**
 * Notifications module (Module 15): fetches a single Notification for the
 * *authenticated* owner — e.g. to open the deep link it points at. Same
 * "not yours looks identical to doesn't exist" convention as
 * GetPortfolioItemForOwnerUseCase/GetReviewByJobUseCase: another user's
 * notification (or a nonexistent id) both surface as NotFoundError, so
 * there is no existence-leakage a caller could use to probe for valid ids
 * belonging to someone else.
 */
export class GetNotificationUseCase {
  constructor(private readonly notifications: NotificationRepository) {}

  async execute(userId: string, notificationId: string): Promise<NotificationRecord> {
    const notification = await this.notifications.findByIdForUser(notificationId, userId);
    if (!notification) {
      throw new NotFoundError("Notification", notificationId);
    }
    return notification;
  }
}
