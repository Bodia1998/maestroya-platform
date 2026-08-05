import type { NotificationCategory } from "@/domain/value-objects/notification-category";
import type { NotificationTypeValue } from "@/domain/repositories/notification-repository";
import type { NotificationChannel } from "@/application/ports/notification-channel";

/**
 * Module 32 — Notifications & Real-Time Communication.
 *
 * Single, channel-agnostic entry point for triggering a user notification
 * from anywhere in the application layer — the "single source of truth"
 * this module adds. A caller describes *what happened* and *how urgent it
 * is*; `NotificationService` fans the request out to whichever channels
 * are requested (defaulting to in-app only, preserving every existing
 * call site's current behavior — see `channels` below).
 *
 * This does **not** replace `NotificationCreator`
 * (`application/ports/notification-creator.ts`) — that port, and every one
 * of its ~20 existing call sites across Quotes/Booking/Job/Chat/Reviews/
 * Verification/Company/Dispute/Support/Workflow-Expiration, is left
 * completely untouched. `NotificationServiceCreator` (its implementation)
 * is refactored to delegate to this service internally for the `IN_APP`
 * channel, so every existing call site gets the same centralized dispatch
 * machinery for free without a single one of those files changing.
 */
export interface NotificationRequest {
  /** Recipient's User.id — resolved server-side by the caller from the
   *  triggering event's own data, never client-supplied. */
  userId: string;
  /** Recipient's email — only needed if `EMAIL` is included in `channels`.
   *  Omit/leave null when the caller doesn't have it on hand; the EMAIL
   *  channel adapter safely no-ops rather than throwing. */
  email?: string | null;
  category: NotificationCategory;
  type: NotificationTypeValue;
  title: string;
  message: string;
  resourceType?: string | null;
  resourceId?: string | null;
  actionUrl?: string | null;
  metadata?: Record<string, unknown> | null;
  /** Which channels to deliver over. Defaults to `["IN_APP"]` — this is
   *  what preserves every pre-existing `NotificationCreator` call site's
   *  behavior unchanged (in-app only) when routed through this service. */
  channels?: NotificationChannel[];
}

export interface NotificationService {
  notify(request: NotificationRequest): Promise<void>;
}
