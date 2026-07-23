import { describe, expect, it } from "vitest";

import type { JobStatusValue } from "@/domain/repositories/job-repository";
import {
  CANCELLED_STATUS,
  COMPLETED_STATUS,
  CREATED_STATUS,
  IN_PROGRESS_STATUS,
  canTransitionJobStatus,
  isCancellableStatus,
  isCompletableStatus,
  isStartableStatus,
  isTerminalStatus,
} from "@/domain/services/job-state";

const ALL_STATUSES: JobStatusValue[] = ["CREATED", "IN_PROGRESS", "COMPLETED", "CANCELLED"];
const NON_TERMINAL: JobStatusValue[] = [CREATED_STATUS, IN_PROGRESS_STATUS];
const TERMINAL: JobStatusValue[] = ALL_STATUSES.filter((s) => !NON_TERMINAL.includes(s));

describe("job-state", () => {
  describe("isTerminalStatus", () => {
    it("treats CREATED, IN_PROGRESS as non-terminal", () => {
      for (const status of NON_TERMINAL) {
        expect(isTerminalStatus(status)).toBe(false);
      }
    });

    it("treats COMPLETED, CANCELLED as terminal", () => {
      for (const status of TERMINAL) {
        expect(isTerminalStatus(status)).toBe(true);
      }
    });
  });

  describe("isStartableStatus", () => {
    it("only allows starting a CREATED job", () => {
      expect(isStartableStatus(CREATED_STATUS)).toBe(true);
      for (const status of ALL_STATUSES) {
        if (status === CREATED_STATUS) continue;
        expect(isStartableStatus(status)).toBe(false);
      }
    });
  });

  describe("isCompletableStatus", () => {
    it("only allows completing an IN_PROGRESS job", () => {
      expect(isCompletableStatus(IN_PROGRESS_STATUS)).toBe(true);
      for (const status of ALL_STATUSES) {
        if (status === IN_PROGRESS_STATUS) continue;
        expect(isCompletableStatus(status)).toBe(false);
      }
    });

    it("rejects completing directly from CREATED — a job must be started first", () => {
      expect(isCompletableStatus(CREATED_STATUS)).toBe(false);
    });
  });

  describe("isCancellableStatus", () => {
    it("allows cancelling from every non-terminal status", () => {
      for (const status of NON_TERMINAL) {
        expect(isCancellableStatus(status)).toBe(true);
      }
    });

    it("rejects cancelling a terminal job", () => {
      for (const status of TERMINAL) {
        expect(isCancellableStatus(status)).toBe(false);
      }
    });
  });

  describe("canTransitionJobStatus", () => {
    it("allows the full happy-path lifecycle", () => {
      expect(canTransitionJobStatus(CREATED_STATUS, IN_PROGRESS_STATUS)).toBe(true);
      expect(canTransitionJobStatus(IN_PROGRESS_STATUS, COMPLETED_STATUS)).toBe(true);
    });

    it("allows cancellation from CREATED and IN_PROGRESS", () => {
      expect(canTransitionJobStatus(CREATED_STATUS, CANCELLED_STATUS)).toBe(true);
      expect(canTransitionJobStatus(IN_PROGRESS_STATUS, CANCELLED_STATUS)).toBe(true);
    });

    it("never allows a transition out of a terminal status", () => {
      for (const from of TERMINAL) {
        for (const to of ALL_STATUSES) {
          expect(canTransitionJobStatus(from, to)).toBe(false);
        }
      }
    });

    it("rejects nonsensical transitions", () => {
      expect(canTransitionJobStatus(CREATED_STATUS, COMPLETED_STATUS)).toBe(false);
      expect(canTransitionJobStatus(IN_PROGRESS_STATUS, CREATED_STATUS)).toBe(false);
      expect(canTransitionJobStatus(COMPLETED_STATUS, IN_PROGRESS_STATUS)).toBe(false);
      expect(canTransitionJobStatus(CANCELLED_STATUS, IN_PROGRESS_STATUS)).toBe(false);
    });
  });
});
