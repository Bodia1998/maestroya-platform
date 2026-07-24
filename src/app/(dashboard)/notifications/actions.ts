"use server";

import { revalidatePath } from "next/cache";

import {
  dismissNotificationSchema,
  getNotificationSchema,
  listNotificationsSchema,
  markNotificationAsReadSchema,
} from "@/application/dto/notification.dto";
import {
  makeDismissNotificationUseCase,
  makeGetNotificationUseCase,
  makeGetUnreadNotificationCountUseCase,
  makeListNotificationsUseCase,
  makeMarkAllNotificationsAsReadUseCase,
  makeMarkNotificationAsReadUseCase,
} from "@/application/use-cases/notification/compose";
import { DomainError } from "@/domain/errors/domain-error";
import type { NotificationRecord } from "@/domain/repositories/notification-repository";
import { requireAuth } from "@/infrastructure/auth/rbac";

/**
 * Notifications module (Module 15): thin Server Action adapters — every
 * bit of business logic (pagination, user-scoping, idempotent read/
 * dismiss semantics) lives in the composed use cases, never here.
 *
 * Deliberately absent from this file: `createNotificationAction`.
 * Notification *creation* is never a client-triggerable operation — it
 * only ever happens as a trusted, server-side side effect of another
 * module's own action (see e.g. StartJobUseCase, CreateReviewUseCase),
 * through the NotificationCreator port, never through a public Server
 * Action a client could call with an arbitrary recipient/type/message. See
 * CreateNotificationUseCase's own doc comment.
 *
 * Every action here requires an authenticated session first and derives
 * `userId` exclusively from it — never from any client-supplied field —
 * so one user can never list, read, or dismiss another user's
 * notifications through these actions (see the module's "User Isolation"
 * documentation).
 */

export type ActionResult<T = undefined> =
  | { success: true; data: T }
  | { success: false; error: string };

function fromDomainError<T>(error: unknown, fallback: string): ActionResult<T> {
  if (error instanceof DomainError) {
    return { success: false, error: error.message };
  }
  console.error(error);
  return { success: false, error: fallback };
}

export async function listNotificationsAction(
  limit?: number,
  offset?: number,
): Promise<ActionResult<NotificationRecord[]>> {
  const user = await requireAuth();
  const parsed = listNotificationsSchema.safeParse({ limit, offset });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid pagination." };
  }

  try {
    const notifications = await makeListNotificationsUseCase().execute(user.id, parsed.data);
    return { success: true, data: notifications };
  } catch (error) {
    return fromDomainError(error, "Something went wrong loading your notifications.");
  }
}

export async function getUnreadNotificationCountAction(): Promise<ActionResult<number>> {
  const user = await requireAuth();
  try {
    const count = await makeGetUnreadNotificationCountUseCase().execute(user.id);
    return { success: true, data: count };
  } catch (error) {
    return fromDomainError(error, "Something went wrong loading your unread notification count.");
  }
}

export async function getNotificationAction(id: string): Promise<ActionResult<NotificationRecord>> {
  const user = await requireAuth();
  const parsed = getNotificationSchema.safeParse({ id });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid notification." };
  }

  try {
    const notification = await makeGetNotificationUseCase().execute(user.id, parsed.data.id);
    return { success: true, data: notification };
  } catch (error) {
    return fromDomainError(error, "Something went wrong loading this notification.");
  }
}

export async function markNotificationAsReadAction(id: string): Promise<ActionResult<NotificationRecord>> {
  const user = await requireAuth();
  const parsed = markNotificationAsReadSchema.safeParse({ id });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid notification." };
  }

  try {
    const notification = await makeMarkNotificationAsReadUseCase().execute(user.id, parsed.data.id);
    revalidatePath("/notifications");
    return { success: true, data: notification };
  } catch (error) {
    return fromDomainError(error, "Something went wrong marking this notification as read.");
  }
}

export async function markAllNotificationsAsReadAction(): Promise<ActionResult<undefined>> {
  const user = await requireAuth();
  try {
    await makeMarkAllNotificationsAsReadUseCase().execute(user.id);
    revalidatePath("/notifications");
    return { success: true, data: undefined };
  } catch (error) {
    return fromDomainError(error, "Something went wrong marking your notifications as read.");
  }
}

export async function dismissNotificationAction(id: string): Promise<ActionResult<NotificationRecord>> {
  const user = await requireAuth();
  const parsed = dismissNotificationSchema.safeParse({ id });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid notification." };
  }

  try {
    const notification = await makeDismissNotificationUseCase().execute(user.id, parsed.data.id);
    revalidatePath("/notifications");
    return { success: true, data: notification };
  } catch (error) {
    return fromDomainError(error, "Something went wrong dismissing this notification.");
  }
}
