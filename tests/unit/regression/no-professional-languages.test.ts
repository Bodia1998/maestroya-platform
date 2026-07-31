import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Guards against the removed "professional spoken languages" feature
 * (mistakenly built during an earlier stabilization pass, then reverted —
 * see the schema/seed/repository Language regression tests alongside this
 * one) ever creeping back into *active* application code.
 *
 * Two files were briefly left on disk as intentionally-empty stubs (a
 * sandbox environment's file-delete permission was declined at the time)
 * and have since been deleted for real:
 *   - src/app/(dashboard)/dashboard/professional/professional-languages-form.tsx
 *   - src/core/application/use-cases/professional/update-professional-languages.use-case.ts
 * They are no longer special-cased in the scan below — there is nothing on
 * disk to exclude — but their paths are still asserted absent below so a
 * future accidental re-add (even as an empty stub) is caught immediately.
 */

const SRC_ROOT = path.resolve(__dirname, "../../../src");

const DELETED_STUB_PATHS = [
  path.join(SRC_ROOT, "app/(dashboard)/dashboard/professional/professional-languages-form.tsx"),
  path.join(SRC_ROOT, "core/application/use-cases/professional/update-professional-languages.use-case.ts"),
];

const FORBIDDEN_PATTERNS: RegExp[] = [
  /ProfessionalLanguagesForm/,
  /UpdateProfessionalLanguagesUseCase/,
  /updateProfessionalLanguagesSchema/,
  /updateProfessionalLanguagesAction/,
  /languageIds/,
  /languages spoken/i,
  /spoken languages/i,
];

function walk(dir: string): string[] {
  const entries = readdirSync(dir, { recursive: true }) as string[];
  return entries
    .map((entry) => path.join(dir, entry))
    .filter((full) => {
      try {
        return statSync(full).isFile() && /\.(ts|tsx)$/.test(full);
      } catch {
        return false;
      }
    });
}

describe("regression: no active professional spoken-language references remain", () => {
  const files = walk(SRC_ROOT);

  it("scans a non-trivial number of source files", () => {
    // Sanity check on the walk itself, so a broken glob/path silently
    // scanning zero files can't make every assertion below vacuously pass.
    expect(files.length).toBeGreaterThan(50);
  });

  it.each(FORBIDDEN_PATTERNS.map((pattern) => [pattern.toString(), pattern] as const))(
    "no active src file references %s",
    (_label, pattern) => {
      const offenders = files.filter((file) => pattern.test(readFileSync(file, "utf-8")));
      expect(offenders).toEqual([]);
    },
  );

  it("the removed professional-languages-form.tsx / update-professional-languages.use-case.ts files stay deleted", () => {
    // Guards against the exact regression that just happened in reverse:
    // these two files were re-added (even as harmless empty stubs) after
    // being deleted for good reason — they belonged entirely to the
    // removed feature and nothing references them.
    for (const deletedPath of DELETED_STUB_PATHS) {
      expect(existsSync(deletedPath)).toBe(false);
    }
  });
});
