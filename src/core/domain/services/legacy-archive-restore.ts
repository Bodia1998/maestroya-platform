import { createHash } from "node:crypto";

import {
  ArchiveVerificationFailedError,
  NO_CURRENCY_ON_RECORD,
  archiveFields,
  verifyLegacyArchive,
  type ArchiveFile,
  type ArchiveIssue,
  type ArchivePins,
  type ArchiveTotal,
  type LegacyArchiveOptions,
} from "@/domain/services/legacy-archive";
import { LEGACY_ARCHIVE_CATEGORIES, type ArchiveFieldKind } from "@/domain/services/legacy-archive-spec";

/**
 * Module 167 — scratch-restore rehearsal: the pure part (no I/O, no database, no clock).
 *
 * The roadmap's acceptance criterion is "archive restores to a scratch database and passes row-count / checksum and invoice-total
 * verification". The archive is an evidence extract, NOT a database dump: it deliberately leaves out the parent entities (users,
 * profiles, addresses, categories...) that the application schema requires, because they are personal data. So the restore target is
 * an ARCHIVE-SHAPED schema — one table per category, the archived columns only, identifiers kept as opaque text, foreign keys only
 * between categories that are in the archive — never the application schema, and nothing is invented to satisfy the application's
 * foreign keys. It exists to prove, in a disposable PostgreSQL, that the archive can be loaded and queried by an auditor and that
 * the figures survive the round trip. It is not a path back into the live system and it imports no personal data that the archive
 * does not already contain.
 *
 * Checks, all re-derived from the restored tables (never from the TypeScript that wrote them):
 *  - row count per category;
 *  - exact money totals per currency (SQL `SUM` over `numeric(20,2)`);
 *  - checksum: the restored rows are read back, re-serialized exactly as the exporter serializes them and hashed; the SHA-256 must
 *    equal the one in the manifest, which proves the load was lossless (types, precision, timestamps, nulls, ordering);
 *  - referential integrity between archived categories, enforced by PostgreSQL foreign keys added after the load;
 *  - invoice totals: the restored invoice and credit-note totals per currency equal the manifest's, and the net position is reported.
 */

export type ScratchValue = string | number | boolean | null;

export interface ScratchColumn {
  name: string;
  kind: ArchiveFieldKind;
  sqlType: string;
  nullable: boolean;
}
export interface ScratchForeignKey {
  column: string;
  refTable: string;
  refColumn: string;
}
export interface ScratchTablePlan {
  category: string;
  /** Table name inside the scratch schema; equals the category key. */
  table: string;
  columns: ScratchColumn[];
  primaryKey: string[];
  foreignKeys: ScratchForeignKey[];
  /** Values in column order, in archive (primary-key) order. */
  rows: ScratchValue[][];
  currencyField: string | null;
  totalFields: string[];
  expected: { recordCount: number; sha256: string; totals: ArchiveTotal[] };
}
export interface ScratchRestorePlan {
  manifestSha256: string;
  archiveDigest: string;
  options: LegacyArchiveOptions;
  tables: ScratchTablePlan[];
}

/** What was measured in the restored tables. */
export interface ScratchFigures {
  tables: Record<string, { count: number; sha256: string; totals: ArchiveTotal[] }>;
}

const SQL_TYPES: Record<ArchiveFieldKind, string> = {
  id: "text",
  enum: "text",
  string: "text",
  money: "numeric(20,2)",
  decimal: "numeric(20,2)",
  int: "integer",
  bool: "boolean",
  date: "timestamp(3)",
};

const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]*$/;
/** Names come from the spec (constants), never from archive content; still checked, because they end up inside SQL text. */
export function assertSafeIdentifier(name: string): string {
  if (!IDENTIFIER.test(name) || name.length > 63) throw new RangeError("unsafe SQL identifier");
  return name;
}

const sha256 = (data: string): string => createHash("sha256").update(data).digest("hex");

/**
 * Turns a verified archive into a load plan. Fails closed: an archive that does not verify (or does not match the pinned digests)
 * is never turned into a plan.
 */
export function planScratchRestore(files: readonly ArchiveFile[], pins: ArchivePins = {}): ScratchRestorePlan {
  const verification = verifyLegacyArchive(files, pins);
  if (!verification.ok || !verification.manifest || !verification.manifestSha256) throw new ArchiveVerificationFailedError(verification.issues);
  const manifest = verification.manifest;
  const byName = new Map(files.map((f) => [f.name, f.content]));
  const idFieldsOf = new Map(LEGACY_ARCHIVE_CATEGORIES.map((c) => [c.key, c.idFields ?? ["id"]]));

  const tables: ScratchTablePlan[] = LEGACY_ARCHIVE_CATEGORIES.map((spec) => {
    const entry = manifest.categories.find((c) => c.key === spec.key)!;
    const fields = archiveFields(spec, manifest.options);
    const columns: ScratchColumn[] = fields.map((fl) => ({ name: assertSafeIdentifier(fl.name), kind: fl.kind, sqlType: SQL_TYPES[fl.kind], nullable: fl.nullable }));
    const foreignKeys: ScratchForeignKey[] = [];
    for (const fl of fields) {
      const target = fl.ref ? idFieldsOf.get(fl.ref) : undefined;
      // Only references to categories with a single-column key become foreign keys; the verifier has already proven they resolve.
      if (fl.ref && target && target.length === 1) foreignKeys.push({ column: fl.name, refTable: assertSafeIdentifier(fl.ref), refColumn: assertSafeIdentifier(target[0]!) });
    }
    const text = byName.get(entry.file)!.toString("utf8");
    const rows = text.split("\n").filter((line) => line !== "").map((line) => {
      const record = JSON.parse(line) as Record<string, ScratchValue>;
      return fields.map((fl) => record[fl.name] as ScratchValue);
    });
    return {
      category: spec.key,
      table: assertSafeIdentifier(spec.key),
      columns,
      primaryKey: (spec.idFields ?? ["id"]).map(assertSafeIdentifier),
      foreignKeys,
      rows,
      currencyField: spec.currencyField,
      totalFields: [...spec.totalFields],
      expected: { recordCount: entry.recordCount, sha256: entry.sha256, totals: entry.totals.map((t) => ({ ...t })) },
    };
  });
  return { manifestSha256: verification.manifestSha256, archiveDigest: manifest.archiveDigest, options: manifest.options, tables };
}

/**
 * SHA-256 of restored rows, serialized exactly like the exporter does: one JSON object per line, keys in column order, rows in
 * primary-key order. The caller supplies values already rendered as the archive renders them (money as 2-decimal text, timestamps as
 * UTC ISO-8601 with milliseconds, integers as numbers). Equality with the manifest hash proves a lossless round trip.
 */
export function restoredRowsSha256(table: ScratchTablePlan, rows: readonly Readonly<Record<string, unknown>>[]): string {
  const lines = rows.map((row) => `${JSON.stringify(Object.fromEntries(table.columns.map((c) => [c.name, row[c.name] === undefined ? null : row[c.name]])))}\n`);
  return sha256(lines.join(""));
}

const totalsKey = (t: ArchiveTotal): string => `${t.field}\u0000${t.currency}`;
const sameTotals = (a: readonly ArchiveTotal[], b: readonly ArchiveTotal[]): boolean => {
  const norm = (list: readonly ArchiveTotal[]) => list.map((t) => `${totalsKey(t)}\u0000${t.total}`).sort().join("\n");
  return norm(a) === norm(b);
};

/** Compares what was measured in the restored tables with what the manifest promised. Issue details name categories only, never values. */
export function compareScratchFigures(plan: ScratchRestorePlan, figures: ScratchFigures): ArchiveIssue[] {
  const issues: ArchiveIssue[] = [];
  for (const table of plan.tables) {
    const measured = figures.tables[table.category];
    if (!measured) {
      issues.push({ code: "RESTORE_TABLE_MISSING", category: table.category, detail: "the restored table could not be measured" });
      continue;
    }
    if (measured.count !== table.expected.recordCount) issues.push({ code: "RESTORE_COUNT_MISMATCH", category: table.category, detail: `${measured.count} row(s) restored vs ${table.expected.recordCount} in the manifest` });
    if (measured.sha256 !== table.expected.sha256) issues.push({ code: "RESTORE_CHECKSUM_MISMATCH", category: table.category, detail: "the restored rows, re-serialized, do not hash to the manifest checksum" });
    if (!sameTotals(measured.totals, table.expected.totals)) issues.push({ code: "RESTORE_TOTALS_MISMATCH", category: table.category, detail: "exact money totals of the restored rows differ from the manifest" });
  }
  return issues;
}

export interface InvoiceNetPosition {
  currency: string;
  invoiced: string;
  creditNoted: string;
  net: string;
}

const toCents = (v: string): bigint => {
  const m = /^(-?)(\d+)\.(\d{2})$/.exec(v);
  if (!m) throw new RangeError("not a 2-decimal amount");
  const cents = BigInt(`${m[2]}${m[3]}`);
  return m[1] ? -cents : cents;
};
const fromCents = (v: bigint): string => {
  const digits = (v < 0n ? -v : v).toString().padStart(3, "0");
  return `${v < 0n ? "-" : ""}${digits.slice(0, -2)}.${digits.slice(-2)}`;
};

/**
 * Invoice-total verification report: per currency, the restored invoice totals minus the restored credit-note totals. Currencies are
 * never mixed. This is a report of the archived figures, not a statement of what is legally owed.
 */
export function invoiceNetPosition(figures: ScratchFigures): InvoiceNetPosition[] {
  const sum = (category: string): Map<string, bigint> => {
    const out = new Map<string, bigint>();
    for (const t of figures.tables[category]?.totals ?? []) if (t.field === "totalAmount") out.set(t.currency, (out.get(t.currency) ?? 0n) + toCents(t.total));
    return out;
  };
  const invoiced = sum("invoices");
  const credited = sum("credit_notes");
  const currencies = [...new Set([...invoiced.keys(), ...credited.keys()])].filter((c) => c !== NO_CURRENCY_ON_RECORD).sort();
  return currencies.map((currency) => {
    const i = invoiced.get(currency) ?? 0n;
    const c = credited.get(currency) ?? 0n;
    return { currency, invoiced: fromCents(i), creditNoted: fromCents(c), net: fromCents(i - c) };
  });
}
