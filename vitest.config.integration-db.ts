import path from "node:path";

import { defineConfig } from "vitest/config";

import { resolveTestDatabaseUrl } from "./tests/test-utils/db/test-database-url";

/**
 * Module 91 — Real-Database Integration Test Harness.
 *
 * A SEPARATE Vitest project from `vitest.config.ts` — deliberately, not
 * a second `include` glob bolted onto the existing config:
 *
 *  - `resolveTestDatabaseUrl()` runs here, at config-evaluation time,
 *    BEFORE any test file (or even Vitest's own test-collection phase)
 *    starts. An invalid/unsafe database URL fails `vitest run` outright,
 *    with a clear message, rather than surfacing as a mysterious
 *    connection error deep inside the first test.
 *  - `npm test`/`npm run test:unit`/`npm run test:integration` (the
 *    existing fake-based suites) must NEVER require a running Postgres
 *    instance — see this repo's own `CRITICAL RULES`. Keeping this
 *    config entirely separate, with its own `include` glob
 *    (`tests/integration-db/**`) that the main config never touches,
 *    is what guarantees that: `vitest.config.ts` has no idea this file
 *    or `tests/integration-db/` exist.
 *  - `environment: "node"` (not `jsdom`, like the main config) — these
 *    tests exercise Prisma repositories against a real database, never
 *    the DOM.
 *
 * Run with `npm run test:integration:db` (see package.json). See
 * `MODULE_91_IMPLEMENTATION_REPORT.md` for the full architecture writeup
 * (isolation strategy, CI wiring, local developer workflow).
 */
const { url: testDatabaseUrl, source } = resolveTestDatabaseUrl();

console.log(`[real-db-tests] vitest.config.integration-db.ts resolved DATABASE_URL from ${source}.`);

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/integration-db/**/*.test.ts"],
    // Deliberately excluded from `npm test`'s own `vitest.config.ts`
    // include glob — this config's tests only ever run via
    // `npm run test:integration:db`, which explicitly passes
    // `--config vitest.config.integration-db.ts`.
    env: {
      NODE_ENV: "test",
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      DATABASE_URL: testDatabaseUrl,
      RESEND_API_KEY: "re_test_placeholder",
      EMAIL_FROM: "MaestroYa <noreply@maestroya.test>",
      AUTH_SECRET: "vitest-baseline-secret-not-for-production-use",
      AUTH_URL: "http://localhost:3000",
      STRIPE_SECRET_KEY: "sk_test_placeholder",
      STRIPE_PUBLISHABLE_KEY: "pk_test_placeholder",
      STRIPE_WEBHOOK_SECRET: "whsec_placeholder",
      STRIPE_PAYMENTS_WEBHOOK_SECRET: "whsec_payments_placeholder",
      CLOUDINARY_CLOUD_NAME: "demo",
      CLOUDINARY_API_KEY: "123456",
      CLOUDINARY_API_SECRET: "abcdef",
      MAESTROYA_ISSUER_TAX_ID: "B00000000",
    },
    // `globalSetup` runs once, in its own process, before any test file
    // starts — see `tests/test-utils/db/global-setup.ts` for why this is
    // where `prisma migrate deploy` runs (never inside a test file).
    globalSetup: ["./tests/test-utils/db/global-setup.ts"],
    // Real-Postgres tests run one file at a time, deliberately:
    //  1. Bounds total open Postgres connections to one file's worth at
    //     a time (each file gets its own fresh `PrismaClient` — see
    //     `db-test-lifecycle.ts` — under Vitest's default per-file
    //     module isolation).
    //  2. Avoids two files' `beforeEach` truncations racing each other
    //     against the same database.
    // The *intentional* concurrency this suite proves (duplicate payout/
    // dispute/webhook-event/discrepancy creation) all happens WITHIN a
    // single test via `Promise.all` against one file's own connections —
    // this setting only serializes *files*, never suppresses that.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      "server-only": path.resolve(__dirname, "./tests/test-utils/server-only-stub.ts"),
      "@/application": path.resolve(__dirname, "./src/core/application"),
      "@/domain": path.resolve(__dirname, "./src/core/domain"),
      "@/infrastructure": path.resolve(__dirname, "./src/core/infrastructure"),
      "@/presentation": path.resolve(__dirname, "./src/presentation"),
      "@/components": path.resolve(__dirname, "./src/presentation/components"),
      "@/hooks": path.resolve(__dirname, "./src/presentation/hooks"),
      "@/lib": path.resolve(__dirname, "./src/lib"),
      "@/shared": path.resolve(__dirname, "./src/shared"),
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
