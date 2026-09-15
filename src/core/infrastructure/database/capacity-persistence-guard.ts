/**
 * Module 110 — Capacity Tool Safety & Environment Isolation.
 *
 * Addresses Module 109's Finding F1 (Critical): `PrismaLoadTestResultRepository.save()`
 * and `PrismaPerformanceBaselineRepository.save()` — the two write paths
 * Module 57's capacity/load-test tooling uses (`GenerateCapacityReportUseCase`'s
 * per-scenario `LoadTestRun` save and baseline auto-capture, and
 * `PersistCapacityReportUseCase`'s summary `LoadTestRun` row) — previously
 * called `prisma.loadTestRun.upsert()` / `prisma.performanceBaseline.upsert()`
 * unconditionally, against whatever `DATABASE_URL` the shared Prisma client
 * (`infrastructure/database/prisma/client.ts`) happens to be bound to. In
 * this repository that is, per Module 109's Finding F2, the same Supabase
 * project used for local dev and production alike — so any environment
 * where the Prisma engine resolves (unlike the sandbox Module 109 ran in)
 * would have silently written synthetic capacity/load-test rows into a
 * real, shared, potentially-production database.
 *
 * ## Design — mirrors, but does not modify, Module 91's `test-database-url.ts`
 * `tests/test-utils/db/test-database-url.ts` already solves an adjacent
 * problem (is this connection string safe to run destructive integration
 * tests against?) with a hostname allow/deny-list, a database-name check,
 * and a `NODE_ENV=production` defense-in-depth guard, all documented as a
 * "fail closed, no silent skip" contract. This module deliberately
 * mirrors that same pattern and hostname marker lists rather than
 * importing from `tests/`: `test-database-url.ts` is evaluated at
 * `vitest.config.integration-db.ts` config-eval time, before any test
 * process starts, and its own doc comment explains why it stays a
 * standalone, zero-import-time-side-effect module — reaching into it
 * from application/infrastructure `src/` code (or vice versa) would
 * couple two independently-evolving safety boundaries for no benefit,
 * and risks weakening Module 91's own guard as an unintended side effect
 * of a change made for this module. Duplicating the *pattern* (not
 * reusing the *module*) keeps both guards independently reviewable and
 * leaves Module 91's protections completely untouched, per this module's
 * own constraints.
 *
 * ## Why this reads `process.env` directly, not the validated `env` export
 * `infrastructure/config/env.ts` is parsed once, at module-import time,
 * into a frozen object — appropriate for "is the app configured to run
 * at all". This guard instead needs the same per-call, no-memoization
 * evaluation `test-database-url.ts` uses: called every time a capacity
 * write is attempted (not once at process startup), so a value changed
 * between calls (as every test in this module's own regression suite
 * relies on, via `vi.stubEnv`) is always honored, and so this file has
 * no import-time side effects of its own.
 *
 * ## The policy (fails closed)
 * A capacity/load-test write is allowed only when BOTH hold:
 *  1. `ALLOW_CAPACITY_REPORT_PERSISTENCE=true` is explicitly set — the
 *     narrowly-scoped opt-in this module introduces. Defaults to unset/
 *     disabled; never enable this in `.env`/`.env.local`/`.env.production`
 *     — see this file's own tests for the intended local-only usage
 *     (`ALLOW_CAPACITY_REPORT_PERSISTENCE=true` alongside a
 *     `DATABASE_URL` that already independently classifies as safe).
 *  2. `DATABASE_URL` independently classifies as `disposable-test` or
 *     `approved-capacity-test` (see `classifyDatabaseUrl` below) — the
 *     opt-in flag alone is never sufficient, so a developer who sets it
 *     while `DATABASE_URL` still points at the shared Supabase project
 *     is still blocked.
 *
 * `unknown` (an unparsable URL, or a host that is neither a recognized
 * managed-provider marker nor a recognized local/CI host) is always
 * treated as unsafe — never optimistically allowed.
 */

/** Hostname substrings that identify a managed/hosted Postgres provider —
 *  the same marker list `test-database-url.ts` uses (kept as an
 *  intentionally duplicated, independently-reviewable constant — see the
 *  class doc comment above for why this module doesn't import that
 *  file). Matching any of these is an unconditional refusal, regardless
 *  of database name — a database name is caller-controlled, provider
 *  hostnames are not. */
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

/** Hostnames a local/CI Postgres instance actually uses — the same set
 *  `test-database-url.ts` allows for the real-DB integration test tier. */
const ALLOWED_LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "postgres"]);

/** Substrings in a managed-provider host or database name that suggest a
 *  staging/pre-production deployment rather than production proper —
 *  reporting/messaging only. A managed-provider host is unsafe for
 *  synthetic capacity persistence either way; this never changes the
 *  allow/deny decision, only the human-readable category a blocked
 *  attempt is reported under. */
const STAGING_MARKERS = ["staging", "preprod", "pre-prod"];

export type DatabaseSafetyCategory =
  /** Local/CI host, database name makes disposability obvious (contains "test"). Safe. */
  | "disposable-test"
  /** Local/CI host, database name explicitly marks it as this tool's own dedicated database (contains "capacity" and "test"). Safe. */
  | "approved-capacity-test"
  /** Local/CI host, but the database name does not look disposable — almost certainly a developer's normal working database. Unsafe. */
  | "development"
  /** A managed-provider host whose own name/hostname suggests staging/pre-production. Still unsafe — reported separately from `production-shared` only for operator clarity. */
  | "staging"
  /** A managed-provider (Supabase, RDS, Neon, ...) host — the shared/production shape Module 109's Finding F2 describes. Unsafe. */
  | "production-shared"
  /** Unparsable URL, or a host that is neither a recognized managed-provider marker nor a recognized local/CI host. Unsafe — never optimistically allowed. */
  | "unknown";

export interface DatabaseSafetyClassification {
  category: DatabaseSafetyCategory;
  /** Whether this category is ever eligible to receive synthetic capacity/load-test writes. */
  safe: boolean;
  /** Lowercased hostname the classification was based on, or `null` when the URL couldn't be parsed at all. */
  host: string | null;
  /** Human-readable explanation, safe to include in an error message or log line — never includes credentials (the URL's userinfo is never read or echoed). */
  reason: string;
}

/**
 * Classifies a Postgres connection string's safety for synthetic
 * capacity/load-test persistence. Never reads or echoes the URL's
 * credentials (userinfo) — only the hostname and the database name
 * (path segment) are inspected.
 */
export function classifyDatabaseUrl(rawUrl: string | undefined): DatabaseSafetyClassification {
  if (!rawUrl || rawUrl.trim() === "") {
    return { category: "unknown", safe: false, host: null, reason: "DATABASE_URL is not set." };
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { category: "unknown", safe: false, host: null, reason: "DATABASE_URL is not a valid connection URL." };
  }

  const host = parsed.hostname.toLowerCase();
  const dbName = parsed.pathname.replace(/^\//, "").split("?")[0]?.toLowerCase() ?? "";

  for (const marker of MANAGED_PROVIDER_HOST_MARKERS) {
    if (host.includes(marker)) {
      const looksStaging = STAGING_MARKERS.some((staging) => host.includes(staging) || dbName.includes(staging));
      return {
        category: looksStaging ? "staging" : "production-shared",
        safe: false,
        host,
        reason:
          `DATABASE_URL's host "${host}" matches the known managed-Postgres-provider marker "${marker}". ` +
          `This is a managed/shared database (production or staging), never a target for synthetic capacity/load-test writes.`,
      };
    }
  }

  if (!ALLOWED_LOCAL_HOSTS.has(host)) {
    return {
      category: "unknown",
      safe: false,
      host,
      reason:
        `DATABASE_URL's host "${host}" is neither a recognized managed-provider marker nor one of the allowed ` +
        `local/CI hosts (${[...ALLOWED_LOCAL_HOSTS].join(", ")}). An unclassifiable database is always treated as unsafe.`,
    };
  }

  if (dbName.includes("capacity") && dbName.includes("test")) {
    return {
      category: "approved-capacity-test",
      safe: true,
      host,
      reason: `DATABASE_URL points at a local/CI host with a database name ("${dbName}") explicitly dedicated to capacity/load testing.`,
    };
  }

  if (dbName.includes("test")) {
    return {
      category: "disposable-test",
      safe: true,
      host,
      reason: `DATABASE_URL points at a local/CI host with a disposable-looking database name ("${dbName}").`,
    };
  }

  return {
    category: "development",
    safe: false,
    host,
    reason:
      `DATABASE_URL points at a local/CI host, but the database name ("${dbName}") does not indicate a disposable ` +
      `test database (it does not contain "test"). This looks like a normal development database, not a ` +
      `disposable one — refusing to write synthetic capacity/load-test data into it.`,
  };
}

/** `true` (case-sensitive) is the only value that enables persistence — everything else, including unset, is treated as disabled. */
function isPersistenceOptedIn(env: NodeJS.ProcessEnv): boolean {
  return env.ALLOW_CAPACITY_REPORT_PERSISTENCE === "true";
}

export interface CapacityPersistenceDecision {
  allowed: boolean;
  optedIn: boolean;
  database: DatabaseSafetyClassification;
  /** Present only when `allowed` is `false` — the single reason to surface in an error/log message. */
  reason?: string;
}

/**
 * Evaluates whether a capacity/load-test write should be allowed right
 * now, reading `process.env` fresh on every call (see the module doc
 * comment for why). Never throws — `assertCapacityPersistenceAllowed`
 * below is the throwing wrapper repositories actually call.
 */
export function evaluateCapacityPersistence(env: NodeJS.ProcessEnv = process.env): CapacityPersistenceDecision {
  const optedIn = isPersistenceOptedIn(env);
  const database = classifyDatabaseUrl(env.DATABASE_URL);

  if (!optedIn && !database.safe) {
    return {
      allowed: false,
      optedIn,
      database,
      reason:
        `Capacity/load-test persistence is disabled by default (ALLOW_CAPACITY_REPORT_PERSISTENCE is not "true") ` +
        `AND the active DATABASE_URL does not classify as a safe disposable/approved capacity-test database ` +
        `(${database.reason}). Set ALLOW_CAPACITY_REPORT_PERSISTENCE=true only for a local/CI run against a ` +
        `dedicated test database — never in .env/.env.local/.env.production.`,
    };
  }

  if (!optedIn) {
    return {
      allowed: false,
      optedIn,
      database,
      reason:
        `Capacity/load-test persistence requires ALLOW_CAPACITY_REPORT_PERSISTENCE=true (currently disabled by ` +
        `default). The active DATABASE_URL does classify as safe (${database.category}), but the explicit opt-in ` +
        `is still required — set ALLOW_CAPACITY_REPORT_PERSISTENCE=true for this process only, never in a ` +
        `committed .env file.`,
    };
  }

  if (!database.safe) {
    return {
      allowed: false,
      optedIn,
      database,
      reason:
        `ALLOW_CAPACITY_REPORT_PERSISTENCE=true is set, but the active DATABASE_URL does not independently ` +
        `classify as a safe disposable/approved capacity-test database (category: "${database.category}" — ` +
        `${database.reason}). The opt-in flag alone is never sufficient — refusing to write synthetic ` +
        `capacity/load-test data into a ${database.category} database.`,
    };
  }

  // Defense in depth, mirroring test-database-url.ts's own final check:
  // even a DATABASE_URL that independently classifies as safe (local
  // host, disposable-looking name) is never trusted while
  // NODE_ENV=production — no legitimate capacity-report run needs
  // persistence while NODE_ENV=production, so this can only fire on a
  // misconfiguration. This is deliberately the LAST check, not the only
  // one (per this module's brief: "do not rely only on NODE_ENV") —
  // every other environment still requires the two checks above.
  if (env.NODE_ENV === "production") {
    return {
      allowed: false,
      optedIn,
      database,
      reason:
        `Refusing to persist synthetic capacity/load-test data while NODE_ENV=production, even though ` +
        `ALLOW_CAPACITY_REPORT_PERSISTENCE=true is set and DATABASE_URL classifies as safe (${database.category}). ` +
        `This is a defense-in-depth check, not the primary one — see this module's doc comment.`,
    };
  }

  return { allowed: true, optedIn, database };
}

export class CapacityPersistenceBlockedError extends Error {
  readonly decision: CapacityPersistenceDecision;

  constructor(decision: CapacityPersistenceDecision) {
    super(decision.reason ?? "Capacity/load-test persistence was blocked.");
    this.name = "CapacityPersistenceBlockedError";
    this.decision = decision;
  }
}

/**
 * Throws `CapacityPersistenceBlockedError` unless persistence is
 * currently allowed (see `evaluateCapacityPersistence`). Called as the
 * first line of `PrismaLoadTestResultRepository.save()` and
 * `PrismaPerformanceBaselineRepository.save()` — the single choke point
 * both of this tool's write paths (per-scenario saves and baseline
 * auto-capture inside `GenerateCapacityReportUseCase`, and the summary
 * row inside `PersistCapacityReportUseCase`) go through, so no caller
 * needs its own copy of this check. Every existing caller already
 * catches and logs a `save()` failure as non-fatal (see those use
 * cases' own doc comments), so this throwing contract composes with the
 * existing "persistence is optional, never fatal to the report" design
 * with no caller-side changes required.
 */
export function assertCapacityPersistenceAllowed(env: NodeJS.ProcessEnv = process.env): void {
  const decision = evaluateCapacityPersistence(env);
  if (!decision.allowed) {
    throw new CapacityPersistenceBlockedError(decision);
  }
}
