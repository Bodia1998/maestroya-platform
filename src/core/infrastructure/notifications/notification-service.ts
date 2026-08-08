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
 * this port's ~20 existing call sites is unchanged except for the one
 * noted below: `category` defaults to `"INFORMATION"` when a caller
 * doesn't set it on its `NotificationEvent`.
 *
 * Module 48 — Real-Time System: `channels` now defaults to
 * `["IN_APP", "REALTIME"]`, not `["IN_APP"]` alone. This is the single
 * change that makes every one of this port's existing call sites
 * (Quotes/Booking/Job/Chat/Reviews/Verification/Company/Dispute/Support/
 * Workflow-Expiration — none of which pass an explicit `channels`) also
 * push in realtime, with zero call-site changes — see
 * `docs/MODULE_48_REALTIME_SYSTEM.md`'s "Event flow" section. This is
 * additive and safe: `RealTimeNotificationChannel.send` never throws and
 * is a pure no-op for a recipient with no live connection (see that
 * class's own doc comment), so every existing IN_APP-only behavior is
 * completely preserved — this only ever adds a *second*, best-effort
 * delivery attempt alongside it.
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
      channels: event.channels ?? ["IN_APP", "REALTIME"],
    });
  }
}
