/**
 * Module 161 — evidence that a "concurrent" test really contended inside PostgreSQL (tests only).
 *
 * A race test that happens to run its requests one after another proves nothing. This probe samples `pg_stat_activity` from the
 * same pool while the race runs and records (a) the peak number of simultaneously ACTIVE backends and (b) the peak number of
 * backends WAITING ON A LOCK. The assertions in the tests are about invariants; these numbers are reported as evidence (and
 * a test may require `lockWaitsObserved > 0` only where the code path is known to take a row lock).
 */
import { prisma } from "@/infrastructure/database/prisma/client";

export interface ContentionEvidence {
  samples: number;
  peakActiveBackends: number;
  peakLockWaiters: number;
}

export async function withContentionProbe<T>(run: () => Promise<T>, intervalMs = 4): Promise<{ result: T; evidence: ContentionEvidence }> {
  const evidence: ContentionEvidence = { samples: 0, peakActiveBackends: 0, peakLockWaiters: 0 };
  let stop = false;
  const sampler = (async () => {
    while (!stop) {
      try {
        const rows = await prisma.$queryRaw<Array<{ active: bigint; lock_waiters: bigint }>>`
          SELECT count(*) FILTER (WHERE state = 'active' AND pid <> pg_backend_pid()) AS active,
                 count(*) FILTER (WHERE wait_event_type = 'Lock') AS lock_waiters
          FROM pg_stat_activity WHERE datname = current_database()`;
        const row = rows[0];
        if (row) {
          evidence.samples += 1;
          evidence.peakActiveBackends = Math.max(evidence.peakActiveBackends, Number(row.active));
          evidence.peakLockWaiters = Math.max(evidence.peakLockWaiters, Number(row.lock_waiters));
        }
      } catch {
        /* the probe must never fail a test */
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  })();
  try {
    const result = await run();
    return { result, evidence };
  } finally {
    stop = true;
    await sampler;
  }
}
