import type { JobCompletionConfirmationStatus } from "./job-completion-confirmation-state";

/**
 * Module 66 — Job Completion & Payment Release Protection: pure,
 * dependency-free configuration/business rules for the customer
 * confirmation window — same small-helper style as dispute-rules.ts/
 * quote-expiration-rules.ts.
 *
 * ## Business decision this module had to encode
 * Product decision (explicitly confirmed — see docs/MODULE_66_JOB_
 * COMPLETION_PAYMENT_RELEASE_PROTECTION.md, "Confirmation timeout
 * policy"): **customer silence is never treated as confirmation.** If the
 * confirmation window elapses with no customer response, the job does
 * NOT auto-release — it moves to manual review (RELEASE_HELD), same as an
 * active dispute. This is the single most important rule this file
 * encodes; every other constant here is tuning, not a safety boundary.
 *
 * `CONFIRMATION_WINDOW_HOURS`/`REMINDER_AT_HOURS` are named, adjustable
 * constants — never magic numbers scattered across use cases — mirroring
 * `DISPUTE_WINDOW_DAYS`'s own convention in dispute-rules.ts.
 */

/** How long a customer has to confirm or dispute before the confirmation
 *  is considered timed out. 72 hours — confirmed product decision. */
export const CONFIRMATION_WINDOW_HOURS = 72;

/** How long after professional completion the single reminder notice is
 *  sent — the midpoint of the window, giving the customer a nudge with
 *  still-comfortable time left to act. A single reminder (not a series)
 *  is a deliberately minimal MVP choice; revisit if real usage shows
 *  customers need more prompting. */
export const REMINDER_AT_HOURS = CONFIRMATION_WINDOW_HOURS / 2;

export function computeConfirmationDeadline(professionalCompletedAt: Date): Date {
  return new Date(professionalCompletedAt.getTime() + CONFIRMATION_WINDOW_HOURS * 60 * 60 * 1000);
}

export function computeReminderDueAt(professionalCompletedAt: Date): Date {
  return new Date(professionalCompletedAt.getTime() + REMINDER_AT_HOURS * 60 * 60 * 1000);
}

/** Whether a WAITING_FOR_CUSTOMER confirmation is past its deadline as of
 *  `now` and has not yet been resolved. Pure predicate — the use case
 *  still re-checks `status` itself inside its own transactional guard;
 *  this only expresses the time comparison. */
export function isConfirmationOverdue(
  status: JobCompletionConfirmationStatus,
  confirmationDeadlineAt: Date,
  now: Date,
): boolean {
  return status === "WAITING_FOR_CUSTOMER" && now.getTime() >= confirmationDeadlineAt.getTime();
}

/** Whether the reminder is due — window not yet expired, reminder point
 *  reached, and no reminder sent yet. */
export function isReminderDue(
  status: JobCompletionConfirmationStatus,
  professionalCompletedAt: Date,
  confirmationDeadlineAt: Date,
  reminderSentAt: Date | null,
  now: Date,
): boolean {
  if (status !== "WAITING_FOR_CUSTOMER") return false;
  if (reminderSentAt !== null) return false;
  if (now.getTime() >= confirmationDeadlineAt.getTime()) return false;
  return now.getTime() >= computeReminderDueAt(professionalCompletedAt).getTime();
}
