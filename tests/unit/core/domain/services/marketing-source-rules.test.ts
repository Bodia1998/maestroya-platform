import { describe, expect, it } from "vitest";

import { resolveMarketingSource } from "@/domain/services/marketing-source-rules";

describe("Module 60 — marketing-source-rules", () => {
  it("resolves a recognized utm_source over everything else", () => {
    expect(
      resolveMarketingSource({ utmSource: "telegram", referralCode: "someone", refererHost: "www.google.com" }),
    ).toBe("TELEGRAM");
  });

  it("is case-insensitive on utm_source", () => {
    expect(resolveMarketingSource({ utmSource: "Instagram" })).toBe("INSTAGRAM");
  });

  it("resolves an unrecognized-but-explicit utm_source to UNKNOWN, not REFERRAL", () => {
    expect(resolveMarketingSource({ utmSource: "some_other_channel", referralCode: "code123" })).toBe("UNKNOWN");
  });

  it("resolves REFERRAL when a referral code is present with no utm_source", () => {
    expect(resolveMarketingSource({ referralCode: "maria_valencia" })).toBe("REFERRAL");
  });

  it("resolves ORGANIC_SEARCH from a known search-engine referrer when no utm_source/referral code", () => {
    expect(resolveMarketingSource({ refererHost: "www.google.com" })).toBe("ORGANIC_SEARCH");
    expect(resolveMarketingSource({ refererHost: "www.bing.com" })).toBe("ORGANIC_SEARCH");
  });

  it("resolves DIRECT when there is no referrer at all", () => {
    expect(resolveMarketingSource({})).toBe("DIRECT");
  });

  it("resolves UNKNOWN for an unrecognized referrer with no utm_source/referral code", () => {
    expect(resolveMarketingSource({ refererHost: "some-random-blog.example" })).toBe("UNKNOWN");
  });
});
