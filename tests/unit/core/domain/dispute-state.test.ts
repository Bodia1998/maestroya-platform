import { describe, expect, it } from "vitest";

import type { DisputeStatusValue } from "@/domain/repositories/dispute-repository";
import {
  CLOSED_STATUS,
  OPEN_STATUS,
  REJECTED_STATUS,
  RESOLVED_STATUS,
  UNDER_REVIEW_STATUS,
  WAITING_FOR_CUSTOMER_STATUS,
  WAITING_FOR_PROFESSIONAL_STATUS,
  canTransitionDisputeStatus,
  isClosableStatus,
  isRejectableStatus,
  isResolvableStatus,
  isTerminalStatus,
  isWaitingOnResponse,
} from "@/domain/services/dispute-state";

const ALL_STATUSES: DisputeStatusValue[] = [
  "OPEN",
  "UNDER_REVIEW",
  "WAITING_FOR_CUSTOMER",
  "WAITING_FOR_PROFESSIONAL",
  "RESOLVED",
  "REJECTED",
  "CLOSED",
];

describe("dispute-state", () => {
  describe("isTerminalStatus", () => {
    it("only CLOSED is terminal", () => {
      for (const status of ALL_STATUSES) {
        expect(isTerminalStatus(status)).toBe(status === CLOSED_STATUS);
      }
    });
  });

  describe("isWaitingOnResponse", () => {
    it("true only for the two waiting statuses", () => {
      expect(isWaitingOnResponse(WAITING_FOR_CUSTOMER_STATUS)).toBe(true);
      expect(isWaitingOnResponse(WAITING_FOR_PROFESSIONAL_STATUS)).toBe(true);
      expect(isWaitingOnResponse(UNDER_REVIEW_STATUS)).toBe(false);
      expect(isWaitingOnResponse(OPEN_STATUS)).toBe(false);
    });
  });

  describe("canTransitionDisputeStatus", () => {
    it("allows the full happy-path lifecycle", () => {
      expect(canTransitionDisputeStatus(OPEN_STATUS, UNDER_REVIEW_STATUS)).toBe(true);
      expect(canTransitionDisputeStatus(UNDER_REVIEW_STATUS, WAITING_FOR_CUSTOMER_STATUS)).toBe(true);
      expect(canTransitionDisputeStatus(WAITING_FOR_CUSTOMER_STATUS, UNDER_REVIEW_STATUS)).toBe(true);
      expect(canTransitionDisputeStatus(UNDER_REVIEW_STATUS, RESOLVED_STATUS)).toBe(true);
      expect(canTransitionDisputeStatus(RESOLVED_STATUS, CLOSED_STATUS)).toBe(true);
    });

    it("allows an admin to resolve/reject directly from OPEN (no forced review step)", () => {
      expect(canTransitionDisputeStatus(OPEN_STATUS, RESOLVED_STATUS)).toBe(true);
      expect(canTransitionDisputeStatus(OPEN_STATUS, REJECTED_STATUS)).toBe(true);
    });

    it("WAITING_FOR_CUSTOMER and WAITING_FOR_PROFESSIONAL are not reachable from each other directly", () => {
      expect(canTransitionDisputeStatus(WAITING_FOR_CUSTOMER_STATUS, WAITING_FOR_PROFESSIONAL_STATUS)).toBe(false);
      expect(canTransitionDisputeStatus(WAITING_FOR_PROFESSIONAL_STATUS, WAITING_FOR_CUSTOMER_STATUS)).toBe(false);
    });

    it("CLOSED is terminal — nothing transitions out of it", () => {
      for (const to of ALL_STATUSES) {
        expect(canTransitionDisputeStatus(CLOSED_STATUS, to)).toBe(false);
      }
    });

    it("RESOLVED and REJECTED only transition to CLOSED", () => {
      for (const to of ALL_STATUSES) {
        expect(canTransitionDisputeStatus(RESOLVED_STATUS, to)).toBe(to === CLOSED_STATUS);
        expect(canTransitionDisputeStatus(REJECTED_STATUS, to)).toBe(to === CLOSED_STATUS);
      }
    });

    it("rejects a no-op transition to the same status", () => {
      for (const status of ALL_STATUSES) {
        expect(canTransitionDisputeStatus(status, status)).toBe(false);
      }
    });

    it("OPEN cannot jump directly to WAITING_FOR_CUSTOMER/WAITING_FOR_PROFESSIONAL", () => {
      expect(canTransitionDisputeStatus(OPEN_STATUS, WAITING_FOR_CUSTOMER_STATUS)).toBe(false);
      expect(canTransitionDisputeStatus(OPEN_STATUS, WAITING_FOR_PROFESSIONAL_STATUS)).toBe(false);
    });
  });

  describe("isResolvableStatus / isRejectableStatus / isClosableStatus", () => {
    it("resolvable from every non-terminal, non-RESOLVED/REJECTED status", () => {
      expect(isResolvableStatus(OPEN_STATUS)).toBe(true);
      expect(isResolvableStatus(UNDER_REVIEW_STATUS)).toBe(true);
      expect(isResolvableStatus(WAITING_FOR_CUSTOMER_STATUS)).toBe(true);
      expect(isResolvableStatus(RESOLVED_STATUS)).toBe(false);
      expect(isResolvableStatus(CLOSED_STATUS)).toBe(false);
    });

    it("rejectable mirrors resolvable", () => {
      expect(isRejectableStatus(OPEN_STATUS)).toBe(true);
      expect(isRejectableStatus(REJECTED_STATUS)).toBe(false);
      expect(isRejectableStatus(CLOSED_STATUS)).toBe(false);
    });

    it("closable only from RESOLVED or REJECTED", () => {
      expect(isClosableStatus(RESOLVED_STATUS)).toBe(true);
      expect(isClosableStatus(REJECTED_STATUS)).toBe(true);
      expect(isClosableStatus(OPEN_STATUS)).toBe(false);
      expect(isClosableStatus(CLOSED_STATUS)).toBe(false);
    });
  });
});
