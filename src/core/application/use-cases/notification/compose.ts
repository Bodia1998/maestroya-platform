import { PrismaNotificationRepository } from "@/infrastructure/database/prisma/repositories/prisma-notification-repository";
import { CreateNotificationUseCase } from "@/application/use-cases/notification/create-notification.use-case";
import { DismissNotificationUseCase } from "@/application/use-cases/notification/dismiss-notification.use-case";
import { GetNotificationUseCase } from "@/application/use-cases/notification/get-notification.use-case";
import { GetUnreadNotificationCountUseCase } from "@/application/use-cases/notification/get-unread-notification-count.use-case";
import { ListNotificationsUseCase } from "@/application/use-cases/notification/list-notifications.use-case";
import { MarkAllNotificationsAsReadUseCase } from "@/application/use-cases/notification/mark-all-notifications-as-read.use-case";
import { MarkNotificationAsReadUseCase } from "@/application/use-cases/notification/mark-notification-as-read.use-case";

const notifications = new PrismaNotificationRepository();

/** Internal only — never wired to a public Server Action. See
 *  CreateNotificationUseCase's own doc comment. Exported for
 *  infrastructure/notifications/notification-service.ts (the
 *  NotificationCreator port implementation other modules call through)
 *  and for tests. */
export function makeCreateNotificationUseCase() {
  return new CreateNotificationUseCase(notifications);
}

export function makeListNotificationsUseCase() {
  return new ListNotificationsUseCase(notifications);
}

export function makeGetNotificationUseCase() {
  return new GetNotificationUseCase(notifications);
}

export function makeGetUnreadNotificationCountUseCase() {
  return new GetUnreadNotificationCountUseCase(notifications);
}

export function makeMarkNotificationAsReadUseCase() {
  return new MarkNotificationAsReadUseCase(notifications);
}

export function makeMarkAllNotificationsAsReadUseCase() {
  return new MarkAllNotificationsAsReadUseCase(notifications);
}

export function makeDismissNotificationUseCase() {
  return new DismissNotificationUseCase(notifications);
}
