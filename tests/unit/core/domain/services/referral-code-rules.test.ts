import { describe, expect, it } from "vitest";

import { ReferralCodeError } from "@/domain/errors/domain-error";
import {
  assertValidReferralCode,
  isValidReferralCode,
  normalizeReferralCode,
  REFERRAL_CODE_MAX_LENGTH,
  REFERRAL_CODE_MIN_LENGTH,
} from "@/domain/services/referral-code-rules";

describe("Module 60 — referral-code-rules", () => {
  it("normalizes to lowercase and trims", () => {
    expect(normalizeReferralCode("  Telegram_Valencia  ")).toBe("telegram_valencia");
  });

  it("accepts a well-formed code and returns it normalized", () => {
    expect(assertValidReferralCode("Telegram_Valencia")).toBe("telegram_valencia");
  });

  it("accepts the minimum length", () => {
    const code = "a".repeat(REFERRAL_CODE_MIN_LENGTH);
    expect(assertValidReferralCode(code)).toBe(code);
  });

  it("accepts the maximum length", () => {
    const code = "a".repeat(REFERRAL_CODE_MAX_LENGTH);
    expect(assertValidReferralCode(code)).toBe(code);
  });

  it("rejects a code shorter than the minimum length", () => {
    expect(() => assertValidReferralCode("a".repeat(REFERRAL_CODE_MIN_LENGTH - 1))).toThrow(ReferralCodeError);
  });

  it("rejects a code longer than the maximum length", () => {
    expect(() => assertValidReferralCode("a".repeat(REFERRAL_CODE_MAX_LENGTH + 1))).toThrow(ReferralCodeError);
  });

  it("rejects codes with disallowed characters", () => {
    for (const bad of ["has space", "has-dash", "has.dot", "has/slash", "emoji😀code"]) {
      expect(() => assertValidReferralCode(bad)).toThrow(ReferralCodeError);
    }
  });

  it("isValidReferralCode returns false instead of throwing", () => {
    expect(isValidReferralCode("ok_code")).toBe(true);
    expect(isValidReferralCode("no")).toBe(false);
    expect(isValidReferralCode("bad code")).toBe(false);
  });
});
