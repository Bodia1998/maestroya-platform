import type { NotificationCreator, NotificationEvent } from "@/application/ports/notification-creator";
import { makeCreateNotificationUseCase } from "@/application/use-cases/notification/compose";

/**
 * Notifications module (Module 15): the only implementation of
 * NotificationCreator, and the only place outside this module's own use
 * cases that touches CreateNotificationUseCase — mirrors
 * ChatAppointmentNotifier/ChatJobNotifier's own doc comment (the one
 * concrete adapter a *different* module's use cases are wired to via
 * compose.ts, e.g. src/core/application/use-cases/quotes/compose.ts).
 *
 * Deliberately thin: validation and persistence both live in
 * CreateNotificationUseCase; this class only adapts the NotificationEvent
 * shape (optional fields) to CreateNotificationUseCase's input shape.
 *
 * Does NOT swallow errors itself — same convention as
 * ChatAppointmentNotifier/ChatJobNotifier, which also let real errors
 * propagate to the caller. Every call site across Quotes/Booking/Job/Chat/
 * Reviews wraps `notify` in its own try/catch (see e.g.
 * StartJobUseCase.execute) so a notification-creation failure is caught,
 * logged, and never rolls back or fails the primary business operation
 * that triggered it.
 */
export class NotificationServiceCreator implements NotificationCreator {
  async notify(event: NotificationEvent): Promise<void> {
    await makeCreateNotificationUseCase().execute({
      userId: event.userId,
      type: event.type,
      title: event.title,
      message: event.message,
      resourceType: event.resourceType ?? null,
      resourceId: event.resourceId ?? null,
      actionUrl: event.actionUrl ?? null,
      metadata: event.metadata ?? null,
    });
  }
}
