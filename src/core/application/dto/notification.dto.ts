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
  .max(MAX_ACTION_URL_LENGTH, `Action URL must be ${MAX_ACTION_URL_LENGTH} characters or fewer.`)
  .refine(isSafeActionUrl, "Action URL must be a safe, internal path.")
  .nullable()
  .optional();

/** Internal-only — see this file's own doc comment. Never exposed as a
 *  public Server Action. */
export const createNotificationSchema = z.object({
  userId: z.string().uuid("Invalid recipient."),
  type: notificationTypeSchema,
  title: z
    .string()
    .trim()
    .min(1, "Title is required.")
    .max(MAX_TITLE_LENGTH, `Title must be ${MAX_TITLE_LENGTH} characters or fewer.`),
  message: z
    .string()
    .trim()
    .min(1, "Message is required.")
    .max(MAX_MESSAGE_LENGTH, `Message must be ${MAX_MESSAGE_LENGTH} characters or fewer.`),
  resourceType: z
    .string()
    .trim()
    .max(MAX_RESOURCE_TYPE_LENGTH, `Resource type must be ${MAX_RESOURCE_TYPE_LENGTH} characters or fewer.`)
    .nullable()
    .optional(),
  resourceId: z
    .string()
    .trim()
    .max(MAX_RESOURCE_ID_LENGTH, `Resource id must be ${MAX_RESOURCE_ID_LENGTH} characters or fewer.`)
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
  id: z.string().uuid("Invalid notification."),
});
export type GetNotificationInput = z.infer<typeof getNotificationSchema>;

export const markNotificationAsReadSchema = z.object({
  id: z.string().uuid("Invalid notification."),
});
export type MarkNotificationAsReadInput = z.infer<typeof markNotificationAsReadSchema>;

export const dismissNotificationSchema = z.object({
  id: z.string().uuid("Invalid notification."),
});
export type DismissNotificationInput = z.infer<typeof dismissNotificationSchema>;
