import { randomBytes } from "node:crypto";

import { PrismaClient } from "@prisma/client";

import type { LegacyArchiveScratchRestorer, ScratchRestoreOutcome } from "@/application/ports/legacy-archive-scratch-restorer";
import { DomainError } from "@/domain/errors/domain-error";
import {
  assertSafeIdentifier,
  compareScratchFigures,
  restoredRowsSha256,
  type ScratchFigures,
  type ScratchRestorePlan,
  type ScratchTablePlan,
} from "@/domain/services/legacy-archive-restore";
import { NO_CURRENCY_ON_RECORD, type ArchiveTotal } from "@/domain/services/legacy-archive";

export class LegacyArchiveRestoreError extends DomainError {
  readonly code = "LEGACY_ARCHIVE_RESTORE_FAILED";
  constructor(readonly sqlState: string) {
    // PostgreSQL error text can echo key values; only the SQLSTATE class is reported. The transaction was rolled back.
    super(`The scratch load failed (SQLSTATE ${sqlState}) and was rolled back; nothing was kept.`);
  }
}

/** Raw-SQL surface used inside the transaction. Writes are possible here, so every statement is built from validated identifiers and bound values. */
export interface ScratchTransaction {
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
}
export interface ScratchSqlClient {
  $transaction<R>(fn: (tx: ScratchTransaction) => Promise<R>, options?: { timeout?: number; maxWait?: number }): Promise<R>;
  $disconnect?(): Promise<void>;
}

const MAX_PARAMS_PER_STATEMENT = 30_000;
const MAX_ROWS_PER_STATEMENT = 500;
const SCHEMA_PREFIX = "legacy_archive_restore_";
const q = (identifier: string): string => `"${assertSafeIdentifier(identifier)}"`;

// ---- pure SQL builders (exported so they can be tested without a database) ---------------------------------------------------------

export const createTableSql = (schema: string, t: ScratchTablePlan): string =>
  `CREATE TABLE ${q(schema)}.${q(t.table)} (${[...t.columns.map((c) => `${q(c.name)} ${c.sqlType}${c.nullable ? "" : " NOT NULL"}`), `PRIMARY KEY (${t.primaryKey.map(q).join(", ")})`].join(", ")})`;

export function insertStatements(schema: string, t: ScratchTablePlan): { sql: string; params: unknown[] }[] {
  const perStatement = Math.max(1, Math.min(MAX_ROWS_PER_STATEMENT, Math.floor(MAX_PARAMS_PER_STATEMENT / Math.max(1, t.columns.length))));
  const out: { sql: string; params: unknown[] }[] = [];
  for (let start = 0; start < t.rows.length; start += perStatement) {
    const slice = t.rows.slice(start, start + perStatement);
    const params: unknown[] = [];
    const tuples = slice.map((row) => `(${row.map((value, i) => { params.push(value); return `$${params.length}::${t.columns[i]!.sqlType}`; }).join(", ")})`);
    out.push({ sql: `INSERT INTO ${q(schema)}.${q(t.table)} (${t.columns.map((c) => q(c.name)).join(", ")}) VALUES ${tuples.join(", ")}`, params });
  }
  return out;
}

export const foreignKeySql = (schema: string, t: ScratchTablePlan): string[] =>
  t.foreignKeys.map((fk) => `ALTER TABLE ${q(schema)}.${q(t.table)} ADD CONSTRAINT ${q(`fk_${fk.column}`)} FOREIGN KEY (${q(fk.column)}) REFERENCES ${q(schema)}.${q(fk.refTable)} (${q(fk.refColumn)})`);

/** Reads the rows back rendered exactly as the archive renders them: money as 2-decimal text, timestamps as UTC ISO-8601 with milliseconds. */
export function selectRowsSql(schema: string, t: ScratchTablePlan): string {
  const expr = (c: ScratchTablePlan["columns"][number]): string => {
    if (c.kind === "money" || c.kind === "decimal") return `${q(c.name)}::text AS ${q(c.name)}`;
    if (c.kind === "date") return `to_char(${q(c.name)}, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS ${q(c.name)}`;
    return q(c.name);
  };
  const isText = (name: string) => ["id", "string", "enum"].includes(t.columns.find((c) => c.name === name)!.kind);
  // COLLATE "C" = byte order, which is how the exporter orders keys; the database's own collation could order mixed-case text differently.
  const order = t.primaryKey.map((name) => `${q(name)}${isText(name) ? ' COLLATE "C"' : ""}`).join(", ");
  return `SELECT ${t.columns.map(expr).join(", ")} FROM ${q(schema)}.${q(t.table)} ORDER BY ${order}`;
}

export const countSql = (schema: string, t: ScratchTablePlan): string => `SELECT count(*)::int AS n FROM ${q(schema)}.${q(t.table)}`;
export function totalsSql(schema: string, t: ScratchTablePlan, field: string): string {
  const from = `${q(schema)}.${q(t.table)}`;
  return t.currencyField
    ? `SELECT ${q(t.currencyField)}::text AS currency, SUM(${q(field)})::text AS total FROM ${from} GROUP BY ${q(t.currencyField)}`
    : `SELECT NULL::text AS currency, SUM(${q(field)})::text AS total FROM ${from}`;
}

// ---- adapter -----------------------------------------------------------------------------------------------------------------------

class Rollback extends Error {
  constructor(readonly outcome: ScratchRestoreOutcome) {
    super("rollback");
  }
}

function sqlState(error: unknown): string {
  // Native engine: P2010 with meta.code = SQLSTATE. Driver-adapter engine: meta.driverAdapterError.cause.originalCode.
  const e = error as { code?: unknown; meta?: { code?: unknown; driverAdapterError?: { cause?: { originalCode?: unknown } } }; cause?: { originalCode?: unknown; code?: unknown }; message?: unknown };
  for (const candidate of [e?.meta?.code, e?.meta?.driverAdapterError?.cause?.originalCode, e?.cause?.originalCode, e?.cause?.code, e?.code]) if (typeof candidate === "string" && /^[0-9A-Z]{5}$/.test(candidate) && !/^P\d{4}$/.test(candidate)) return candidate;
  const fromMessage = typeof e?.message === "string" ? /Code: `([0-9A-Z]{5})`/.exec(e.message) : null;
  return fromMessage?.[1] ?? "UNKNOWN";
}

/**
 * Module 167 — PostgreSQL implementation of the scratch restore. It creates ONE new schema (`legacy_archive_restore_<random>`) in the
 * database it is connected to, loads the archive into it inside a single transaction, adds the foreign keys, measures the result and
 * then either rolls the whole thing back (default) or commits it (only when asked to keep it and every check passed). It never reads or
 * writes any other schema. The caller (config guard) is responsible for pointing it at a disposable database.
 */
export class PrismaLegacyArchiveScratchRestorer implements LegacyArchiveScratchRestorer {
  constructor(private readonly injected?: ScratchSqlClient) {}

  async restore(plan: ScratchRestorePlan, options: { keepSchema: boolean }): Promise<ScratchRestoreOutcome> {
    const client: ScratchSqlClient = this.injected ?? (new PrismaClient() as unknown as ScratchSqlClient);
    const schema = `${SCHEMA_PREFIX}${randomBytes(6).toString("hex")}`;
    try {
      return await client.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe(`CREATE SCHEMA ${q(schema)}`); // fails if it exists: nothing is ever merged into existing data
          for (const table of plan.tables) await tx.$executeRawUnsafe(createTableSql(schema, table));
          for (const table of plan.tables) for (const statement of insertStatements(schema, table)) await tx.$executeRawUnsafe(statement.sql, ...statement.params);
          for (const table of plan.tables) for (const statement of foreignKeySql(schema, table)) await tx.$executeRawUnsafe(statement);

          const figures: ScratchFigures = { tables: {} };
          for (const table of plan.tables) {
            const count = (await tx.$queryRawUnsafe<{ n: number }[]>(countSql(schema, table)))[0]?.n ?? 0;
            const rows = await tx.$queryRawUnsafe<Record<string, unknown>[]>(selectRowsSql(schema, table));
            const totals: ArchiveTotal[] = [];
            for (const field of table.totalFields) {
              for (const row of await tx.$queryRawUnsafe<{ currency: string | null; total: string | null }[]>(totalsSql(schema, table, field))) {
                if (row.total !== null) totals.push({ field, currency: row.currency ?? NO_CURRENCY_ON_RECORD, total: row.total });
              }
            }
            figures.tables[table.category] = { count: Number(count), sha256: restoredRowsSha256(table, rows), totals };
          }
          const issues = compareScratchFigures(plan, figures);
          if (options.keepSchema && issues.length === 0) return { schemaName: schema, kept: true, figures, issues };
          throw new Rollback({ schemaName: null, kept: false, figures, issues }); // the default: leave nothing behind
        },
        { timeout: 300_000, maxWait: 10_000 },
      );
    } catch (error) {
      if (error instanceof Rollback) return error.outcome;
      throw new LegacyArchiveRestoreError(sqlState(error));
    } finally {
      if (!this.injected) await client.$disconnect?.();
    }
  }
}
