/**
 * Booking & Scheduling module (Module 10): the one seam through which
 * Booking use cases may cause a side effect in Chat. This is an
 * application-layer *port* (interface) — Booking's use cases depend only
 * on this, never on ConversationRepository/MessageRepository directly —
 * so the dependency direction stays Booking -> Chat and never the reverse,
 * per the module spec. The concrete implementation
 * (ChatAppointmentNotifier, in infrastructure) is the only code in this
 * module that touches Chat's repositories.
 *
 * Deliberately minimal: a single `notify` call per event, best-effort
 * (implementations must never throw — see ChatAppointmentNotifier's doc
 * comment), no event bus, no queue, no retry policy. This is not a general
 * domain-event system, just the smallest extension that lets Booking
 * inform the existing chat thread when something happens.
 */

export type AppointmentEventType = "PROPOSED" | "CONFIRMED" | "CANCELLED" | "RESCHEDULED";

export interface AppointmentEvent {
  serviceRequestId: string;
  /** Denormalized straight off the Appointment record — lets the notifier
   *  resolve the professional/company side of the conversation without
   *  Booking having to expose anything more than the ids it already has. */
  professionalProfileId: string | null;
  companyProfileId: string | null;
  type: AppointmentEventType;
  /** The user whose action triggered this event — attributed as the
   *  message's sender (see schema.prisma's MessageType doc comment; there
   *  is no separate platform/system account), and used to resolve which
   *  Conversation to post into alongside the customer/professional above. */
  actorUserId: string;
  /** Plain-text notice body, already fully formed by the use case (see
   *  each use case's call site) — the notifier does not construct
   *  messages itself, keeping all "what should this say" business logic
   *  inside Booking. */
  message: string;
}

export interface AppointmentNotifier {
  notify(event: AppointmentEvent): Promise<void>;
}

/**
 * No-op implementation — used where a caller doesn't want (or, in tests,
 * doesn't need) chat notifications wired up. Keeps AppointmentNotifier a
 * required constructor dependency (so it's never silently forgotten) while
 * still letting most use-case tests ignore it entirely.
 */
export class NullAppointmentNotifier implements AppointmentNotifier {
  async notify(): Promise<void> {
    // Intentionally does nothing.
  }
}
