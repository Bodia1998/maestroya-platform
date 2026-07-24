/**
 * Notifications module (Module 15): repository interface for the
 * Notification aggregate. Follows the same "record + narrow repository
 * interface" convention as ReviewRepository/PortfolioRepository — no
 * `Entity<Props>` subclass, pure business rules live in
 * domain/services/notification-rules.ts, this file only defines the shape
 * data is read/written in.
 *
 * Every method here is scoped to a `userId` — there is deliberately no
 * bare `findById(id)` that isn't user-scoped, so it's structurally
 * impossible for a use case to accidentally fetch/mutate another user's
 * notification without going through the ownership check baked into
 * `findByIdForUser`/`markAsRead`/`dismiss` themselves (see this module's
 * documentation, "User Isolation").
 */

export type NotificationTypeValue =
  | "NEW_QUOTE"
  | "QUOTE_ACCEPTED"
  | "QUOTE_REJECTED"
  | "NEW_MESSAGE"
  | "APPOINTMENT_PROPOSED"
  | "APPOINTMENT_CONFIRMED"
  | "APPOINTMENT_CANCELLED"
  | "JOB_STARTED"
  | "JOB_COMPLETED"
  | "JOB_CANCELLED"
  | "REVIEW_RECEIVED";

export interface NotificationRecord {
  id: string;
  userId: string;
  type: NotificationTypeValue;
  title: string;
  message: string;
  resourceType: string | null;
  resourceId: string | null;
  actionUrl: string | null;
  metadata: Record<string, unknown> | null;
  readAt: Date | null;
  dismissedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * `userId` here is the *recipient* — safe to accept as a plain field only
 * on this internal create path (see CreateNotificationUseCase's own doc
 * comment for why this is never exposed as a public, client-facing
 * mutation).
 */
export interface CreateNotificationData {
  userId: string;
  type: NotificationTypeValue;
  title: string;
  message: string;
  resourceType: string | null;
  resourceId: string | null;
  actionUrl: string | null;
  metadata: Record<string, unknown> | null;
}

export interface ListNotificationsOptions {
  limit: number;
  offset: number;
}

export interface NotificationRepository {
  create(data: CreateNotificationData): Promise<NotificationRecord>;

  /** User-scoped lookup — returns null (never another user's row) if the
   *  notification doesn't exist or belongs to someone else. Callers
   *  translate a null into NotFoundError, same convention as
   *  GetPortfolioItemForOwnerUseCase. */
  findByIdForUser(id: string, userId: string): Promise<NotificationRecord | null>;

  /** Newest first, excludes dismissed rows (dismissedAt IS NULL) — see
   *  ListNotificationsUseCase. */
  listForUser(userId: string, options: ListNotificationsOptions): Promise<NotificationRecord[]>;

  /** Excludes dismissed rows — a dismissed notification is never counted as
   *  unread even if it was never marked read. */
  countUnreadForUser(userId: string): Promise<number>;

  /** Idempotent: sets readAt to now() only if currently null; calling it
   *  again on an already-read notification is a harmless no-op. Returns
   *  the updated record, or null if it doesn't exist / isn't the caller's
   *  own. */
  markAsRead(id: string, userId: string): Promise<NotificationRecord | null>;

  /** Idempotent, efficient bulk update — a single UPDATE ... WHERE
   *  userId = ? AND readAt IS NULL AND dismissedAt IS NULL, not one query
   *  per row. */
  markAllAsRead(userId: string): Promise<void>;

  /** Idempotent soft delete: sets dismissedAt to now() only if currently
   *  null. Returns the updated record, or null if it doesn't exist / isn't
   *  the caller's own. Never a hard DELETE. */
  dismiss(id: string, userId: string): Promise<NotificationRecord | null>;
}
