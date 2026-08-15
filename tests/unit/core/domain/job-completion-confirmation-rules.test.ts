import { describe, expect, it } from "vitest";

import {
  CONFIRMATION_WINDOW_HOURS,
  REMINDER_AT_HOURS,
  computeConfirmationDeadline,
  computeReminderDueAt,
  isConfirmationOverdue,
  isReminderDue,
} from "@/domain/services/job-completion-confirmation-rules";

const HOUR_MS = 60 * 60 * 1000;
const completedAt = new Date("2026-01-01T00:00:00.000Z");

describe("job-completion-confirmation-rules", () => {
  it("computes a 72-hour confirmation deadline (confirmed product decision)", () => {
    expect(CONFIRMATION_WINDOW_HOURS).toBe(72);
    const deadline = computeConfirmationDeadline(completedAt);
    expect(deadline.getTime()).toBe(completedAt.getTime() + 72 * HOUR_MS);
  });

  it("computes the reminder point at the window's midpoint", () => {
    expect(REMINDER_AT_HOURS).toBe(36);
    const reminderAt = computeReminderDueAt(completedAt);
    expect(reminderAt.getTime()).toBe(completedAt.getTime() + 36 * HOUR_MS);
  });

  describe("isConfirmationOverdue — customer silence never auto-releases", () => {
    const deadline = computeConfirmationDeadline(completedAt);

    it("is false before the deadline", () => {
      const before = new Date(deadline.getTime() - HOUR_MS);
      expect(isConfirmationOverdue("WAITING_FOR_CUSTOMER", deadline, before)).toBe(false);
    });

    it("is true exactly at and after the deadline", () => {
      expect(isConfirmationOverdue("WAITING_FOR_CUSTOMER", deadline, deadline)).toBe(true);
      const after = new Date(deadline.getTime() + HOUR_MS);
      expect(isConfirmationOverdue("WAITING_FOR_CUSTOMER", deadline, after)).toBe(true);
    });

    it("is false for a status other than WAITING_FOR_CUSTOMER, even past the deadline", () => {
      const after = new Date(deadline.getTime() + HOUR_MS);
      expect(isConfirmationOverdue("CONFIRMED", deadline, after)).toBe(false);
      expect(isConfirmationOverdue("DISPUTED", deadline, after)).toBe(false);
      expect(isConfirmationOverdue("TIMED_OUT_UNDER_REVIEW", deadline, after)).toBe(false);
    });
  });

  describe("isReminderDue", () => {
    const deadline = computeConfirmationDeadline(completedAt);

    it("is false before the reminder point", () => {
      const before = new Date(completedAt.getTime() + 10 * HOUR_MS);
      expect(isReminderDue("WAITING_FOR_CUSTOMER", completedAt, deadline, null, before)).toBe(false);
    });

    it("is true once the reminder point is reached but before the deadline", () => {
      const at = new Date(completedAt.getTime() + 36 * HOUR_MS);
      expect(isReminderDue("WAITING_FOR_CUSTOMER", completedAt, deadline, null, at)).toBe(true);
    });

    it("is false once a reminder was already sent", () => {
      const at = new Date(completedAt.getTime() + 40 * HOUR_MS);
      const sentAt = new Date(completedAt.getTime() + 36 * HOUR_MS);
      expect(isReminderDue("WAITING_FOR_CUSTOMER", completedAt, deadline, sentAt, at)).toBe(false);
    });

    it("is false once the window has already expired (timeout batch owns it instead)", () => {
      const after = new Date(deadline.getTime() + HOUR_MS);
      expect(isReminderDue("WAITING_FOR_CUSTOMER", completedAt, deadline, null, after)).toBe(false);
    });

    it("is false for a status other than WAITING_FOR_CUSTOMER", () => {
      const at = new Date(completedAt.getTime() + 36 * HOUR_MS);
      expect(isReminderDue("CONFIRMED", completedAt, deadline, null, at)).toBe(false);
    });
  });
});
