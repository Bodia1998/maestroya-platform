/**
 * Module 91 — Real-Database Integration Test Harness.
 *
 * Resolves and validates the PostgreSQL connection string the real-DB
 * integration test tier is allowed to run against — the single choke
 * point every entry into this test tier (the Vitest config that loads
 * this file at config-eval time, before any test process starts) must
 * pass through.
 *
 * This module deliberately does NOT import `@/infrastructure/config/env`
 * (the application's own env schema): that schema's job is "is the app
 * configured to run at all", or ours is much narrower and stricter — "is
 * this specific URL one we are willing to run destructive tests
 * (TRUNCATE, concurrent duplicate-insert races, real Postgres errors)
 * against". Reusing env.ts's DATABASE_URL validation (`z.string().min(1)`)
 * would tell us nothing about *which* database it points at, which is
 * the only question that matters here. Keeping this standalone also
 * means this file has zero import-time side effects and can be evaluated
 * directly inside `vitest.config.integration-db.ts`, before Vitest has
 * even set up the test environment.
 *
 * ## The rule
 * 1. Prefer `TEST_DATABASE_URL` when set — an explicit, unambiguous
 *    opt-in to a specific database for this test tier.
 * 2. Otherwise fall back to `DATABASE_URL` — but ONLY after it passes
 *    every check below. This repository's own `.env`/`.env.local` files
 *    point `DATABASE_URL` at a real hosted Postgres instance (a Supabase
 *    pooler endpoint) for local `next dev` use — silently reusing that
 *    for a test tier that runs `TRUNCATE ... CASCADE` and intentionally
 *    triggers unique-constraint races would be a production-data
 *    incident, not a test. See CI's own `DATABASE_URL` (a throwaway
 *    `postgres:16-alpine` service) for what a *safe* fallback value
 *    looks like — the checks below encode exactly that shape.
 * 3. If neither is set, or the resolved URL fails any check, this throws
 *    `UnsafeTestDatabaseUrlError` — never a silent skip, never a silent
 *    "run anyway". A Vitest config that fails to load is a much better
 *    failure mode than a test suite that quietly truncates production
 *    tables.
 */

/** Hostname substrings that identify a managed/hosted Postgres provider.
 *  Matching any of these is an unconditional refusal, regardless of
 *  database name — a database name is caller-controlled and provider
 *  hostnames are not, so the hostname check is the one that cannot be
 *  worked around by naming a production database "foo_test". */
const MANAGED_PROVIDER_HOST_MARKERS = [
  "supabase.co",
  "supabase.com",
  "supabase.io",
  "pooler.supabase.com",
  "rds.amazonaws.com",
  "amazonaws.com",
  "database.azure.com",
  "database.windows.net",
  "neon.tech",
  "render.com",
  "railway.app",
  "herokuapp.com",
  "digitalocean.com",
  "digitaloceanspaces.com",
  "gcp.",
  "googleapis.com",
  "planetscale.com",
  "cockroachlabs.cloud",
  "aivencloud.com",
  "elephantsql.com",
  "timescale.com",
] as const;

/** Hostnames a local/CI Postgres instance actually uses. `postgres` is the
 *  Docker Compose / GitHub Actions service-container hostname (reachable
 *  by that name from *inside* the same Docker network — CI in this repo
 *  maps the service to `localhost` via `ports`, but a future container-to-
 *  container CI job would reach it as `postgres`, so it's allowed
 *  defensively rather than only documented). */
const ALLOWED_LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "postgres"]);

export class UnsafeTestDatabaseUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeTestDatabaseUrlError";
  }
}

export interface ResolvedTestDatabaseUrl {
  url: string;
  /** Which env var supplied the URL — surfaced for diagnostics/logging
   *  (e.g. the global-setup script's own console output). */
  source: "TEST_DATABASE_URL" | "DATABASE_URL";
}

function assertSafe(rawUrl: string, source: ResolvedTestDatabaseUrl["source"]): void {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new UnsafeTestDatabaseUrlError(
      `${source} is not a valid connection URL. The real-DB integration test tier refuses to start ` +
        `with an unparsable connection string rather than guessing.`,
    );
  }

  const host = parsed.hostname.toLowerCase();
  const dbName = parsed.pathname.replace(/^\//, "").split("?")[0]?.toLowerCase() ?? "";

  for (const marker of MANAGED_PROVIDER_HOST_MARKERS) {
    if (host.includes(marker)) {
      throw new UnsafeTestDatabaseUrlError(
        `Refusing to run the real-DB integration test tier: ${source}'s host "${host}" matches the ` +
          `known managed-Postgres-provider marker "${marker}". This looks like a production or ` +
          `hosted database, not a disposable local/CI test database. Set TEST_DATABASE_URL to a ` +
          `local Postgres instance (e.g. "postgresql://postgres:postgres@localhost:5432/maestroya_test?schema=public").`,
      );
    }
  }

  if (!ALLOWED_LOCAL_HOSTS.has(host)) {
    throw new UnsafeTestDatabaseUrlError(
      `Refusing to run the real-DB integration test tier: ${source}'s host "${host}" is not one of ` +
        `the allowed local/CI hosts (${[...ALLOWED_LOCAL_HOSTS].join(", ")}). This test tier only ever ` +
        `runs against a disposable, locally-reachable Postgres instance. Set TEST_DATABASE_URL explicitly ` +
        `if this host is genuinely a local/CI database under a different hostname.`,
    );
  }

  if (!dbName.includes("test")) {
    throw new UnsafeTestDatabaseUrlError(
      `Refusing to run the real-DB integration test tier: the database name "${dbName}" resolved from ` +
        `${source} does not contain "test". As a second, independent safety check (defense in depth ` +
        `alongside the hostname check above), this tier only ever runs against a database whose name ` +
        `makes its disposability obvious — e.g. "maestroya_test". Point TEST_DATABASE_URL/DATABASE_URL ` +
        `at a dedicated test database.`,
    );
  }

  if (source === "DATABASE_URL" && process.env.NODE_ENV === "production") {
    // Defense in depth: even a DATABASE_URL that otherwise looks
    // local/test-shaped is never trusted while NODE_ENV=production. No
    // legitimate CI/local workflow for this test tier runs with
    // NODE_ENV=production, so this can only fire on a misconfiguration.
    throw new UnsafeTestDatabaseUrlError(
      `Refusing to fall back to DATABASE_URL while NODE_ENV=production. Set TEST_DATABASE_URL explicitly.`,
    );
  }
}

/**
 * Resolves the connection string the real-DB integration test tier must
 * use, throwing `UnsafeTestDatabaseUrlError` if none is available or the
 * resolved value fails any safety check. Call once, at Vitest config
 * evaluation time — never inside a test, and never memoized across
 * processes (each `vitest run` invocation re-validates from scratch).
 */
export function resolveTestDatabaseUrl(): ResolvedTestDatabaseUrl {
  const explicit = process.env.TEST_DATABASE_URL;
  if (explicit && explicit.trim() !== "") {
    assertSafe(explicit, "TEST_DATABASE_URL");
    return { url: explicit, source: "TEST_DATABASE_URL" };
  }

  const fallback = process.env.DATABASE_URL;
  if (!fallback || fallback.trim() === "") {
    throw new UnsafeTestDatabaseUrlError(
      "Neither TEST_DATABASE_URL nor DATABASE_URL is set. The real-DB integration test tier needs an " +
        "explicit connection string to a disposable local/CI Postgres database — set TEST_DATABASE_URL " +
        '(e.g. "postgresql://postgres:postgres@localhost:5432/maestroya_test?schema=public").',
    );
  }
  assertSafe(fallback, "DATABASE_URL");
  return { url: fallback, source: "DATABASE_URL" };
}
