/**
 * Order / Job Lifecycle module (Module 11): the one seam through which Job
 * use cases may cause a side effect in Chat — mirrors
 * application/ports/appointment-notifier.ts's own doc comment verbatim.
 * Job use cases depend only on this, never on
 * ConversationRepository/MessageRepository directly, so the dependency
 * direction stays Job -> Chat and never the reverse: Job lifecycle may
 * notify Chat one-directionally; Chat must never own or mutate Job state.
 *
 * Kept as a separate port from AppointmentNotifier (rather than folding
 * JobEventType into AppointmentEventType) — Job and Appointment are
 * distinct aggregates with their own event vocabularies (STARTED has no
 * Appointment equivalent; COMPLETED means something different on each —
 * see job-state.ts's doc comment), and keeping them separate avoids either
 * port accumulating cases only relevant to the other. The concrete
 * implementation (ChatJobNotifier) is the only code in this module that
 * touches Chat's repositories.
 */

export type JobEventType = "STARTED" | "COMPLETED" | "CANCELLED";

export interface JobEvent {
  serviceRequestId: string;
  /** Denormalized straight off the Job record — lets the notifier resolve
   *  the professional/company side of the conversation without Job having
   *  to expose anything more than the ids it already has. */
  professionalProfileId: string | null;
  companyProfileId: string | null;
  type: JobEventType;
  /** The user whose action triggered this event — attributed as the
   *  message's sender, same convention as AppointmentEvent.actorUserId. */
  actorUserId: string;
  /** Plain-text notice body, already fully formed by the use case — the
   *  notifier does not construct messages itself. */
  message: string;
}

export interface JobNotifier {
  notify(event: JobEvent): Promise<void>;
}

/** No-op implementation — used where a caller doesn't want (or, in tests,
 *  doesn't need) chat notifications wired up. Mirrors
 *  NullAppointmentNotifier. */
export class NullJobNotifier implements JobNotifier {
  async notify(): Promise<void> {
    // Intentionally does nothing.
  }
}
