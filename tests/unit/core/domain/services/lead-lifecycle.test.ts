import { describe, expect, it } from "vitest";

import {
  InvalidLeadTransitionError,
  LEAD_STATUSES,
  LEAD_TERMINAL_STATUSES,
  assertLeadTransition,
  canTransitionLead,
  isLeadAvailableForMarketplace,
  isLeadTransitionNoop,
  isTerminalLeadStatus,
  leadStatusForRequestStatus,
  leadStatusesThatMayTransitionTo,
} from "@/domain/services/lead";

const REQUEST_STATUSES = ["DRAFT", "PUBLISHED", "QUOTED", "ACCEPTED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "EXPIRED", "DISPUTED"] as const;

describe("Module 130 — Lead lifecycle state machine", () => {
  it("allows DRAFT -> PUBLISHED and PUBLISHED -> each terminal state", () => {
    expect(canTransitionLead("DRAFT", "PUBLISHED")).toBe(true);
    for (const t of LEAD_TERMINAL_STATUSES) {
      expect(canTransitionLead("PUBLISHED", t)).toBe(true);
      expect(canTransitionLead("DRAFT", t)).toBe(true);
    }
  });

  it("never goes back: PUBLISHED -> DRAFT is invalid", () => {
    expect(canTransitionLead("PUBLISHED", "DRAFT")).toBe(false);
    expect(() => assertLeadTransition("PUBLISHED", "DRAFT")).toThrow(InvalidLeadTransitionError);
  });

  it.each(LEAD_TERMINAL_STATUSES)("%s is terminal: no transition out, never available again", (terminal) => {
    expect(isTerminalLeadStatus(terminal)).toBe(true);
    for (const to of LEAD_STATUSES) {
      expect(canTransitionLead(terminal, to)).toBe(false);
      expect(() => assertLeadTransition(terminal, to)).toThrow(InvalidLeadTransitionError);
    }
  });

  it("DRAFT and PUBLISHED are not terminal", () => {
    expect(isTerminalLeadStatus("DRAFT")).toBe(false);
    expect(isTerminalLeadStatus("PUBLISHED")).toBe(false);
  });

  it("repeating a transition is a no-op (idempotent), not an error to the propagation path", () => {
    for (const s of LEAD_STATUSES) expect(isLeadTransitionNoop(s, s)).toBe(true);
    expect(isLeadTransitionNoop("PUBLISHED", "CANCELLED")).toBe(false);
  });

  it("source statuses for a terminal target are exactly DRAFT and PUBLISHED", () => {
    for (const t of LEAD_TERMINAL_STATUSES) expect(leadStatusesThatMayTransitionTo(t)).toEqual(["DRAFT", "PUBLISHED"]);
  });
});

describe("Module 130 — ServiceRequest status -> Lead status", () => {
  it.each([
    ["DRAFT", null],
    ["PUBLISHED", null],
    ["CANCELLED", "CANCELLED"],
    ["EXPIRED", "EXPIRED"],
    ["COMPLETED", "CLOSED"],
    ["ACCEPTED", "CLOSED"],
    ["IN_PROGRESS", "CLOSED"],
    ["QUOTED", "CLOSED"],
    ["DISPUTED", "CLOSED"],
  ] as const)("request %s -> lead %s", (request, lead) => {
    expect(leadStatusForRequestStatus(request)).toBe(lead);
  });

  it("every request status is covered and the mapping is deterministic", () => {
    for (const r of REQUEST_STATUSES) expect(leadStatusForRequestStatus(r)).toBe(leadStatusForRequestStatus(r));
  });
});

describe("Module 130 — availability invariant", () => {
  const base = { leadStatus: "PUBLISHED", flowVersion: "LEAD_V1", requestStatus: "PUBLISHED" } as const;

  it("available only for a PUBLISHED LEAD_V1 lead on an open, non-deleted request", () => {
    expect(isLeadAvailableForMarketplace(base)).toBe(true);
  });

  it.each(REQUEST_STATUSES.filter((s) => s !== "PUBLISHED"))(
    "a PUBLISHED lead is NOT available when its request is %s (stale lead status is not trusted)",
    (requestStatus) => {
      expect(isLeadAvailableForMarketplace({ ...base, requestStatus })).toBe(false);
    },
  );

  it.each(LEAD_STATUSES.filter((s) => s !== "PUBLISHED"))("lead status %s is never available", (leadStatus) => {
    expect(isLeadAvailableForMarketplace({ ...base, leadStatus })).toBe(false);
  });

  it("legacy flow and soft-deleted requests are never available", () => {
    expect(isLeadAvailableForMarketplace({ ...base, flowVersion: "LEGACY_QUOTE_PAYMENT" })).toBe(false);
    expect(isLeadAvailableForMarketplace({ ...base, flowVersion: null })).toBe(false);
    expect(isLeadAvailableForMarketplace({ ...base, requestDeleted: true })).toBe(false);
  });
});
