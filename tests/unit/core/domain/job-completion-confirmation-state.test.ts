import { describe, expect, it } from "vitest";

import {
  CONFIRMED_STATUS,
  DISPUTED_STATUS,
  TIMED_OUT_UNDER_REVIEW_STATUS,
  WAITING_FOR_CUSTOMER_STATUS,
  canTransitionConfirmationStatus,
  isAlreadyConfirmed,
  isTerminalConfirmationStatus,
} from "@/domain/services/job-completion-confirmation-state";
import type { JobCompletionConfirmationStatus } from "@/domain/services/job-completion-confirmation-state";

const ALL: JobCompletionConfirmationStatus[] = [
  WAITING_FOR_CUSTOMER_STATUS,
  CONFIRMED_STATUS,
  DISPUTED_STATUS,
  TIMED_OUT_UNDER_REVIEW_STATUS,
];

describe("job-completion-confirmation-state", () => {
  it("allows WAITING_FOR_CUSTOMER to move to any of the three outcomes", () => {
    expect(canTransitionConfirmationStatus(WAITING_FOR_CUSTOMER_STATUS, CONFIRMED_STATUS)).toBe(true);
    expect(canTransitionConfirmationStatus(WAITING_FOR_CUSTOMER_STATUS, DISPUTED_STATUS)).toBe(true);
    expect(canTransitionConfirmationStatus(WAITING_FOR_CUSTOMER_STATUS, TIMED_OUT_UNDER_REVIEW_STATUS)).toBe(true);
  });

  it("treats CONFIRMED, DISPUTED, TIMED_OUT_UNDER_REVIEW as terminal — no further transition out of any of them", () => {
    for (const from of [CONFIRMED_STATUS, DISPUTED_STATUS, TIMED_OUT_UNDER_REVIEW_STATUS]) {
      expect(isTerminalConfirmationStatus(from)).toBe(true);
      for (const to of ALL) {
        expect(canTransitionConfirmationStatus(from, to)).toBe(false);
      }
    }
  });

  it("never allows transitioning back to WAITING_FOR_CUSTOMER from anywhere", () => {
    for (const from of ALL) {
      expect(canTransitionConfirmationStatus(from, WAITING_FOR_CUSTOMER_STATUS)).toBe(false);
    }
  });

  it("rejects a no-op transition (from === to)", () => {
    for (const status of ALL) {
      expect(canTransitionConfirmationStatus(status, status)).toBe(false);
    }
  });

  describe("isAlreadyConfirmed — idempotency helper", () => {
    it("is true only for CONFIRMED", () => {
      expect(isAlreadyConfirmed(CONFIRMED_STATUS)).toBe(true);
      for (const status of ALL) {
        if (status === CONFIRMED_STATUS) continue;
        expect(isAlreadyConfirmed(status)).toBe(false);
      }
    });
  });
});
