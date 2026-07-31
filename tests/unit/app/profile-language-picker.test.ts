import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Regression coverage for the Profile page's platform-language picker query
 * — part of the same Language.sortOrder schema regression covered by
 * tests/unit/prisma/language-schema-contract.test.ts,
 * tests/unit/prisma/seed-languages.test.ts, and
 * tests/unit/core/infrastructure/prisma-language-repository.test.ts.
 *
 * `profile/page.tsx` is an async Server Component that imports several
 * "use client" form components (react-hook-form, etc.) — rendering it end
 * to end here would mean mocking that whole tree just to reach one Prisma
 * query object literal. Asserting on the source text of the query is the
 * lightweight equivalent of the same check the other Language regression
 * tests perform against schema.prisma/seed.ts, and fails loudly the moment
 * anyone reverts this query back to alphabetical-only ordering.
 */

const pagePath = path.resolve(__dirname, "../../../src/app/(dashboard)/profile/page.tsx");
const pageSource = readFileSync(pagePath, "utf-8");

describe("Profile page — language picker query", () => {
  it("orders languages by sortOrder ascending, then name ascending", () => {
    const languagesQueryMatch = pageSource.match(
      /prisma\.language\.findMany\(\{[\s\S]*?\}\);/,
    );
    expect(languagesQueryMatch).not.toBeNull();
    const queryText = languagesQueryMatch![0];

    expect(queryText).toMatch(/orderBy:\s*\[\{\s*sortOrder:\s*"asc"\s*\},\s*\{\s*name:\s*"asc"\s*\}\]/);
  });

  it("does not rely on alphabetical ordering alone", () => {
    const languagesQueryMatch = pageSource.match(
      /prisma\.language\.findMany\(\{[\s\S]*?\}\);/,
    );
    const queryText = languagesQueryMatch![0];

    // A regression that reverted to `orderBy: { name: "asc" }` (single,
    // alphabetical-only key) would still match a naive `/name/` search but
    // must NOT satisfy the sortOrder-first ordering asserted above.
    expect(queryText).not.toMatch(/orderBy:\s*\{\s*name:\s*"asc"\s*\}/);
  });

  it("only queries active languages", () => {
    const languagesQueryMatch = pageSource.match(
      /prisma\.language\.findMany\(\{[\s\S]*?\}\);/,
    );
    const queryText = languagesQueryMatch![0];
    expect(queryText).toMatch(/isActive:\s*true/);
  });
});
