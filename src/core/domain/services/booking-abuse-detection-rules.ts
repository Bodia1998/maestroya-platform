/**
 * Module 65 — Trust & Integrity System: booking-abuse rule engine —
 * excessive cancellations, fake bookings, and "ghost" customers/
 * professionals (parties who book but never follow through). Same pure
 * "caller fetches, this file only decides" convention as every other
 * Module 65 rule engine.
 */

export interface CancellationActivityInput {
  userId: string;
  /** Appointments/Jobs this user cancelled within the detection window. */
  cancellationsInWindow: number;
  /** Total Appointments/Jobs this user was party to within the same
   *  window — used to compute a cancellation *rate*, not just a raw
   *  count, so a highly active professional isn't flagged for the same
   *  absolute number a low-activity one would be. */
  totalBookingsInWindow: number;
}

export const EXCESSIVE_CANCELLATION_RATE = 0.5; // 50%+ of bookings cancelled
export const EXCESSIVE_CANCELLATION_MIN_SAMPLE = 4; // don't flag on tiny samples

export interface BookingAbuseFinding {
  reason: "EXCESSIVE_CANCELLATIONS" | "FAKE_BOOKING_PATTERN" | "GHOST_CUSTOMER" | "GHOST_PROFESSIONAL";
  userId: string;
  detail: string;
}

/** Requirement #12 — "excessive cancellations". */
export function detectExcessiveCancellations(input: CancellationActivityInput): BookingAbuseFinding | null {
  if (input.totalBookingsInWindow < EXCESSIVE_CANCELLATION_MIN_SAMPLE) return null;
  const rate = input.cancellationsInWindow / input.totalBookingsInWindow;
  if (rate < EXCESSIVE_CANCELLATION_RATE) return null;
  return {
    reason: "EXCESSIVE_CANCELLATIONS",
    userId: input.userId,
    detail: `${input.cancellationsInWindow} of ${input.totalBookingsInWindow} bookings cancelled (${(rate * 100).toFixed(0)}%, threshold ${(EXCESSIVE_CANCELLATION_RATE * 100).toFixed(0)}%).`,
  };
}

export interface GhostPartyInput {
  userId: string;
  /** Appointments confirmed/accepted but where the counterpart never
   *  showed up / never responded to follow-up — Job never transitioned
   *  past its initial scheduled state. */
  noShowOrUnresponsiveCount: number;
  confirmedBookingCount: number;
}

export const GHOST_PARTY_RATE_THRESHOLD = 0.4;
export const GHOST_PARTY_MIN_SAMPLE = 3;

/** Requirement #12 — "ghost customers": a customer who repeatedly books
 *  and then never responds/shows up, wasting a professional's held slot. */
export function detectGhostCustomer(input: GhostPartyInput): BookingAbuseFinding | null {
  if (input.confirmedBookingCount < GHOST_PARTY_MIN_SAMPLE) return null;
  const rate = input.noShowOrUnresponsiveCount / input.confirmedBookingCount;
  if (rate < GHOST_PARTY_RATE_THRESHOLD) return null;
  return {
    reason: "GHOST_CUSTOMER",
    userId: input.userId,
    detail: `${input.noShowOrUnresponsiveCount} of ${input.confirmedBookingCount} confirmed bookings had no follow-through (${(rate * 100).toFixed(0)}%, threshold ${(GHOST_PARTY_RATE_THRESHOLD * 100).toFixed(0)}%).`,
  };
}

/** Requirement #12 — "ghost professionals": the professional-side mirror
 *  of `detectGhostCustomer` — accepted a Job/Appointment and then never
 *  performed the work. */
export function detectGhostProfessional(input: GhostPartyInput): BookingAbuseFinding | null {
  if (input.confirmedBookingCount < GHOST_PARTY_MIN_SAMPLE) return null;
  const rate = input.noShowOrUnresponsiveCount / input.confirmedBookingCount;
  if (rate < GHOST_PARTY_RATE_THRESHOLD) return null;
  return {
    reason: "GHOST_PROFESSIONAL",
    userId: input.userId,
    detail: `${input.noShowOrUnresponsiveCount} of ${input.confirmedBookingCount} accepted jobs were never performed (${(rate * 100).toFixed(0)}%, threshold ${(GHOST_PARTY_RATE_THRESHOLD * 100).toFixed(0)}%).`,
  };
}

export interface FakeBookingPatternInput {
  userId: string;
  /** Bookings between this user and an account it shares a known fraud
   *  cluster with (see `fraud-detection-rules.ts`'s identifier clusters) —
   *  a booking between two accounts already linked by the same phone/
   *  IBAN/device is a strong self-dealing signal (e.g. inflating a
   *  professional's completed-job count with bookings from their own
   *  alt account). */
  bookingsWithLinkedAccount: number;
}

export const FAKE_BOOKING_LINKED_ACCOUNT_THRESHOLD = 1;

/** Requirement #12 — "fake bookings". */
export function detectFakeBookingPattern(input: FakeBookingPatternInput): BookingAbuseFinding | null {
  if (input.bookingsWithLinkedAccount < FAKE_BOOKING_LINKED_ACCOUNT_THRESHOLD) return null;
  return {
    reason: "FAKE_BOOKING_PATTERN",
    userId: input.userId,
    detail: `${input.bookingsWithLinkedAccount} booking(s) placed with an account already linked to this user by a shared fraud identifier.`,
  };
}
