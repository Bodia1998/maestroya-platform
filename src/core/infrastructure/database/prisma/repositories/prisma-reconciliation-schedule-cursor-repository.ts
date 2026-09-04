import "server-only";

import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";

import { prisma } from "@/infrastructure/database/prisma/client";
import type {
  AdvanceReconciliationScheduleCursorData,
  ReconciliationScheduleCursorRecord,
  ReconciliationScheduleCursorRepository,
} from "@/domain/repositories/reconciliation-schedule-cursor-repository";

/**
 * Module 92 — Reconciliation Full-Ledger Coverage & Advancing Cursor.
 *
 * Prisma implementation of `ReconciliationScheduleCursorRepository`. Only
 * two methods, deliberately: `getOrCreate` (idempotent bootstrap) and
 * `advance` (the one and only mutation, always conditional on `version`).
 * Nothing here ever unconditionally overwrites the cursor.
 */
export class PrismaReconciliationScheduleCursorRepository implements ReconciliationScheduleCursorRepository {
  /**
   * `upsert` on the unique `cursorKey` column, for the common case where
   * no concurrent caller is racing to create the same not-yet-existing
   * cursor.
   *
   * Two DIFFERENT callers reach this method without holding
   * `RunScheduledReconciliationSweepUseCase`'s lock: the lock HOLDER
   * (inside `runLocked`) and, independently, a caller that just FAILED
   * to acquire the lock (it still calls `getOrCreate` afterward, purely
   * to read the current cursor for its `skipped_locked` result — see
   * that use case's `execute()`). On a cold start (cursor row does not
   * exist yet), both of these can genuinely race to be the one that
   * creates it, entirely outside the lock's protection.
   *
   * `upsert` alone is not a sufficient guard against that: this
   * repository previously assumed Postgres/Prisma would always resolve a
   * concurrent create-vs-create race inside `upsert` silently, but a real
   * concurrent run of this exact scenario threw an unhandled unique-
   * constraint violation (Prisma P2002) on `cursorKey` instead. The fix
   * is the standard "create, and on a concurrent-insert conflict, read
   * instead" pattern already used elsewhere in this codebase (see e.g.
   * `PrismaPartnerPayoutRepository`, `PrismaDisputeRepository`): catch
   * P2002 specifically (never any other error), and re-read the row that
   * the OTHER concurrent caller just won the race to create. Never
   * retries blindly, never loosens the unique constraint — the row this
   * returns is always the one single row that constraint guarantees
   * exists.
   */
  async getOrCreate(cursorKey: string): Promise<ReconciliationScheduleCursorRecord> {
    try {
      const row = await prisma.reconciliationScheduleCursor.upsert({
        where: { cursorKey },
        update: {},
        create: {
          id: randomUUID(),
          cursorKey,
          lastCreatedAt: null,
          lastJobId: null,
          cycleNumber: 1,
          cycleStartedAt: new Date(),
          lastAdvancedAt: null,
          version: 0,
        },
      });
      return row;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        // Lost the concurrent-create race — the other caller's insert
        // already committed the row this `cursorKey` constraint allows
        // exactly one of. Read it back rather than treating this as a
        // failure.
        return prisma.reconciliationScheduleCursor.findUniqueOrThrow({ where: { cursorKey } });
      }
      throw error;
    }
  }

  /**
   * A conditional `UPDATE ... WHERE "cursorKey" = ? AND "version" = ?`,
   * expressed via Prisma's `updateMany` (the only Prisma API that lets a
   * non-unique-per-se `WHERE` clause gate a single-row update and report
   * back how many rows it actually touched — `update` alone would either
   * throw `P2025` on a version mismatch or require a compound unique
   * index on `(cursorKey, version)`, which would force a schema change
   * every time `version` changes meaning). `count === 0` means the
   * condition did not hold — this method returns `null` in that case
   * rather than throwing, and never guesses at what the caller should do
   * about it (see the port's own doc comment).
   *
   * Always re-reads the row after a successful conditional update (rather
   * than constructing the result in memory) so the returned record is
   * never out of sync with what Postgres actually persisted, including
   * `updatedAt`.
   */
  async advance(data: AdvanceReconciliationScheduleCursorData): Promise<ReconciliationScheduleCursorRecord | null> {
    const result = await prisma.reconciliationScheduleCursor.updateMany({
      where: { cursorKey: data.cursorKey, version: data.expectedVersion },
      data: {
        lastCreatedAt: data.lastCreatedAt,
        lastJobId: data.lastJobId,
        cycleNumber: data.cycleNumber,
        cycleStartedAt: data.cycleStartedAt,
        lastAdvancedAt: new Date(),
        version: { increment: 1 },
      },
    });

    if (result.count === 0) return null;

    return prisma.reconciliationScheduleCursor.findUniqueOrThrow({ where: { cursorKey: data.cursorKey } });
  }
}
