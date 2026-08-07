import type { DomainEvent, DomainEventClass } from "@/domain/events/domain-event";

/**
 * Module 45 — Background Jobs (Roadmap Module 12).
 *
 * The wire format for a queued domain event, and the only place that
 * knows how a `DomainEvent` becomes JSON and back.
 *
 * ## Why this mirrors the events rather than redefining them
 * There is deliberately **no** per-event payload interface here, and no
 * hand-maintained map of event name to payload shape. Every such map is
 * a second definition of the domain events that drifts from the first
 * the day someone adds a field. Instead the payload is derived
 * structurally from the event instance's own enumerable properties, and
 * revived onto the **real event class's prototype** — the class the
 * publisher already passed to `subscribe()` and which the registry
 * already holds (`event-handler-registry.ts`). The domain event classes
 * in `domain/events/` remain the single source of truth for their own
 * shape; this file adds no parallel copy of any of them.
 *
 * The revived object is a genuine instance: `instanceof` holds, and
 * `DomainEvent`'s `eventName` getter works, because the prototype is the
 * real one. Handlers therefore cannot tell whether they were invoked
 * synchronously or off a queue — which is the whole requirement.
 *
 * ## `Date` handling
 * `JSON.stringify` turns a `Date` into an ISO string and `JSON.parse`
 * leaves it a string, so an event carrying a date field would silently
 * hand handlers a `string` where they declared a `Date`. Dates are
 * therefore tagged (`{ __type: "Date", value }`) on the way out and
 * rebuilt on the way in. The tag is scoped to this serializer and never
 * escapes into a handler.
 *
 * Values that JSON cannot represent at all (functions, symbols, class
 * instances other than `Date`) are rejected loudly at serialization
 * time rather than being silently dropped into `undefined` on the far
 * side. No domain event in `domain/events/` carries one today — they are
 * strings, numbers, enums, and nulls — and this keeps it that way.
 */
export interface EventJobData {
  eventName: string;
  eventId: string;
  /** ISO-8601, from `DomainEvent.occurredAt`. */
  occurredAt: string;
  /** Which subscription this job runs — see `EventHandlerRegistry`. */
  handlerId: string;
  /** The event's own fields, JSON-encoded (see the `Date` note above). */
  payload: Record<string, unknown>;
}

const DATE_TAG = "__type";

export function serializeEventJob(event: DomainEvent, handlerId: string): EventJobData {
  const payload: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(event)) {
    if (key === "occurredAt" || key === "eventId") continue; // carried on the envelope
    payload[key] = encodeValue(value, `${event.eventName}.${key}`);
  }

  return {
    eventName: event.eventName,
    eventId: event.eventId,
    occurredAt: event.occurredAt.toISOString(),
    handlerId,
    payload,
  };
}

/**
 * Rebuilds the event on `eventClass`'s prototype. Deliberately does not
 * call the constructor: constructor signatures differ per event (some
 * take five positional arguments), and `DomainEvent`'s base constructor
 * would mint a *new* `eventId` and `occurredAt`, destroying the identity
 * the job was enqueued with — which idempotency keys depend on.
 */
export function deserializeEventJob(data: EventJobData, eventClass: DomainEventClass): DomainEvent {
  const event = Object.create(eventClass.prototype) as Record<string, unknown>;

  for (const [key, value] of Object.entries(data.payload)) {
    event[key] = decodeValue(value);
  }

  Object.defineProperty(event, "eventId", { value: data.eventId, enumerable: true, writable: false });
  Object.defineProperty(event, "occurredAt", {
    value: new Date(data.occurredAt),
    enumerable: true,
    writable: false,
  });

  return event as unknown as DomainEvent;
}

function encodeValue(value: unknown, path: string): unknown {
  if (value === null || value === undefined) return null;

  const type = typeof value;
  if (type === "string" || type === "number" || type === "boolean") return value;

  if (value instanceof Date) return { [DATE_TAG]: "Date", value: value.toISOString() };

  if (Array.isArray(value)) return value.map((item, index) => encodeValue(item, `${path}[${index}]`));

  if (type === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const encoded: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      encoded[key] = encodeValue(nested, `${path}.${key}`);
    }
    return encoded;
  }

  throw new TypeError(
    `Cannot serialize domain event field "${path}" of type ${type} for background dispatch. ` +
      `Domain events must carry only JSON-representable data (strings, numbers, booleans, null, ` +
      `plain objects, arrays, and Dates) so they can be handed to a queue.`,
  );
}

function decodeValue(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;

  if (Array.isArray(value)) return value.map(decodeValue);

  const record = value as Record<string, unknown>;
  if (record[DATE_TAG] === "Date" && typeof record.value === "string") return new Date(record.value);

  const decoded: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(record)) decoded[key] = decodeValue(nested);
  return decoded;
}
