import { describe, expect, it } from "vitest";

import { canTransitionAppeal, assertValidAppealTransition, isTerminalAppealState } from "@/domain/entities/appeal";
import { InvalidAppealTransitionError } from "@/domain/errors/domain-error";

describe("Module 65 — TrustAppeal state machine", () => {
  it("allows SUBMITTED -> UNDER_REVIEW -> APPROVED -> ACCOUNT_RESTORED", () => {
    expect(canTransitionAppeal("SUBMITTED", "UNDER_REVIEW")).toBe(true);
    expect(canTransitionAppeal("UNDER_REVIEW", "APPROVED")).toBe(true);
    expect(canTransitionAppeal("APPROVED", "ACCOUNT_RESTORED")).toBe(true);
  });

  it("allows SUBMITTED -> REJECTED and UNDER_REVIEW -> REJECTED", () => {
    expect(canTransitionAppeal("SUBMITTED", "REJECTED")).toBe(true);
    expect(canTransitionAppeal("UNDER_REVIEW", "REJECTED")).toBe(true);
  });

  it("rejects skipping UNDER_REVIEW", () => {
    expect(canTransitionAppeal("SUBMITTED", "APPROVED")).toBe(false);
  });

  it("rejects re-entering a terminal state", () => {
    expect(canTransitionAppeal("REJECTED", "APPROVED")).toBe(false);
    expect(canTransitionAppeal("ACCOUNT_RESTORED", "SUBMITTED")).toBe(false);
  });

  it("assertValidAppealTransition throws InvalidAppealTransitionError for an illegal move", () => {
    expect(() => assertValidAppealTransition("ACCOUNT_RESTORED", "SUBMITTED")).toThrow(InvalidAppealTransitionError);
  });

  it("isTerminalAppealState is true only for REJECTED/ACCOUNT_RESTORED", () => {
    expect(isTerminalAppealState("REJECTED")).toBe(true);
    expect(isTerminalAppealState("ACCOUNT_RESTORED")).toBe(true);
    expect(isTerminalAppealState("SUBMITTED")).toBe(false);
    expect(isTerminalAppealState("UNDER_REVIEW")).toBe(false);
    expect(isTerminalAppealState("APPROVED")).toBe(false);
  });
});
