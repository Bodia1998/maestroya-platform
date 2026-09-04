import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Module 91 — Real-Database Integration Test Harness.
 *
 * Loads `.env.test.local` (git-ignored — see `.gitignore`) into
 * `process.env`, IF it exists, forcibly overriding any value already
 * present for a key this file defines.
 *
 * ## Why this does NOT use `process.loadEnvFile()`
 * Node's built-in `process.loadEnvFile()` (and every common dotenv
 * implementation) refuses to override a variable that is already
 * "defined" in `process.env` — including an already-defined *empty
 * string*. That is the exact bug this module fixes: a developer's shell
 * can easily end up with `TEST_DATABASE_URL=` (empty) already exported —
 * a leftover `export TEST_DATABASE_URL=` from an earlier debugging
 * session, an IDE/terminal integration, a stray line in a shell profile —
 * and `loadEnvFile()` would then silently keep that empty value instead
 * of loading the real one from `.env.test.local`, with zero diagnostic
 * output. `resolveTestDatabaseUrl()` then correctly treats the empty
 * string as "not set" and falls through, producing exactly the
 * confusing "Neither TEST_DATABASE_URL nor DATABASE_URL is set" error
 * this module exists to prevent — even though the real value was sitting
 * right there in `.env.test.local`.
 *
 * This file is the single, explicit, force-overriding loader BOTH
 * `vitest.config.integration-db.ts` and `scripts/migrate-test-db.ts`
 * call, so `.env.test.local` is unconditionally authoritative for the
 * keys it defines, for this test tier only. It never reads or writes
 * `.env`/`.env.local`/`.env.production`, and never logs a value — only
 * whether a key was found.
 */

/** Minimal, dependency-free .env-style line parser: `[export ]KEY=VALUE`,
 *  `#`-prefixed and blank lines skipped, optional matching surrounding
 *  quotes (`"..."` or `'...'`) stripped from the value. Deliberately
 *  small — this only ever needs to parse a developer's own local file,
 *  not arbitrary dotenv syntax (no multiline values, no `${VAR}`
 *  expansion). */
function parseEnvFile(contents: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;

    const withoutExport = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const eqIndex = withoutExport.indexOf("=");
    if (eqIndex === -1) continue;

    const key = withoutExport.slice(0, eqIndex).trim();
    let value = withoutExport.slice(eqIndex + 1).trim();
    if (key === "") continue;

    if (value.length >= 2) {
      const first = value[0];
      const last = value[value.length - 1];
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        value = value.slice(1, -1);
      }
    }
    result.set(key, value);
  }
  return result;
}

/**
 * Loads `<repoRoot>/.env.test.local`, if present, force-overriding
 * `process.env` for every key it defines. Call this once, before
 * `resolveTestDatabaseUrl()` runs, from both entry points into this test
 * tier (the Vitest config and `scripts/migrate-test-db.ts`).
 *
 * Logs only whether `TEST_DATABASE_URL` was found in the file — never
 * its value, and never the value of any other key.
 */
export function loadLocalTestEnv(repoRoot: string): void {
  const localTestEnvFile = path.resolve(repoRoot, ".env.test.local");
  if (!existsSync(localTestEnvFile)) {
    return;
  }

  const parsed = parseEnvFile(readFileSync(localTestEnvFile, "utf8"));
  for (const [key, value] of parsed) {
    // Force-override — this is the fix: unlike process.loadEnvFile(),
    // an already-present (even empty) value for a key this file defines
    // does NOT win. .env.test.local is authoritative for its own keys.
    process.env[key] = value;
  }

  console.log(
    `[real-db-tests] .env.test.local loaded (${parsed.has("TEST_DATABASE_URL") ? "TEST_DATABASE_URL found" : "no TEST_DATABASE_URL key in it"}).`,
  );
}
