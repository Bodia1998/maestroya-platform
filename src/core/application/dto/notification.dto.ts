import { z } from "zod";

import {
  DEFAULT_PAGE_SIZE,
  MAX_ACTION_URL_LENGTH,
  MAX_MESSAGE_LENGTH,
  MAX_PAGE_SIZE,
  MAX_RESOURCE_ID_LENGTH,
  MAX_RESOURCE_TYPE_LENGTH,
  MAX_TITLE_LENGTH,
  isSafeActionUrl,
} from "@/domain/services/notification-rules";

/**
 * Notifications module (Module 15). Same convention as review.dto.ts/
 * portfolio.dto.ts: one schema shared by the client-facing Server Action
 * boundary and (for the internal create path) the trusted server-side
 * callers that create notifications as a side effect of another module's
 * action.
 *
 * Deliberately absent from every client-facing schema here (`get`,
 * `list`, `markAsRead`, `dismiss`): any notion of `userId`/`recipientId`/
 * `ownerUserId` — the recipient is always the authenticated caller,
 * resolved server-side from the session, never accepted as client input.
 * `createNotificationSchema` is the one exception: `userId` (the
 * recipient) is a required field there, but that schema is only ever used
 * by the internal, non-Server-Action create path (see
 * CreateNotificationUseCase's own doc comment) — it is never wired to a
 * public Server Action.
 */

const notificationTypeSchema = z.enum([
  "NEW_QUOTE",
  "QUOTE_ACCEPTED",
  "QUOTE_REJECTED",
  "NEW_MESSAGE",
  "APPOINTMENT_PROPOSED",
  "APPOINTMENT_CONFIRMED",
  "APPOINTMENT_CANCELLED",
  "JOB_STARTED",
  "JOB_COMPLETED",
  "JOB_CANCELLED",
  "REVIEW_RECEIVED",
]);

const actionUrlSchema = z
  .string()
  .trim()
  .max(MAX_ACTION_URL_LENGTH, "maxLength")
  .refine(isSafeActionUrl, "dto.notification.actionUrlUnsafe")
  .nullable()
  .optional();

/** Internal-only — see this file's own doc comment. Never exposed as a
 *  public Server Action. */
export const createNotificationSchema = z.object({
  userId: z.string().uuid("dto.ids.recipient"),
  type: notificationTypeSchema,
  title: z
    .string()
    .trim()
    .min(1, "dto.notification.titleRequired")
    .max(MAX_TITLE_LENGTH, "maxLength"),
  message: z
    .string()
    .trim()
    .min(1, "dto.notification.messageRequired")
    .max(MAX_MESSAGE_LENGTH, "maxLength"),
  resourceType: z
    .string()
    .trim()
    .max(MAX_RESOURCE_TYPE_LENGTH, "maxLength")
    .nullable()
    .optional(),
  resourceId: z
    .string()
    .trim()
    .max(MAX_RESOURCE_ID_LENGTH, "maxLength")
    .nullable()
    .optional(),
  actionUrl: actionUrlSchema,
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});
export type CreateNotificationInput = z.infer<typeof createNotificationSchema>;

export const listNotificationsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListNotificationsInput = z.infer<typeof listNotificationsSchema>;

export const getNotificationSchema = z.object({
  id: z.string().uuid("dto.ids.notification"),
});
export type GetNotificationInput = z.infer<typeof getNotificationSchema>;

export const markNotificationAsReadSchema = z.object({
  id: z.string().uuid("dto.ids.notification"),
});
export type MarkNotificationAsReadInput = z.infer<typeof markNotificationAsReadSchema>;

export const dismissNotificationSchema = z.object({
  id: z.string().uuid("dto.ids.notification"),
});
export type DismissNotificationInput = z.infer<typeof dismissNotificationSchema>;
