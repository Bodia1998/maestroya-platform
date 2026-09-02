import { describe, expect, it } from "vitest";

import { maskPhoneForLogging } from "@/infrastructure/trust-integrity/phone-masking";

describe("maskPhoneForLogging (Module 93)", () => {
  it("keeps the country code and last 4 digits, masks the rest", () => {
    expect(maskPhoneForLogging("+34600123456")).toBe("+346****3456");
  });

  it("never returns the input verbatim for a plausible phone number", () => {
    const input = "+15551234567";
    expect(maskPhoneForLogging(input)).not.toBe(input);
    expect(maskPhoneForLogging(input)).toContain("4567");
  });

  it("degrades safely for a too-short input", () => {
    expect(maskPhoneForLogging("12")).toBe("***");
  });
});
