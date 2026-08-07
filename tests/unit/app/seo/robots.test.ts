import { describe, expect, it } from "vitest";

import robots from "@/app/robots";
import { DISALLOWED_PATHS } from "@/shared/seo/robots-rules";

describe("robots()", () => {
  it("allows everything by default and disallows every path in DISALLOWED_PATHS", () => {
    const result = robots();
    const rules = Array.isArray(result.rules) ? result.rules[0] : result.rules;

    expect(rules?.userAgent).toBe("*");
    expect(rules?.allow).toBe("/");
    expect(rules?.disallow).toEqual([...DISALLOWED_PATHS]);
  });

  it("references sitemap.xml at the site origin", () => {
    const result = robots();
    expect(result.sitemap).toMatch(/\/sitemap\.xml$/);
  });
});
