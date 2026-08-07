import type { DomainEvent } from "@/domain/events/domain-event";
import type { EventBus } from "@/application/ports/event-bus";
import { EventDispatchError } from "@/application/ports/event-dispatch-error";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";

/**
 * Module 47 — CQRS Search Engine (Roadmap Module 14).
 *
 * The "publish-and-report, never rethrow" contract, extracted into one
 * function.
 *
 * That contract is not new — `CreateDisputeUseCase` established it and
 * `CreateReviewUseCase` copied it verbatim: a failing *subscriber* (an
 * email provider outage, an audit-log write failure) must never roll back
 * or fail the write that already succeeded, so an `EventDispatchError` is
 * reported and swallowed, while any other error (a genuine bug in the bus
 * itself) still propagates.
 *
 * Module 47 needed that same six-line block in eight more use cases —
 * every place that now announces a professional/company/service-request
 * lifecycle change. Copying it eight more times would have been eight
 * more chances to get the `instanceof` check backwards and silently
 * swallow a real bug, so it is a function. Existing call sites are
 * deliberately left as they are; this is not a refactor of Modules 41/42.
 */
export async function publishDomainEvent(
  bus: EventBus,
  event: DomainEvent,
  failureReporter: FailureReporter = new NullFailureReporter(),
): Promise<void> {
  try {
    await bus.publish(event);
  } catch (error) {
    if (!(error instanceof EventDispatchError)) throw error;
    failureReporter.report(error, { event: error.eventName, eventId: error.eventId });
  }
}
