import type { NotificationTypeValue } from "@/domain/repositories/notification-repository";
import type { NotificationCategory } from "@/domain/value-objects/notification-category";
import type { NotificationChannel } from "@/application/ports/notification-channel";

/**
 * Notifications module (Module 15): the one seam through which every other
 * module (Quotes, Booking, Job, Chat, Reviews) may cause a side effect in
 * Notifications. Mirrors AppointmentNotifier/JobNotifier's own doc comment
 * verbatim — those modules' use cases depend only on this port, never on
 * NotificationRepository directly, so the dependency direction always
 * flows *into* Notifications, never the reverse.
 *
 * Deliberately minimal: a single `notify` call per event, best-effort (see
 * NullNotificationCreator below), no event bus, no queue, no retry policy
 * — same scope discipline as AppointmentNotifier/JobNotifier. The concrete
 * implementation (see infrastructure/notifications/notification-service.ts)
 * is the only code outside this module's own use cases that touches
 * NotificationRepository.
 *
 * Callers MUST wrap `notify` in try/catch (mirrors every existing call
 * site of AppointmentNotifier/JobNotifier in this codebase) — a failure
 * here must never roll back or fail the primary business operation that
 * triggered it. This port's implementation does not swallow errors itself
 * so real failures stay visible in logs rather than being silently
 * swallowed twice.
 *
 * Module 32 — Notifications & Real-Time Communication: `category`,
 * `email`, and `channels` below are new, **optional** fields added so this
 * same port/event shape can flow through the new channel-agnostic
 * `NotificationService` (`application/ports/notification-service.ts`)
 * without changing this interface's required shape or any of its ~20
 * existing call sites. Omitting them is identical to this port's pre-
 * Module-32 behavior: `category` defaults to `"INFORMATION"` and
 * `channels` defaults to `["IN_APP"]` in `NotificationServiceCreator`
 * (`infrastructure/notifications/notification-service.ts`) — i.e. every
 * existing caller keeps getting in-app-only delivery, unchanged.
 */
export interface NotificationEvent {
  /** The recipient — always resolved server-side from the triggering
   *  event's own data (e.g. a Job's customerId/professionalProfileId),
   *  never accepted as arbitrary client input anywhere in this codebase. */
  userId: string;
  type: NotificationTypeValue;
  title: string;
  message: string;
  resourceType?: string | null;
  resourceId?: string | null;
  actionUrl?: string | null;
  metadata?: Record<string, unknown> | null;
  /** Optional — see this file's Module 32 doc comment above. Defaults to
   *  `"INFORMATION"` when omitted. */
  category?: NotificationCategory;
  /** Optional — only relevant if a future caller wants to also deliver
   *  over `EMAIL`. Unused by the `IN_APP`-only call sites this codebase
   *  has today. */
  email?: string | null;
  /** Optional — see this file's Module 32 doc comment above. Defaults to
   *  `["IN_APP"]` when omitted, preserving every existing call site's
   *  current behavior exactly. */
  channels?: NotificationChannel[];
}

export interface NotificationCreator {
  notify(event: NotificationEvent): Promise<void>;
}

/**
 * No-op implementation — the default for every optional `notifications`
 * constructor parameter across Quotes/Booking/Job/Chat/Reviews use cases,
 * so every pre-existing direct construction of those use cases (this
 * codebase's own tests, mostly) keeps compiling and behaving exactly as
 * before without having to be touched. Mirrors NullJobNotifier/
 * NullAppointmentNotifier's own doc comment.
 */
export class NullNotificationCreator implements NotificationCreator {
  async notify(): Promise<void> {
    // Intentionally does nothing.
  }
}
