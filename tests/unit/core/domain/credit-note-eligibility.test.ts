import { describe, expect, it } from "vitest";
import { assertCreditNoteWithinRemainingAmount, computeRemainingCreditableAmount } from "@/domain/services/credit-note-eligibility";
import { CreditNoteExceedsRemainingAmountError } from "@/domain/errors/domain-error";

describe("credit-note-eligibility", () => {
  it("computes the full invoice total as remaining when nothing has been credited yet", () => {
    expect(computeRemainingCreditableAmount(1306.8, 0)).toBe(1306.8);
  });

  it("subtracts already-credited amounts from the remaining creditable amount", () => {
    expect(computeRemainingCreditableAmount(1306.8, 500)).toBe(806.8);
  });

  it("never returns a negative remaining amount, even if over-credited somehow", () => {
    expect(computeRemainingCreditableAmount(1000, 1500)).toBe(0);
  });

  it("allows a credit note exactly equal to the remaining amount", () => {
    expect(() => assertCreditNoteWithinRemainingAmount(1000, 0, 1000)).not.toThrow();
  });

  it("rejects a credit note that would exceed the remaining creditable amount", () => {
    expect(() => assertCreditNoteWithinRemainingAmount(1000, 0, 1000.01)).toThrow(CreditNoteExceedsRemainingAmountError);
  });

  it("rejects a second credit note that would push the cumulative total over the invoice amount", () => {
    // Invoice total 1000, already credited 700 -> only 300 remains.
    expect(() => assertCreditNoteWithinRemainingAmount(1000, 700, 300)).not.toThrow();
    expect(() => assertCreditNoteWithinRemainingAmount(1000, 700, 300.01)).toThrow(CreditNoteExceedsRemainingAmountError);
  });
});
