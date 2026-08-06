/**
 * Module 34 — Domain Event Bus.
 *
 * One entry per handler that threw while handling a given event. Kept
 * deliberately small — just enough for a log line, a Sentry breadcrumb,
 * or a future BullMQ per-handler retry decision — not a general-purpose
 * error-reporting shape.
 *
 * `handlerName` is best-effort: `handler.constructor.name` for a class
 * instance (the expected shape — see `EventHandler`'s own doc comment),
 * or `"anonymous"` for a plain `{ handle: fn }` object literal, which has
 * no useful constructor name of its own.
 */
export interface FailedEventHandler {
  handlerName: string;
  error: unknown;
}

/**
 * Thrown by `EventBus.publish`/`publishAll` when one or more subscribed
 * handlers fail. Replaces a plain native `AggregateError` so that:
 *
 *  - every caller catches the exact same shape whether one handler failed
 *    or five did, instead of branching on "is this an AggregateError or a
 *    plain Error";
 *  - `eventName`/`eventId` are attached directly to the error, ready to
 *    become Sentry tags/context without the catcher having to thread the
 *    triggering event through separately;
 *  - each failure keeps its own `handlerName`, so a future BullMQ-backed
 *    `EventBus` (Module 45) can report or retry per-handler rather than
 *    only at the whole-event level.
 *
 * `causes` mirrors `failures.map(f => f.error)` for callers that only
 * want the raw errors (e.g. to check `causes.some(e => e instanceof
 * SomeSpecificError)`) without destructuring `failures`.
 */
export class EventDispatchError extends Error {
  readonly eventName: string;
  readonly eventId: string;
  readonly failures: readonly FailedEventHandler[];
  readonly causes: readonly unknown[];

  constructor(eventName: string, eventId: string, failures: FailedEventHandler[]) {
    super(EventDispatchError.buildMessage(eventName, eventId, failures));
    this.name = "EventDispatchError";
    this.eventName = eventName;
    this.eventId = eventId;
    this.failures = failures;
    this.causes = failures.map((failure) => failure.error);

    // Keeps this constructor frame out of the printed stack trace, same
    // as any custom Error subclass — V8/Node only.
    if ("captureStackTrace" in Error && typeof Error.captureStackTrace === "function") {
      Error.captureStackTrace(this, EventDispatchError);
    }
  }

  private static buildMessage(eventName: string, eventId: string, failures: FailedEventHandler[]): string {
    const details = failures
      .map((failure) => `${failure.handlerName}: ${describeCause(failure.error)}`)
      .join("; ");
    return `${failures.length} handler(s) failed while dispatching "${eventName}" (eventId: ${eventId}): ${details}`;
  }
}

function describeCause(error: unknown): string {
  if (error instanceof Error) return error.message;
  try {
    return String(error);
  } catch {
    return "[unstringifiable error]";
  }
}
