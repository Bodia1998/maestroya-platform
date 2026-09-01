/**
 * Module 91 — Real-Database Integration Test Harness.
 *
 * One-line setup every real-DB test file calls at the top of its
 * `describe` block: truncates before each test (see `reset-database.ts`
 * for why truncation, not transactions) and disconnects the shared
 * Prisma client after the file's tests finish.
 *
 * ## Connection lifecycle
 * This test tier deliberately reuses `@/infrastructure/database/prisma/client`
 * — the exact same singleton every `Prisma*Repository` class imports —
 * rather than constructing a second, competing `PrismaClient`. Testing
 * through the real repository classes (see e.g.
 * `payout-uniqueness.test.ts` calling `PrismaPayoutRepository.createPending`
 * directly) only proves what it claims to prove if the repository and the
 * test are provably talking to the same client/connection pool.
 *
 * `vitest.config.integration-db.ts` runs this test tier with
 * `fileParallelism: false` and Vitest's default per-file module isolation,
 * so each test file gets its own fresh import of `client.ts` (its own
 * `PrismaClient` and connection pool), and files run one at a time —
 * never two files' connection pools open concurrently. `afterAll` below
 * closes that file's pool before Vitest moves on to the next file, so
 * connections never accumulate across the suite.
 */
import { afterAll, beforeEach } from "vitest";

import { prisma } from "@/infrastructure/database/prisma/client";

import { resetDatabase } from "./reset-database";

export function setupDbTestLifecycle(): void {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });
}
