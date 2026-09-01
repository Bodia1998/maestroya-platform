/**
 * Module 91 — Real-Database Integration Test Harness.
 *
 * Test isolation strategy: truncation, not per-test transactions.
 *
 * ## Why truncation, not transaction rollback
 * A per-test `BEGIN ... ROLLBACK` wrapper is the more common Prisma
 * testing pattern, but it is fundamentally incompatible with this
 * module's own highest-value coverage: several of the invariants Module
 * 91 exists to prove (duplicate payout creation, duplicate Stripe
 * dispute creation, duplicate webhook event creation, the reconciliation
 * partial-unique-index race) are deliberately exercised with **genuine
 * concurrent connections** via `Promise.all` (see e.g.
 * `tests/integration-db/financial/payout-uniqueness.test.ts`). Two
 * concurrent inserts racing a unique constraint only prove anything if
 * they run as two real, independent Postgres transactions that can
 * actually conflict with each other — wrapping the whole test in one
 * outer transaction (or worse, one transaction per connection that never
 * commits) would either serialize the "concurrent" calls against each
 * other in a way that hides the real race, or require a second
 * connection pool per test that the outer transaction can't see anyway.
 * Truncation between tests sidesteps this entirely: every test starts
 * from a genuinely empty, committed table set, and is free to open as
 * many real concurrent connections as it needs.
 *
 * ## What this isolates
 * Every table Module 91's seed helpers and tests write to (see the list
 * below) is truncated — with `RESTART IDENTITY CASCADE` — before each
 * test. `CASCADE` here is Postgres's TRUNCATE-specific cascade (truncate
 * every table with an FK referencing a truncated one), which is *not*
 * the same thing as the schema's own `onDelete: Restrict` on those same
 * foreign keys — TRUNCATE CASCADE always cascades when asked, regardless
 * of each FK's configured `ON DELETE` action. That is intentional and
 * safe here: this only ever runs against rows this test suite itself
 * created (see `test-database-url.ts`'s safety checks — this can never
 * run against a real database), so cascading truncation of this fixed
 * table list is just "delete everything this suite might have left
 * behind," not a test of `onDelete: Restrict` itself (Invariant H's own
 * test, `financial-deletion-protection.test.ts`, proves that separately
 * with a real `DELETE`, which *does* respect `Restrict`).
 *
 * ## What this does NOT isolate
 *  - Any table outside this fixed list. A test that (incorrectly) wrote
 *    to a table not listed here would leak state into the next test —
 *    keep this list in sync with `seed-helpers.ts` and any test that
 *    creates rows directly.
 *  - Cross-file isolation is additionally provided by running this test
 *    tier with `fileParallelism: false` (see
 *    `vitest.config.integration-db.ts`): files run one at a time, so
 *    there is never a second file's `beforeEach` truncation racing this
 *    file's still-running assertions. Isolation *within* a file's own
 *    concurrent-Promise.all blocks is the invariant under test, not
 *    something this harness tries to prevent.
 *  - Sequence/identity counters on tables that don't use them (every
 *    model here uses a UUID default, not a serial column) — `RESTART
 *    IDENTITY` is a no-op for all of them today, kept only so this stays
 *    correct if a future table in this list ever adds one.
 */
import { prisma } from "@/infrastructure/database/prisma/client";

/**
 * Every table Module 91's seed helpers or tests write rows into,
 * ordered for readability only — `TRUNCATE ... CASCADE` does not require
 * FK-dependency ordering (unlike `DELETE`), since it cascades to
 * dependents automatically.
 */
const TABLES_TO_RESET = [
  "reconciliation_discrepancies",
  "reconciliation_runs",
  "stripe_disputes",
  "external_webhook_events",
  "transactions",
  "payouts",
  "commissions",
  "payments",
  "jobs",
  "quotes",
  "service_requests",
  "service_categories",
  "professional_profiles",
  "customer_profiles",
  "addresses",
  "users",
] as const;

/**
 * Truncates every table this test tier is allowed to touch. Safe to call
 * from `beforeEach` — running it before each test (rather than only
 * `afterEach`) means a test that fails mid-way and leaves partial rows
 * behind can never poison the next test, which matters more than the
 * marginal cost of an extra truncate on the very first test.
 */
export async function resetDatabase(): Promise<void> {
  const quotedTables = TABLES_TO_RESET.map((table) => `"${table}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${quotedTables} RESTART IDENTITY CASCADE`);
}
