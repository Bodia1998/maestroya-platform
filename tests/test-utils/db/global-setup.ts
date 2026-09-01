/**
 * Module 91 — Real-Database Integration Test Harness.
 *
 * Vitest `globalSetup` for `vitest.config.integration-db.ts`: runs once,
 * before any real-DB test file executes, in a separate Node process from
 * the test workers themselves (Vitest's own documented `globalSetup`
 * contract) — so this file must not rely on any state a test file sets
 * up, and nothing it does here is visible to test files except through
 * the database itself.
 *
 * Responsibilities, in order:
 *  1. Re-resolve and re-validate the test database URL (defense in
 *     depth — `vitest.config.integration-db.ts` already validated it once
 *     at config-eval time to compute `test.env.DATABASE_URL`, but this
 *     process re-derives it independently from the same env vars rather
 *     than trusting a value handed to it, so there is no path where a
 *     validated-elsewhere URL is assumed safe here).
 *  2. Apply the Prisma schema via `prisma migrate deploy` — the exact
 *     same command CI already runs against its `postgres:16-alpine`
 *     service (see `.github/workflows/ci.yml`) — so the real-DB test
 *     tier always runs against the actual production schema, never a
 *     second hand-maintained copy of it. This is idempotent (only
 *     applies pending migrations), so re-running it here on top of a CI
 *     run that already migrated the same database is a harmless no-op.
 *
 * Deliberately does NOT truncate/reset data here — `resetDatabase()`
 * (see `./reset-database.ts`) runs per-test-file via `beforeEach`, which
 * is the layer that owns test-to-test isolation. This file only
 * guarantees the schema itself is current before the first test runs.
 */
import { execFileSync } from "node:child_process";

import { resolveTestDatabaseUrl } from "./test-database-url";

export default async function setup(): Promise<void> {
  const { url, source } = resolveTestDatabaseUrl();

  console.log(`[real-db-tests] Using ${source} -> applying migrations before the suite runs...`);

  try {
    execFileSync("npx", ["prisma", "migrate", "deploy"], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: url },
      stdio: "inherit",
    });
  } catch (error) {
    throw new Error(
      "[real-db-tests] `prisma migrate deploy` failed against the resolved test database. " +
        "Confirm Postgres is running and reachable at the resolved URL, then retry. " +
        `Underlying error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  console.log("[real-db-tests] Migrations applied. Starting real-DB integration suite.");
}
