import { Prisma } from "@prisma/client";

import { prisma } from "@/infrastructure/database/prisma/client";
import type {
  CreateNotificationData,
  ListNotificationsOptions,
  NotificationRecord,
  NotificationRepository,
  NotificationTypeValue,
} from "@/domain/repositories/notification-repository";

const DETAIL_SELECT = {
  id: true,
  userId: true,
  type: true,
  title: true,
  message: true,
  resourceType: true,
  resourceId: true,
  actionUrl: true,
  metadata: true,
  readAt: true,
  dismissedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

type PrismaNotificationRow = {
  id: string;
  userId: string;
  type: string;
  title: string;
  message: string;
  resourceType: string | null;
  resourceId: string | null;
  actionUrl: string | null;
  metadata: Prisma.JsonValue | null;
  readAt: Date | null;
  dismissedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function toRecord(row: PrismaNotificationRow): NotificationRecord {
  return {
    id: row.id,
    userId: row.userId,
    type: row.type as NotificationTypeValue,
    title: row.title,
    message: row.message,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    actionUrl: row.actionUrl,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    readAt: row.readAt,
    dismissedAt: row.dismissedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Notifications module (Module 15): Prisma implementation of
 * NotificationRepository. Follows the same shape as
 * PrismaReviewRepository/PrismaPortfolioRepository — narrow SELECTs, plain-
 * object mapping, no Prisma types leaking past this file. Every read that
 * isn't `findByIdForUser`'s own error path filters `dismissedAt: null`
 * unless explicitly documented otherwise, matching the "a
 * dismissed/deleted row behaves like it never existed" convention
 * PortfolioRepository already uses for `deletedAt`.
 *
 * Every method is scoped to `userId` at the query's WHERE clause — never
 * an application-level filter applied after an unscoped fetch — so it is
 * structurally impossible for one user's row to be returned, updated, or
 * counted for another user's call (see this module's documentation, "User
 * Isolation").
 */
export class PrismaNotificationRepository implements NotificationRepository {
  async create(data: CreateNotificationData): Promise<NotificationRecord> {
    const row = await prisma.notification.create({
      data: {
        userId: data.userId,
        type: data.type,
        title: data.title,
        message: data.message,
        resourceType: data.resourceType,
        resourceId: data.resourceId,
        actionUrl: data.actionUrl,
        metadata: data.metadata === null ? Prisma.JsonNull : (data.metadata as Prisma.InputJsonValue),
      },
      select: DETAIL_SELECT,
    });
    return toRecord(row);
  }

  async findByIdForUser(id: string, userId: string): Promise<NotificationRecord | null> {
    const row = await prisma.notification.findFirst({
      where: { id, userId },
      select: DETAIL_SELECT,
    });
    return row ? toRecord(row) : null;
  }

  async listForUser(userId: string, options: ListNotificationsOptions): Promise<NotificationRecord[]> {
    const rows = await prisma.notification.findMany({
      where: { userId, dismissedAt: null },
      select: DETAIL_SELECT,
      orderBy: [{ createdAt: "desc" }],
      take: options.limit,
      skip: options.offset,
    });
    return rows.map(toRecord);
  }

  async countUnreadForUser(userId: string): Promise<number> {
    return prisma.notification.count({
      where: { userId, readAt: null, dismissedAt: null },
    });
  }

  async markAsRead(id: string, userId: string): Promise<NotificationRecord | null> {
    const existing = await prisma.notification.findFirst({ where: { id, userId }, select: DETAIL_SELECT });
    if (!existing) return null;
    if (existing.readAt) return toRecord(existing);

    const row = await prisma.notification.update({
      where: { id },
      data: { readAt: new Date() },
      select: DETAIL_SELECT,
    });
    return toRecord(row);
  }

  async markAllAsRead(userId: string): Promise<void> {
    await prisma.notification.updateMany({
      where: { userId, readAt: null, dismissedAt: null },
      data: { readAt: new Date() },
    });
  }

  async dismiss(id: string, userId: string): Promise<NotificationRecord | null> {
    const existing = await prisma.notification.findFirst({ where: { id, userId }, select: DETAIL_SELECT });
    if (!existing) return null;
    if (existing.dismissedAt) return toRecord(existing);

    const row = await prisma.notification.update({
      where: { id },
      data: { dismissedAt: new Date() },
      select: DETAIL_SELECT,
    });
    return toRecord(row);
  }
}
