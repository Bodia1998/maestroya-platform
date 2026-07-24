import { describe, expect, it } from "vitest";

import {
  MAX_MESSAGE_LENGTH,
  MAX_TITLE_LENGTH,
  isSafeActionUrl,
  isValidMessage,
  isValidResourceId,
  isValidResourceType,
  isValidTitle,
  normalizeOptionalText,
} from "@/domain/services/notification-rules";

describe("isValidTitle", () => {
  it("accepts a normal title", () => {
    expect(isValidTitle("New quote received")).toBe(true);
  });

  it("rejects an empty title", () => {
    expect(isValidTitle("")).toBe(false);
  });

  it("rejects a whitespace-only title", () => {
    expect(isValidTitle("   ")).toBe(false);
  });

  it(`rejects a title over ${MAX_TITLE_LENGTH} characters`, () => {
    expect(isValidTitle("a".repeat(MAX_TITLE_LENGTH + 1))).toBe(false);
  });

  it(`accepts a title of exactly ${MAX_TITLE_LENGTH} characters`, () => {
    expect(isValidTitle("a".repeat(MAX_TITLE_LENGTH))).toBe(true);
  });
});

describe("isValidMessage", () => {
  it("accepts a normal message", () => {
    expect(isValidMessage("A professional submitted a quote.")).toBe(true);
  });

  it("rejects an empty message", () => {
    expect(isValidMessage("")).toBe(false);
  });

  it(`rejects a message over ${MAX_MESSAGE_LENGTH} characters`, () => {
    expect(isValidMessage("a".repeat(MAX_MESSAGE_LENGTH + 1))).toBe(false);
  });
});

describe("isValidResourceType / isValidResourceId", () => {
  it("accepts null for both", () => {
    expect(isValidResourceType(null)).toBe(true);
    expect(isValidResourceId(null)).toBe(true);
  });

  it("accepts a normal resource type/id", () => {
    expect(isValidResourceType("JOB")).toBe(true);
    expect(isValidResourceId("job-123")).toBe(true);
  });

  it("rejects an empty (non-null) resource type/id", () => {
    expect(isValidResourceType("   ")).toBe(false);
    expect(isValidResourceId("   ")).toBe(false);
  });

  it("rejects an overlong resource type", () => {
    expect(isValidResourceType("a".repeat(51))).toBe(false);
  });

  it("rejects an overlong resource id", () => {
    expect(isValidResourceId("a".repeat(101))).toBe(false);
  });
});

describe("isSafeActionUrl", () => {
  it("accepts null", () => {
    expect(isSafeActionUrl(null)).toBe(true);
  });

  it("accepts a safe internal path", () => {
    expect(isSafeActionUrl("/jobs/job-1")).toBe(true);
  });

  it("accepts an internal path with a query string", () => {
    expect(isSafeActionUrl("/requests/req-1?tab=quotes")).toBe(true);
  });

  it("rejects an empty string", () => {
    expect(isSafeActionUrl("")).toBe(false);
  });

  it("rejects a path that doesn't start with /", () => {
    expect(isSafeActionUrl("jobs/job-1")).toBe(false);
  });

  it("rejects an absolute external URL", () => {
    expect(isSafeActionUrl("https://example.com/jobs/job-1")).toBe(false);
  });

  it("rejects a protocol-relative URL", () => {
    expect(isSafeActionUrl("//evil.example.com")).toBe(false);
  });

  it("rejects a javascript: scheme", () => {
    expect(isSafeActionUrl("javascript:alert(1)")).toBe(false);
  });

  it("rejects a data: scheme", () => {
    expect(isSafeActionUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
  });

  it("rejects a vbscript: scheme", () => {
    expect(isSafeActionUrl("vbscript:msgbox(1)")).toBe(false);
  });

  it("rejects an obfuscated dangerous scheme embedded later in the string", () => {
    expect(isSafeActionUrl("/redirect?to=javascript:alert(1)")).toBe(false);
  });
});

describe("normalizeOptionalText", () => {
  it("returns null for null/undefined", () => {
    expect(normalizeOptionalText(null)).toBeNull();
    expect(normalizeOptionalText(undefined)).toBeNull();
  });

  it("collapses a whitespace-only string to null", () => {
    expect(normalizeOptionalText("   ")).toBeNull();
  });

  it("trims a normal string", () => {
    expect(normalizeOptionalText("  hello  ")).toBe("hello");
  });
});
