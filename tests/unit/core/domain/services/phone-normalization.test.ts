import { describe, expect, it } from "vitest";

import { toE164 } from "@/domain/services/phone-normalization";

describe("Module 93 — toE164", () => {
  it("passes through an already-E.164 number, stripping spaces/dashes", () => {
    expect(toE164("+34 600 123 456")).toBe("+34600123456");
  });

  it("prefixes the default country code for a national-format number", () => {
    expect(toE164("600123456")).toBe("+34600123456");
  });

  it("strips a leading trunk zero before prefixing the country code", () => {
    expect(toE164("0600123456")).toBe("+34600123456");
  });

  it("returns null for input that still doesn't look like a plausible E.164 number", () => {
    expect(toE164("abc")).toBeNull();
    expect(toE164("123")).toBeNull();
  });
});
