import type { NotificationTypeValue } from "@/domain/repositories/notification-repository";

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
