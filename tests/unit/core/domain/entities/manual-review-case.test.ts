import { describe, expect, it } from "vitest";

import {
  canTransitionManualReviewCase,
  assertValidManualReviewTransition,
  isTerminalManualReviewState,
} from "@/domain/entities/manual-review-case";
import { InvalidManualReviewTransitionError } from "@/domain/errors/domain-error";

describe("Module 65 — ManualReviewCase state machine", () => {
  it("allows OPEN -> UNDER_REVIEW -> ESCALATED -> RESOLVED", () => {
    expect(canTransitionManualReviewCase("OPEN", "UNDER_REVIEW")).toBe(true);
    expect(canTransitionManualReviewCase("UNDER_REVIEW", "ESCALATED")).toBe(true);
    expect(canTransitionManualReviewCase("ESCALATED", "RESOLVED")).toBe(true);
  });

  it("allows UNDER_REVIEW to resolve/reject directly without escalating", () => {
    expect(canTransitionManualReviewCase("UNDER_REVIEW", "RESOLVED")).toBe(true);
    expect(canTransitionManualReviewCase("UNDER_REVIEW", "REJECTED")).toBe(true);
  });

  it("rejects re-entering a terminal state", () => {
    expect(canTransitionManualReviewCase("RESOLVED", "OPEN")).toBe(false);
    expect(canTransitionManualReviewCase("REJECTED", "UNDER_REVIEW")).toBe(false);
  });

  it("assertValidManualReviewTransition throws InvalidManualReviewTransitionError for an illegal move", () => {
    expect(() => assertValidManualReviewTransition("RESOLVED", "ESCALATED")).toThrow(InvalidManualReviewTransitionError);
  });

  it("assertValidManualReviewTransition does not throw for a legal move", () => {
    expect(() => assertValidManualReviewTransition("OPEN", "UNDER_REVIEW")).not.toThrow();
  });

  it("isTerminalManualReviewState is true only for RESOLVED/REJECTED", () => {
    expect(isTerminalManualReviewState("RESOLVED")).toBe(true);
    expect(isTerminalManualReviewState("REJECTED")).toBe(true);
    expect(isTerminalManualReviewState("OPEN")).toBe(false);
    expect(isTerminalManualReviewState("UNDER_REVIEW")).toBe(false);
    expect(isTerminalManualReviewState("ESCALATED")).toBe(false);
  });
});
