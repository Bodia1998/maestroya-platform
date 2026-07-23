import { describe, expect, it } from "vitest";

import type { AppointmentStatusValue } from "@/domain/repositories/quote-acceptance-repository";
import {
  CANCELLED_STATUS,
  COMPLETED_STATUS,
  CONFIRMED_STATUS,
  PENDING_SCHEDULE_STATUS,
  PROPOSED_STATUS,
  RESCHEDULED_STATUS,
  canTransitionAppointmentStatus,
  isCancellableStatus,
  isCompletableStatus,
  isConfirmableStatus,
  isProposableStatus,
  isReschedulableStatus,
  isTerminalStatus,
} from "@/domain/services/appointment-state";

const ALL_STATUSES: AppointmentStatusValue[] = [
  "PENDING_SCHEDULE",
  "SCHEDULED",
  "PROPOSED",
  "CONFIRMED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
  "NO_SHOW",
  "RESCHEDULED",
];

const NON_TERMINAL: AppointmentStatusValue[] = [PENDING_SCHEDULE_STATUS, PROPOSED_STATUS, CONFIRMED_STATUS];
const TERMINAL: AppointmentStatusValue[] = ALL_STATUSES.filter((s) => !NON_TERMINAL.includes(s));

describe("appointment-state", () => {
  describe("isTerminalStatus", () => {
    it("treats PENDING_SCHEDULE, PROPOSED, CONFIRMED as non-terminal", () => {
      for (const status of NON_TERMINAL) {
        expect(isTerminalStatus(status)).toBe(false);
      }
    });

    it("treats CANCELLED, COMPLETED, RESCHEDULED, NO_SHOW, SCHEDULED, IN_PROGRESS as terminal", () => {
      for (const status of TERMINAL) {
        expect(isTerminalStatus(status)).toBe(true);
      }
    });
  });

  describe("isProposableStatus", () => {
    it("allows proposing from PENDING_SCHEDULE (initial) and PROPOSED (counter-proposal)", () => {
      expect(isProposableStatus(PENDING_SCHEDULE_STATUS)).toBe(true);
      expect(isProposableStatus(PROPOSED_STATUS)).toBe(true);
    });

    it("rejects proposing from every other status", () => {
      for (const status of ALL_STATUSES) {
        if (status === PENDING_SCHEDULE_STATUS || status === PROPOSED_STATUS) continue;
        expect(isProposableStatus(status)).toBe(false);
      }
    });
  });

  describe("isConfirmableStatus", () => {
    it("only allows confirming a PROPOSED appointment", () => {
      expect(isConfirmableStatus(PROPOSED_STATUS)).toBe(true);
      for (const status of ALL_STATUSES) {
        if (status === PROPOSED_STATUS) continue;
        expect(isConfirmableStatus(status)).toBe(false);
      }
    });
  });

  describe("isCancellableStatus", () => {
    it("allows cancelling from every non-terminal status", () => {
      for (const status of NON_TERMINAL) {
        expect(isCancellableStatus(status)).toBe(true);
      }
    });

    it("rejects cancelling a terminal appointment", () => {
      for (const status of TERMINAL) {
        expect(isCancellableStatus(status)).toBe(false);
      }
    });
  });

  describe("isReschedulableStatus", () => {
    it("only allows rescheduling PROPOSED or CONFIRMED appointments", () => {
      expect(isReschedulableStatus(PROPOSED_STATUS)).toBe(true);
      expect(isReschedulableStatus(CONFIRMED_STATUS)).toBe(true);
      expect(isReschedulableStatus(PENDING_SCHEDULE_STATUS)).toBe(false);
    });

    it("rejects rescheduling a terminal appointment", () => {
      for (const status of TERMINAL) {
        expect(isReschedulableStatus(status)).toBe(false);
      }
    });
  });

  describe("isCompletableStatus", () => {
    it("only allows completing a CONFIRMED appointment", () => {
      expect(isCompletableStatus(CONFIRMED_STATUS)).toBe(true);
      for (const status of ALL_STATUSES) {
        if (status === CONFIRMED_STATUS) continue;
        expect(isCompletableStatus(status)).toBe(false);
      }
    });
  });

  describe("canTransitionAppointmentStatus", () => {
    it("allows the full happy-path lifecycle", () => {
      expect(canTransitionAppointmentStatus(PENDING_SCHEDULE_STATUS, PROPOSED_STATUS)).toBe(true);
      expect(canTransitionAppointmentStatus(PROPOSED_STATUS, PROPOSED_STATUS)).toBe(true);
      expect(canTransitionAppointmentStatus(PROPOSED_STATUS, CONFIRMED_STATUS)).toBe(true);
      expect(canTransitionAppointmentStatus(CONFIRMED_STATUS, COMPLETED_STATUS)).toBe(true);
    });

    it("allows cancellation from every non-terminal status", () => {
      for (const status of NON_TERMINAL) {
        expect(canTransitionAppointmentStatus(status, CANCELLED_STATUS)).toBe(true);
      }
    });

    it("allows rescheduling only from PROPOSED/CONFIRMED", () => {
      expect(canTransitionAppointmentStatus(PROPOSED_STATUS, RESCHEDULED_STATUS)).toBe(true);
      expect(canTransitionAppointmentStatus(CONFIRMED_STATUS, RESCHEDULED_STATUS)).toBe(true);
      expect(canTransitionAppointmentStatus(PENDING_SCHEDULE_STATUS, RESCHEDULED_STATUS)).toBe(false);
    });

    it("never allows a transition out of a terminal status", () => {
      for (const from of TERMINAL) {
        for (const to of ALL_STATUSES) {
          expect(canTransitionAppointmentStatus(from, to)).toBe(false);
        }
      }
    });

    it("rejects nonsensical transitions", () => {
      expect(canTransitionAppointmentStatus(PENDING_SCHEDULE_STATUS, CONFIRMED_STATUS)).toBe(false);
      expect(canTransitionAppointmentStatus(PENDING_SCHEDULE_STATUS, COMPLETED_STATUS)).toBe(false);
      expect(canTransitionAppointmentStatus(CONFIRMED_STATUS, PROPOSED_STATUS)).toBe(false);
    });
  });
});
