import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { loadLocalTestEnv } from "../tests/test-utils/db/local-test-env";
import { resolveTestDatabaseUrl } from "../tests/test-utils/db/test-database-url";

/**
 * Module 91 — Real-Database Integration Test Harness.
 *
 * Standalone entry point for applying Prisma migrations to the real-DB
 * integration test tier's database directly (`npm run db:migrate:test`),
 * outside of Vitest — for a developer who wants to apply/inspect
 * migrations against their local test database without running the full
 * suite. `tests/test-utils/db/global-setup.ts` already does this same
 * thing automatically before `npm run test:integration:db`'s test files
 * run; this script exists only so that step can be run and inspected on
 * its own.
 *
 * ## Why this exists at all — `prisma/schema.prisma`'s datasource block
 * is `url = env("DATABASE_URL")`, a Prisma-CLI-level constant. The
 * Prisma CLI has no concept of `TEST_DATABASE_URL` and, critically, the
 * Prisma CLI *auto-loads* a `.env` file at the project root itself
 * (independent of, and before, anything Vitest or this repo's own code
 * does) — so a bare `TEST_DATABASE_URL=... npx prisma migrate deploy`
 * does NOT make the CLI use it: `DATABASE_URL` is never set in that
 * shell, so Prisma's own `.env` auto-load fills it in from this
 * repository's real `.env` — this repo's live Supabase connection
 * string — and `migrate deploy` silently runs against Supabase instead.
 *
 * This script is the one safe way to bridge `TEST_DATABASE_URL` to the
 * Prisma CLI's hardcoded `DATABASE_URL` expectation:
 *   1. Resolve the connection string exactly like the Vitest harness
 *      does — the same `loadLocalTestEnv()` (force-overriding
 *      `.env.test.local` loader) feeding the same
 *      `resolveTestDatabaseUrl()` (`TEST_DATABASE_URL` preferred over
 *      `DATABASE_URL`).
 *   2. Run it through the SAME `UnsafeTestDatabaseUrlError` guard
 *      (`assertSafe`, inside `resolveTestDatabaseUrl`) — refuse and exit
 *      non-zero *before* spawning Prisma at all if it resolves to
 *      Supabase, any other managed provider, or any non-local host.
 *   3. Only once that passes, spawn `prisma migrate deploy` as a CHILD
 *      PROCESS with `DATABASE_URL` overridden in that child's own `env`
 *      object only — never written to `.env`, never mutated on
 *      `process.env` in a way anything else could observe.
 *
 * Never prints the resolved URL in full — only its source and hostname,
 * enough to prove which database migrations are about to run against
 * without ever logging a password.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

// See tests/test-utils/db/local-test-env.ts for why this is NOT
// process.loadEnvFile() — that API silently refuses to override an
// already-present (even empty) TEST_DATABASE_URL, which was the actual
// bug behind "TEST_DATABASE_URL is in .env.test.local but this still
// says neither var is set".
loadLocalTestEnv(repoRoot);

function maskedHost(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname;
  } catch {
    return "<unparsable>";
  }
}

function main(): void {
  // Throws UnsafeTestDatabaseUrlError (and this process exits non-zero,
  // via the uncaught exception below) before anything is spawned if the
  // resolved URL is missing, unparsable, a managed-provider host, not on
  // the local/CI allowlist, or its database name doesn't contain "test".
  const { url, source } = resolveTestDatabaseUrl();

  console.log(`[db:migrate:test] Resolved test database from ${source}.`);
  console.log(`[db:migrate:test] Target host: ${maskedHost(url)} (only the hostname is ever printed).`);
  console.log(`[db:migrate:test] Running \`prisma migrate deploy\` against it as a child process...`);

  const result = spawnSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: repoRoot,
    // DATABASE_URL is overridden here, in this spawned child's own env
    // object only — process.env in THIS (parent) process, and this
    // repo's .env/.env.local files, are never touched.
    env: { ...process.env, DATABASE_URL: url },
    stdio: "inherit",
  });

  if (result.error) {
    console.error(`[db:migrate:test] Failed to start \`prisma migrate deploy\`: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`[db:migrate:test] \`prisma migrate deploy\` exited with status ${result.status}.`);
    process.exit(result.status ?? 1);
  }

  console.log(`[db:migrate:test] Migrations applied to ${maskedHost(url)} (source: ${source}).`);
}

main();
