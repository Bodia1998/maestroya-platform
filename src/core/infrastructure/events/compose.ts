import { SynchronousEventBus } from "@/infrastructure/events/synchronous-event-bus";
import type { EventBus } from "@/application/ports/event-bus";

/**
 * Module 34 — Domain Event Bus.
 *
 * Composition root for the platform's single `EventBus` — same
 * manual-composition convention as every other `compose.ts` in this
 * codebase (no DI container, see `auth/compose.ts`).
 *
 * `new SynchronousEventBus()` is called exactly once, right here — this
 * is the *only* place in the codebase that should ever construct an
 * `EventBus` implementation. That matters more here than for most other
 * services: subscriptions live in the bus's own in-memory `Map`, so a
 * second instance wouldn't share state with this one — any handler
 * registered against it would silently never see events published
 * through `eventBus` below, and vice versa. Every publisher and every
 * subscriber must go through this single shared instance.
 *
 * ## Registering handlers (the pattern for every other module)
 * This file does not — and should not — import every module's handlers
 * to wire them up centrally; that would turn one file into a dependency
 * of all 34+ modules. Instead, each module registers its own handlers
 * against this shared instance from its *own* `compose.ts`, at module
 * load time:
 *
 * ```ts
 * // application/use-cases/notification/compose.ts
 * import { eventBus } from "@/infrastructure/events/compose";
 * import { JobCompleted } from "@/domain/events/job-completed";
 * import { SendJobCompletedNotification } from "@/application/use-cases/notification/send-job-completed-notification.handler";
 *
 * eventBus.subscribe(JobCompleted, new SendJobCompletedNotification(notificationService));
 * ```
 *
 * This keeps registration explicit and readable (no reflection, no
 * decorator-based auto-discovery — a plain `subscribe()` call you can
 * grep for) while keeping each module responsible only for its own
 * handlers, not anyone else's.
 *
 * When Module 45 introduces `BullMQEventBus`, this is the only file that
 * changes: swap the `new SynchronousEventBus()` below for
 * `new BullMQEventBus(...)`. Every publisher and every handler,
 * elsewhere in the codebase, keeps importing `eventBus`/`makeEventBus`
 * from here and needs no changes, because both classes implement the
 * same `EventBus` port.
 */
export const eventBus: EventBus = new SynchronousEventBus();

export function makeEventBus(): EventBus {
  return eventBus;
}
