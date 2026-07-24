import { ValidationError } from "@/domain/errors/domain-error";
import type { CreateNotificationData, NotificationRecord, NotificationRepository } from "@/domain/repositories/notification-repository";
import {
  isSafeActionUrl,
  isValidMessage,
  isValidResourceId,
  isValidResourceType,
  isValidTitle,
  normalizeOptionalText,
} from "@/domain/services/notification-rules";

export interface CreateNotificationInput {
  userId: string;
  type: CreateNotificationData["type"];
  title: string;
  message: string;
  resourceType?: string | null;
  resourceId?: string | null;
  actionUrl?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Notifications module (Module 15): the only write path that creates a
 * Notification. Deliberately **not** exposed as a public Server Action —
 * there is no `createNotificationAction` anywhere in this codebase (see
 * src/app/(dashboard)/notifications/actions.ts's own doc comment) — a
 * client can never make an arbitrary user receive an arbitrary
 * notification. The only callers are:
 *   1. NotificationServiceCreator (infrastructure/notifications/
 *      notification-service.ts), the NotificationCreator port
 *      implementation other modules' use cases call through, always from
 *      trusted server-side code with a recipient derived from the
 *      triggering event's own data (see NotificationEvent's doc comment).
 *   2. Tests, directly.
 *
 * Validation mirrors the DTO boundary (notification.dto.ts) so the rule
 * holds even for callers that bypass the DTO entirely, same "defense in
 * depth" convention as CreateReviewUseCase re-checking rating bounds.
 */
export class CreateNotificationUseCase {
  constructor(private readonly notifications: NotificationRepository) {}

  async execute(input: CreateNotificationInput): Promise<NotificationRecord> {
    if (!isValidTitle(input.title)) {
      throw new ValidationError("Notification title is required and must be 200 characters or fewer.");
    }
    if (!isValidMessage(input.message)) {
      throw new ValidationError("Notification message is required and must be 2000 characters or fewer.");
    }

    const resourceType = normalizeOptionalText(input.resourceType);
    if (!isValidResourceType(resourceType)) {
      throw new ValidationError("Invalid resource type.");
    }

    const resourceId = normalizeOptionalText(input.resourceId);
    if (!isValidResourceId(resourceId)) {
      throw new ValidationError("Invalid resource id.");
    }

    const actionUrl = normalizeOptionalText(input.actionUrl);
    if (!isSafeActionUrl(actionUrl)) {
      throw new ValidationError("Action URL must be a safe, internal path.");
    }

    return this.notifications.create({
      userId: input.userId,
      type: input.type,
      title: input.title.trim(),
      message: input.message.trim(),
      resourceType,
      resourceId,
      actionUrl,
      metadata: input.metadata ?? null,
    });
  }
}
