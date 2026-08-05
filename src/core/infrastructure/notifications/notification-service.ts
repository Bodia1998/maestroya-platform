import type { NotificationCreator, NotificationEvent } from "@/application/ports/notification-creator";
import { notificationService } from "@/infrastructure/notifications/notification-dispatcher.compose";

/**
 * Notifications module (Module 15): the only implementation of
 * NotificationCreator — mirrors ChatAppointmentNotifier/ChatJobNotifier's
 * own doc comment (the one concrete adapter a *different* module's use
 * cases are wired to via compose.ts, e.g.
 * src/core/application/use-cases/quotes/compose.ts).
 *
 * Module 32 — Notifications & Real-Time Communication: this class is now
 * a thin adapter over the channel-agnostic `NotificationService`
 * (`application/ports/notification-service.ts` /
 * `infrastructure/notifications/notification-dispatcher.ts`) instead of
 * calling `CreateNotificationUseCase` directly. Behavior for every one of
 * this port's ~20 existing call sites is unchanged: `category` defaults
 * to `"INFORMATION"` and `channels` defaults to `["IN_APP"]` when a caller
 * doesn't set them on its `NotificationEvent` (none do today), so delivery
 * stays in-app-only, exactly as before this refactor. This is the single
 * place that change was made — no Quotes/Booking/Job/Chat/Reviews/
 * Verification/Company/Dispute/Support/Workflow-Expiration call site had
 * to change.
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
    await notificationService.notify({
      userId: event.userId,
      email: event.email ?? null,
      category: event.category ?? "INFORMATION",
      type: event.type,
      title: event.title,
      message: event.message,
      resourceType: event.resourceType ?? null,
      resourceId: event.resourceId ?? null,
      actionUrl: event.actionUrl ?? null,
      metadata: event.metadata ?? null,
      channels: event.channels ?? ["IN_APP"],
    });
  }
}
