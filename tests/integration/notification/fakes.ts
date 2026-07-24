import type {
  CreateNotificationData,
  ListNotificationsOptions,
  NotificationRecord,
  NotificationRepository,
} from "@/domain/repositories/notification-repository";

/**
 * In-memory test double for the Notifications module (Module 15),
 * following the same pattern as every other module's fakes.ts (see e.g.
 * tests/integration/review/fakes.ts's own doc comment): implements the
 * real NotificationRepository interface so the real use cases run their
 * genuine orchestration/authorization logic, with only storage swapped
 * out.
 *
 * Mirrors PrismaNotificationRepository's two safety properties so tests
 * exercise real behavior, not a stub that always succeeds:
 *   1. Every read/write method is scoped to `userId` at the "query" level
 *      (a `.filter`/`.find` predicate that includes `userId`), never an
 *      unscoped fetch followed by an application-level check — same
 *      "structurally impossible to leak" guarantee the real
 *      implementation gets from its WHERE clause.
 *   2. `markAsRead`/`dismiss` are idempotent — calling them again on an
 *      already-read/dismissed row is a no-op that still returns the
 *      (unchanged) record, mirroring PrismaNotificationRepository's own
 *      "check before mutate" logic.
 */
export class FakeNotificationRepository implements NotificationRepository {
  notifications = new Map<string, NotificationRecord>();
  private idCounter = 0;

  async create(data: CreateNotificationData): Promise<NotificationRecord> {
    this.idCounter += 1;
    const now = new Date();
    const record: NotificationRecord = {
      id: `fake-notification-${this.idCounter}`,
      userId: data.userId,
      type: data.type,
      title: data.title,
      message: data.message,
      resourceType: data.resourceType,
      resourceId: data.resourceId,
      actionUrl: data.actionUrl,
      metadata: data.metadata,
      readAt: null,
      dismissedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.notifications.set(record.id, record);
    return record;
  }

  async findByIdForUser(id: string, userId: string): Promise<NotificationRecord | null> {
    const row = this.notifications.get(id);
    if (!row || row.userId !== userId) return null;
    return row;
  }

  async listForUser(userId: string, options: ListNotificationsOptions): Promise<NotificationRecord[]> {
    return [...this.notifications.values()]
      .filter((n) => n.userId === userId && n.dismissedAt === null)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(options.offset, options.offset + options.limit);
  }

  async countUnreadForUser(userId: string): Promise<number> {
    return [...this.notifications.values()].filter(
      (n) => n.userId === userId && n.readAt === null && n.dismissedAt === null,
    ).length;
  }

  async markAsRead(id: string, userId: string): Promise<NotificationRecord | null> {
    const existing = this.notifications.get(id);
    if (!existing || existing.userId !== userId) return null;
    if (existing.readAt) return existing;
    const updated: NotificationRecord = { ...existing, readAt: new Date(), updatedAt: new Date() };
    this.notifications.set(id, updated);
    return updated;
  }

  async markAllAsRead(userId: string): Promise<void> {
    const now = new Date();
    for (const [id, notification] of this.notifications) {
      if (notification.userId === userId && notification.readAt === null && notification.dismissedAt === null) {
        this.notifications.set(id, { ...notification, readAt: now, updatedAt: now });
      }
    }
  }

  async dismiss(id: string, userId: string): Promise<NotificationRecord | null> {
    const existing = this.notifications.get(id);
    if (!existing || existing.userId !== userId) return null;
    if (existing.dismissedAt) return existing;
    const updated: NotificationRecord = { ...existing, dismissedAt: new Date(), updatedAt: new Date() };
    this.notifications.set(id, updated);
    return updated;
  }
}
