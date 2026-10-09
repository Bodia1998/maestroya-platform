import { ValidationError } from "@/domain/errors/domain-error";
import type { IdempotentNotificationWriter, NotificationRecord } from "@/domain/repositories/notification-repository";
import {
  prepareNotificationData,
  type CreateNotificationInput,
} from "@/application/use-cases/notification/create-notification.use-case";

export interface CreateIdempotentNotificationInput extends CreateNotificationInput {
  dedupeKey: string;
}

const MAX_DEDUPE_KEY_LENGTH = 191;

/**
 * Module 145 — creates a notification AT MOST ONCE per (recipient, dedupeKey).
 *
 * Same validation as `CreateNotificationUseCase` (shared `prepareNotificationData`),
 * then `IdempotentNotificationWriter.createIfAbsent`, whose guarantee is the DB
 * unique index — concurrent and repeated callers get exactly one row; every other
 * caller receives `created: false` with the existing row.
 *
 * Like its sibling, never a public Server Action: the recipient is whatever the
 * trusted server-side caller derived from persisted relations.
 */
export class CreateIdempotentNotificationUseCase {
  constructor(private readonly notifications: IdempotentNotificationWriter) {}

  async execute(input: CreateIdempotentNotificationInput): Promise<{ notification: NotificationRecord; created: boolean }> {
    const dedupeKey = typeof input.dedupeKey === "string" ? input.dedupeKey.trim() : "";
    if (dedupeKey === "" || dedupeKey.length > MAX_DEDUPE_KEY_LENGTH) {
      throw new ValidationError("A notification dedupe key is required and must be 191 characters or fewer.");
    }
    return this.notifications.createIfAbsent({ ...prepareNotificationData(input), dedupeKey });
  }
}
