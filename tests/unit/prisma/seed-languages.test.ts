import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Regression coverage for the seeded Language reference data (see also
 * tests/unit/prisma/language-schema-contract.test.ts for the schema side of
 * this same regression). `prisma/seed.ts` runs a real seeding `main()` as a
 * top-level side effect on import (it instantiates `PrismaClient` and calls
 * `main().catch(...).finally(...)` unconditionally), so it is deliberately
 * NOT imported here — that would attempt a real DB connection in every test
 * run. Instead this test parses the `LANGUAGES` array literal out of the
 * source text, which is enough to assert the two properties that matter:
 * every seeded language carries a numeric `sortOrder`, and the platform's
 * declared priority order (English, Spanish, then the rest) is preserved.
 */

const seedPath = path.resolve(__dirname, "../../../prisma/seed.ts");
const seedSource = readFileSync(seedPath, "utf-8");

interface SeededLanguage {
  code: string;
  name: string;
  nativeName: string;
  sortOrder: number;
}

function parseLanguages(): SeededLanguage[] {
  const start = seedSource.indexOf("const LANGUAGES = [");
  const end = seedSource.indexOf("] as const;", start);
  if (start === -1 || end === -1) {
    throw new Error("Could not locate the LANGUAGES array literal in prisma/seed.ts");
  }
  const block = seedSource.slice(start, end);

  const entryPattern =
    /\{\s*code:\s*"([^"]+)",\s*name:\s*"([^"]+)",\s*nativeName:\s*"([^"]+)",\s*sortOrder:\s*(\d+)\s*\}/g;

  const languages: SeededLanguage[] = [];
  for (const match of block.matchAll(entryPattern)) {
    const [, code, name, nativeName, sortOrder] = match;
    if (!code || !name || !nativeName || sortOrder === undefined) {
      throw new Error(`Malformed LANGUAGES entry in prisma/seed.ts: ${match[0]}`);
    }
    languages.push({
      code,
      name,
      nativeName,
      sortOrder: Number(sortOrder),
    });
  }
  return languages;
}

describe("prisma/seed.ts — LANGUAGES seed data", () => {
  it("seeds more than one language, every entry carrying a numeric sortOrder", () => {
    const languages = parseLanguages();
    expect(languages.length).toBeGreaterThan(1);
    for (const language of languages) {
      expect(Number.isFinite(language.sortOrder)).toBe(true);
    }
  });

  it("preserves the declared platform priority order (English first, then Spanish)", () => {
    const languages = parseLanguages();
    expect(languages[0]).toMatchObject({ code: "en", sortOrder: 10 });
    expect(languages[1]).toMatchObject({ code: "es", sortOrder: 20 });
  });

  it("keeps sortOrder strictly increasing in source order (no accidental reordering)", () => {
    const languages = parseLanguages();
    for (let i = 1; i < languages.length; i += 1) {
      const current = languages[i];
      const previous = languages[i - 1];
      if (!current || !previous) throw new Error("unreachable: index within bounds");
      expect(current.sortOrder).toBeGreaterThan(previous.sortOrder);
    }
  });

  it("passes sortOrder through on both create and update in seedLanguages()", () => {
    // Guards against a future edit that adds sortOrder to `create` (implicit,
    // via the object spread) but forgets it on the explicit `update` clause
    // (or vice versa) — upsert would then silently stop updating priority
    // order on a re-seed of an already-existing language.
    const upsertCallMatch = seedSource.match(
      /prisma\.language\.upsert\(\{[\s\S]*?update:\s*\{([^}]*)\}/,
    );
    expect(upsertCallMatch).not.toBeNull();
    expect(upsertCallMatch?.[1]).toMatch(/sortOrder:\s*language\.sortOrder/);
  });
});
