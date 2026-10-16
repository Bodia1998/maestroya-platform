import {
  computeArchiveTotals,
  type ArchiveRawRow,
  type LegacyArchiveSnapshot,
} from "@/domain/services/legacy-archive";
import { LEGACY_ARCHIVE_CATEGORIES, type ArchiveCategorySpec, type ArchiveField } from "@/domain/services/legacy-archive-spec";

/**
 * Module 167 — synthetic test data, generated from the archive spec itself so every declared field is exercised.
 * All values are obviously fake (sequential ids, "field-n" strings, round amounts); no real personal data exists in any fixture.
 */
export const uid = (category: number, n: number): string => `00000000-0000-4000-8${String(category).padStart(3, "0")}-${String(n).padStart(12, "0")}`;

const categoryIndex = new Map(LEGACY_ARCHIVE_CATEGORIES.map((c, i) => [c.key, i + 1]));
export const idOf = (key: string, n: number): string => uid(categoryIndex.get(key)!, n + 1);

export interface FixtureOptions {
  /** Rows generated for each category (default 2). */
  rowsPerCategory?: number;
  /** Wraps money values (default: plain 2-decimal string). Pass a Decimal-like factory to exercise `toFixed`. */
  money?: (value: string) => unknown;
  /** Reverse every category's row order (input order must not matter). */
  reverse?: boolean;
  /** Per-category row patches applied after generation: (row index, row) => overrides. */
  patch?: Record<string, (n: number, row: Record<string, unknown>) => Record<string, unknown>>;
  /** Rows that exist in the table but are out of scope (reported as outOfScopeCount). */
  outOfScopeRows?: number;
}

const IN_MEMORY_SCOPED = new Set(["affiliate_commissions", "affiliate_commission_reversals", "audit_logs"]);

function plainValue(spec: ArchiveCategorySpec, field: ArchiveField, n: number, count: number, fieldIndex: number): unknown {
  if (field.kind === "id" && field.name === "id") return idOf(spec.key, n);
  if (field.ref) return idOf(field.ref, n % Math.max(count, 1));
  switch (field.kind) {
    case "id":
      return field.external ? uid(900, n + 1) : idOf("payments", n % Math.max(count, 1));
    case "string":
      return field.name === "currency" ? "EUR" : `${field.name}-${n}`;
    case "enum":
      return `${field.name.toUpperCase()}_${n}`;
    case "money":
      return `${(n + 1) * 100 + fieldIndex}.${String(10 + n).padStart(2, "0")}`;
    case "decimal":
      return "2.00";
    case "int":
      return n + 1;
    case "bool":
      return false;
    case "date":
      return new Date(Date.UTC(2026, 0, 1 + n, 10, 0, 0, 123));
  }
}

function plainRows(spec: ArchiveCategorySpec, count: number): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (let n = 0; n < count; n += 1) {
    if (spec.key === "invoice_number_counters") {
      rows.push({ series: n % 2 === 0 ? "INV" : "CN", year: 2026 + Math.floor(n / 2), lastValue: n + 3, updatedAt: new Date(Date.UTC(2026, 5, 1 + n)) });
      continue;
    }
    const row: Record<string, unknown> = {};
    spec.fields.forEach((field, i) => {
      row[field.name] = plainValue(spec, field, n, count, i);
    });
    rows.push(row);
  }
  return rows;
}

export function fixtureRows(options: FixtureOptions = {}): Record<string, Record<string, unknown>[]> {
  const count = options.rowsPerCategory ?? 2;
  const out: Record<string, Record<string, unknown>[]> = {};
  for (const spec of LEGACY_ARCHIVE_CATEGORIES) {
    let rows = plainRows(spec, count);
    const patch = options.patch?.[spec.key];
    if (patch) rows = rows.map((row, n) => ({ ...row, ...patch(n, row) }));
    out[spec.key] = rows;
  }
  return out;
}

const moneyFields = (spec: ArchiveCategorySpec): string[] => spec.fields.filter((f) => f.kind === "money").map((f) => f.name);

export function fixtureSnapshot(options: FixtureOptions = {}): LegacyArchiveSnapshot {
  const wrap = options.money ?? ((v: string) => v);
  const categories: LegacyArchiveSnapshot["categories"] = Object.fromEntries(
    LEGACY_ARCHIVE_CATEGORIES.map((spec) => {
      const plain = fixtureRows(options)[spec.key]!;
      const money = new Set(moneyFields(spec));
      const control = IN_MEMORY_SCOPED.has(spec.key) || spec.key === "invoice_number_counters" ? null : { count: plain.length, totals: computeArchiveTotals(spec, plain.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v])))) };
      let raw: ArchiveRawRow[] = plain.map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, money.has(k) && typeof v === "string" ? wrap(v) : v])));
      if (options.reverse) raw = [...raw].reverse();
      return [spec.key, { rows: raw, tableTotal: plain.length + (options.outOfScopeRows ?? 0), control }];
    }),
  );
  return { categories };
}

export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  }
  return value;
}

/** Stands in for Prisma.Decimal: exposes only `toFixed`, returning the exact stored value. */
export const decimalLike = (value: string): { toFixed(digits: number): string } => ({ toFixed: () => value });
