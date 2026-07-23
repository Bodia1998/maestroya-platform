import { describe, expect, it } from "vitest";

import type { QuoteStatusValue } from "@/domain/repositories/quote-repository";
import {
  INITIAL_QUOTE_STATUS,
  OPEN_QUOTE_STATUSES,
  WITHDRAWN_QUOTE_STATUS,
  canTransitionQuoteStatus,
  isEditableQuoteStatus,
  isWithdrawableQuoteStatus,
} from "@/domain/services/quote-state";

const ALL_STATUSES: QuoteStatusValue[] = [
  "PENDING",
  "SENT",
  "VIEWED",
  "ACCEPTED",
  "REJECTED",
  "EXPIRED",
  "WITHDRAWN",
];

describe("quote-state", () => {
  it("creates quotes with SENT as the initial status", () => {
    expect(INITIAL_QUOTE_STATUS).toBe("SENT");
  });

  it("treats SENT and VIEWED as the only editable statuses", () => {
    for (const status of ALL_STATUSES) {
      expect(isEditableQuoteStatus(status)).toBe(OPEN_QUOTE_STATUSES.includes(status));
    }
    expect(isEditableQuoteStatus("SENT")).toBe(true);
    expect(isEditableQuoteStatus("VIEWED")).toBe(true);
    expect(isEditableQuoteStatus("ACCEPTED")).toBe(false);
    expect(isEditableQuoteStatus("REJECTED")).toBe(false);
    expect(isEditableQuoteStatus("EXPIRED")).toBe(false);
    expect(isEditableQuoteStatus("WITHDRAWN")).toBe(false);
    expect(isEditableQuoteStatus("PENDING")).toBe(false);
  });

  it("treats SENT and VIEWED as the only withdrawable statuses", () => {
    expect(isWithdrawableQuoteStatus("SENT")).toBe(true);
    expect(isWithdrawableQuoteStatus("VIEWED")).toBe(true);
    expect(isWithdrawableQuoteStatus("WITHDRAWN")).toBe(false);
    expect(isWithdrawableQuoteStatus("ACCEPTED")).toBe(false);
    expect(isWithdrawableQuoteStatus("REJECTED")).toBe(false);
    expect(isWithdrawableQuoteStatus("EXPIRED")).toBe(false);
  });

  it("only allows the (SENT|VIEWED) -> WITHDRAWN transition", () => {
    expect(canTransitionQuoteStatus("SENT", WITHDRAWN_QUOTE_STATUS)).toBe(true);
    expect(canTransitionQuoteStatus("VIEWED", WITHDRAWN_QUOTE_STATUS)).toBe(true);
  });

  it("rejects every other transition", () => {
    expect(canTransitionQuoteStatus("WITHDRAWN", "WITHDRAWN")).toBe(false);
    expect(canTransitionQuoteStatus("ACCEPTED", "WITHDRAWN")).toBe(false);
    expect(canTransitionQuoteStatus("REJECTED", "WITHDRAWN")).toBe(false);
    expect(canTransitionQuoteStatus("EXPIRED", "WITHDRAWN")).toBe(false);
    expect(canTransitionQuoteStatus("SENT", "ACCEPTED")).toBe(false);
    expect(canTransitionQuoteStatus("SENT", "REJECTED")).toBe(false);
  });
});
