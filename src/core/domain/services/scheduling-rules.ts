/**
 * Booking & Scheduling module (Module 10): scheduling validity rules for a
 * proposed `[start, end)` window — kept as a small dependency-free domain
 * helper, same style as money.ts/geo-distance.ts, so "what counts as a
 * valid proposal" has exactly one definition shared by
 * ProposeAppointmentTimeUseCase and RescheduleAppointmentUseCase rather
 * than duplicated inline.
 *
 * Deliberately conservative, fixed numbers rather than a configurable
 * per-category/per-professional policy — the audit's target architecture
 * explicitly defers a full availability/calendar engine (working hours,
 * buffer time, travel time) to a future module. These are the minimum
 * production-grade guardrails needed now: no scheduling in the past, no
 * unreasonably short-notice or absurdly long/short bookings.
 */

/** A proposal must be at least this far in the future at the moment it's
 *  made — protects against "propose a time that's already effectively
 *  past by the time the other party could act on it," not a hard business
 *  SLA. */
export const MIN_PROPOSAL_NOTICE_HOURS = 2;

export const MIN_APPOINTMENT_DURATION_MINUTES = 30;
export const MAX_APPOINTMENT_DURATION_HOURS = 12;

export function hasMinimumNotice(start: Date, now: Date = new Date()): boolean {
  return start.getTime() - now.getTime() >= MIN_PROPOSAL_NOTICE_HOURS * 60 * 60 * 1000;
}

export function isValidWindow(start: Date, end: Date): boolean {
  if (!(end.getTime() > start.getTime())) return false;
  const durationMs = end.getTime() - start.getTime();
  return (
    durationMs >= MIN_APPOINTMENT_DURATION_MINUTES * 60 * 1000 &&
    durationMs <= MAX_APPOINTMENT_DURATION_HOURS * 60 * 60 * 1000
  );
}
