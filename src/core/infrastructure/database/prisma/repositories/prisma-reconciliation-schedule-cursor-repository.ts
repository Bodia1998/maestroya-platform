import "server-only";

import { randomUUID } from "node:crypto";

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
   * `upsert` on the unique `cursorKey` column: if two callers somehow
   * race to create the same not-yet-existing cursor (should not happen
   * in practice — the scheduled sweep always holds a `DistributedLock`
   * before ever reaching this call, see
   * `RunScheduledReconciliationSweepUseCase`), Postgres resolves the
   * unique-constraint conflict itself and `upsert` returns the row
   * exactly once either way — never throws, never creates a duplicate
   * cursor row for the same key.
   */
  async getOrCreate(cursorKey: string): Promise<ReconciliationScheduleCursorRecord> {
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
