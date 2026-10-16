import { createHash } from "node:crypto";

import { DomainError } from "@/domain/errors/domain-error";
import {
  LEGACY_ARCHIVE_BLOCKERS,
  LEGACY_ARCHIVE_CATEGORIES,
  LEGACY_ARCHIVE_EXCLUSIONS,
  type ArchiveBlocker,
  type ArchiveCategorySpec,
  type ArchiveField,
  type ArchiveFieldKind,
} from "@/domain/services/legacy-archive-spec";

/**
 * Module 167 — Legacy Archive & Retention Export: pure build and verification logic (no I/O, no database, no clock).
 *
 * A snapshot read by a `LegacyArchiveReader` is turned into a deterministic archive: one NDJSON file per category (rows ordered by
 * primary key, keys in the order declared in the spec, money as exact 2-decimal strings, timestamps as UTC ISO-8601), a versioned
 * manifest (counts, byte sizes, SHA-256 per file, exact money totals per currency, an `archiveDigest`, the unresolved blockers) and
 * a standard `SHA256SUMS` file. The same data yields byte-identical category files and the same `archiveDigest` on every run; only
 * `generatedAt` differs.
 *
 * `verifyLegacyArchive` re-derives everything from the files alone, so it can run on a fresh export (read-back) or on an archive
 * restored years later, without a database.
 *
 * NOT legal, tax or accounting advice; no retention period is defined here (D20 is unresolved).
 */

export const LEGACY_ARCHIVE_FORMAT = "maestroya.legacy-archive";
export const LEGACY_ARCHIVE_FORMAT_VERSION = 1;
export const LEGACY_ARCHIVE_MANIFEST_FILE = "manifest.json";
export const LEGACY_ARCHIVE_SUMS_FILE = "SHA256SUMS";
export const NO_CURRENCY_ON_RECORD = "NO_CURRENCY_ON_RECORD";
export const LEGACY_ARCHIVE_NOTICE =
  "Evidence extract of legacy (LEGACY_QUOTE_PAYMENT) records, not a database backup and not an approved retention archive. No retention period is defined (D20 unresolved); nothing here is legal, tax or accounting advice. Resolve every blocker in this manifest before any legacy data is removed.";

export interface LegacyArchiveOptions {
  /** Include party legal names / tax ids, line descriptions and credit-note reasons (blocker B2). Default false. */
  includeInvoiceContent: boolean;
  /** Include free-text explanations (blocker B3). Default false. */
  includeNarrative: boolean;
}
export const DEFAULT_LEGACY_ARCHIVE_OPTIONS: LegacyArchiveOptions = { includeInvoiceContent: false, includeNarrative: false };

export type ArchiveRawRow = Readonly<Record<string, unknown>>;
export interface ArchiveTotal { field: string; currency: string; total: string }
/** Independent figures read from the database for the same scope as `rows` (count and exact sums), used to detect truncation. */
export interface ArchiveControl { count: number; totals: readonly ArchiveTotal[] }
export interface ArchiveCategorySnapshot {
  rows: readonly ArchiveRawRow[];
  /** Rows in the whole table (not just in scope); the difference is reported as `outOfScopeCount`, never hidden. */
  tableTotal: number;
  /** null when the category is scoped in memory and no independent database figure exists. */
  control: ArchiveControl | null;
}
export interface LegacyArchiveSnapshot { categories: Readonly<Record<string, ArchiveCategorySnapshot>> }
export interface ArchiveFile { name: string; content: Buffer }

export interface ArchiveManifestCategory {
  key: string;
  title: string;
  file: string;
  evidence: "MANDATORY" | "SUPPORTING";
  recordCount: number;
  tableTotal: number;
  outOfScopeCount: number;
  bytes: number;
  sha256: string;
  controlled: boolean;
  fields: string[];
  totals: ArchiveTotal[];
}
export interface ArchiveManifest {
  format: typeof LEGACY_ARCHIVE_FORMAT;
  formatVersion: number;
  module: "M167";
  generatedAt: string;
  options: LegacyArchiveOptions;
  source: { flowBoundary: "LEGACY_QUOTE_PAYMENT"; readConsistency: "REPEATABLE_READ_READ_ONLY" };
  notice: string;
  categories: ArchiveManifestCategory[];
  totalRecords: number;
  archiveDigest: string;
  retention: { periodsDefined: false; status: "UNRESOLVED_D20"; note: string };
  blockers: ArchiveBlocker[];
  exclusions: { item: string; reason: string }[];
}

export interface ArchiveIssue { code: string; category?: string; detail: string }
/**
 * Values recorded OUTSIDE the archive at export time (the CLI prints them). They are the only defence against a forger who can
 * rewrite every file and recompute every hash, because a checksum stored next to the data it covers proves consistency, not origin.
 * They are only as trustworthy as where the operator keeps them (a separate system, a ticket, a signed message...).
 */
export interface ArchivePins {
  /** SHA-256 of manifest.json. It covers every data file transitively (the manifest lists their hashes) and all metadata. */
  manifestSha256?: string;
  /** archiveDigest recomputed from the files: identity of the data, options and counts, independent of generatedAt and metadata. */
  archiveDigest?: string;
}
export const ARCHIVE_HEX_64 = /^[0-9a-f]{64}$/;

export interface ArchiveVerification {
  ok: boolean;
  issues: ArchiveIssue[];
  manifest: ArchiveManifest | null;
  manifestSha256: string | null;
  recordCounts: Record<string, number>;
  /** Which externally recorded values this verification was checked against. Empty = integrity only, origin NOT established. */
  pinned: { manifestSha256: boolean; archiveDigest: boolean };
}

export class ArchiveSnapshotIncompleteError extends DomainError {
  readonly code = "LEGACY_ARCHIVE_SNAPSHOT_INCOMPLETE";
  constructor(readonly category: string) {
    super(`The snapshot has no data for category "${category}"; refusing to build a partial archive.`);
  }
}
export class ArchiveRowInvalidError extends DomainError {
  readonly code = "LEGACY_ARCHIVE_ROW_INVALID";
  constructor(readonly category: string, readonly field: string, reason: string) {
    super(`A "${category}" row has an invalid or missing "${field}" (${reason}); refusing to build a partial archive.`);
  }
}
export class ArchiveDuplicateRecordError extends DomainError {
  readonly code = "LEGACY_ARCHIVE_DUPLICATE_RECORD";
  constructor(readonly category: string, readonly recordKey: string) {
    super(`Category "${category}" contains the record "${recordKey}" more than once.`);
  }
}
export class ArchiveControlMismatchError extends DomainError {
  readonly code = "LEGACY_ARCHIVE_CONTROL_MISMATCH";
  constructor(readonly category: string, detail: string) {
    super(`Category "${category}" does not match the independent database control figures (${detail}); the export is incomplete or inconsistent.`);
  }
}
export class LegacyArchiveScopeTooLargeError extends DomainError {
  readonly code = "LEGACY_ARCHIVE_SCOPE_TOO_LARGE";
  constructor(readonly table: string, readonly limit: number) {
    super(`The legacy archive scope exceeds ${limit} rows for "${table}"; refusing to export a partial dataset.`);
  }
}
export class ArchiveVerificationFailedError extends DomainError {
  readonly code = "LEGACY_ARCHIVE_VERIFICATION_FAILED";
  constructor(readonly issues: readonly ArchiveIssue[]) {
    super(`The archive failed verification with ${issues.length} issue(s): ${issues.slice(0, 5).map((i) => i.code).join(", ")}${issues.length > 5 ? ", ..." : ""}.`);
  }
}

const sha256 = (data: Buffer | string): string => createHash("sha256").update(data).digest("hex");
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const MONEY_RE = /^-?\d+\.\d{2}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** Fields of a category that may appear in an archive built with these options, in declaration order. */
export function archiveFields(spec: ArchiveCategorySpec, options: LegacyArchiveOptions): ArchiveField[] {
  return spec.fields.filter((fl) => fl.tier === "CORE" || (fl.tier === "INVOICE_CONTENT" && options.includeInvoiceContent) || (fl.tier === "NARRATIVE" && options.includeNarrative));
}
export const archiveFieldNames = (spec: ArchiveCategorySpec, options: LegacyArchiveOptions): string[] => archiveFields(spec, options).map((fl) => fl.name);

const idFieldsOf = (spec: ArchiveCategorySpec): readonly string[] => spec.idFields ?? ["id"];

/** Sort / uniqueness key of a record: the id, or the zero-padded composite natural key. */
export function archiveRecordKey(spec: ArchiveCategorySpec, record: Readonly<Record<string, unknown>>): string {
  return idFieldsOf(spec)
    .map((name) => {
      const v = record[name];
      return typeof v === "number" ? String(v).padStart(10, "0") : String(v);
    })
    .join("/");
}

// ---- exact money (integer cents, never floating point) --------------------------------------------------------------------------

function toCents(value: string): bigint {
  const m = /^(-?)(\d+)\.(\d{2})$/.exec(value);
  if (!m) throw new RangeError("not a 2-decimal amount");
  const v = BigInt(`${m[2]}${m[3]}`);
  return m[1] ? -v : v;
}
function fromCents(v: bigint): string {
  const negative = v < 0n;
  const digits = (negative ? -v : v).toString().padStart(3, "0");
  return `${negative ? "-" : ""}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

/** Per field and currency: the exact sum of the non-null values. A pair with no non-null value has no entry. Never netted across fields or currencies. */
export function computeArchiveTotals(spec: ArchiveCategorySpec, records: readonly Readonly<Record<string, unknown>>[]): ArchiveTotal[] {
  const acc = new Map<string, { field: string; currency: string; cents: bigint }>();
  for (const rec of records) {
    const currency = spec.currencyField ? String(rec[spec.currencyField]) : NO_CURRENCY_ON_RECORD;
    for (const field of spec.totalFields) {
      const v = rec[field];
      if (v === null || v === undefined) continue;
      const k = `${field}\u0000${currency}`;
      const cur = acc.get(k) ?? { field, currency, cents: 0n };
      cur.cents += toCents(v as string);
      acc.set(k, cur);
    }
  }
  return [...acc.values()].sort((a, b) => cmp(a.field, b.field) || cmp(a.currency, b.currency)).map((e) => ({ field: e.field, currency: e.currency, total: fromCents(e.cents) }));
}

// ---- value normalisation / validation -------------------------------------------------------------------------------------------

function isDecimalLike(v: unknown): v is { toFixed(digits: number): string } {
  return typeof v === "object" && v !== null && typeof (v as { toFixed?: unknown }).toFixed === "function";
}

function normalizeValue(category: string, field: ArchiveField, raw: unknown): string | number | boolean | null {
  if (raw === null || raw === undefined) {
    if (field.nullable) return null;
    throw new ArchiveRowInvalidError(category, field.name, "missing");
  }
  const bad = (why: string) => new ArchiveRowInvalidError(category, field.name, why);
  switch (field.kind) {
    case "id":
    case "enum":
      if (typeof raw !== "string" || raw.length === 0) throw bad("expected a non-empty string");
      return raw;
    case "string":
      if (typeof raw !== "string") throw bad("expected a string");
      return raw;
    case "money":
    case "decimal": {
      const s = typeof raw === "string" ? raw : isDecimalLike(raw) ? raw.toFixed(2) : null;
      if (s === null || !MONEY_RE.test(s)) throw bad("expected an exact 2-decimal amount");
      return s;
    }
    case "int":
      if (typeof raw !== "number" || !Number.isSafeInteger(raw)) throw bad("expected a safe integer");
      return raw;
    case "bool":
      if (typeof raw !== "boolean") throw bad("expected a boolean");
      return raw;
    case "date": {
      if (raw instanceof Date) {
        if (Number.isNaN(raw.getTime())) throw bad("invalid date");
        return raw.toISOString();
      }
      if (typeof raw === "string" && ISO_RE.test(raw) && !Number.isNaN(Date.parse(raw))) return raw;
      throw bad("expected a UTC ISO-8601 timestamp");
    }
  }
}

/** Validates an already-serialized value (used when reading an archive back). Returns a reason or null. */
function checkSerializedValue(kind: ArchiveFieldKind, nullable: boolean, v: unknown): string | null {
  if (v === null) return nullable ? null : "null in a non-nullable field";
  switch (kind) {
    case "id":
    case "enum":
      return typeof v === "string" && v.length > 0 ? null : "expected a non-empty string";
    case "string":
      return typeof v === "string" ? null : "expected a string";
    case "money":
    case "decimal":
      return typeof v === "string" && MONEY_RE.test(v) ? null : "expected an exact 2-decimal amount";
    case "int":
      return typeof v === "number" && Number.isSafeInteger(v) ? null : "expected a safe integer";
    case "bool":
      return typeof v === "boolean" ? null : "expected a boolean";
    case "date":
      return typeof v === "string" && ISO_RE.test(v) && !Number.isNaN(Date.parse(v)) ? null : "expected a UTC ISO-8601 timestamp";
  }
}

// ---- build ---------------------------------------------------------------------------------------------------------------------

const sameTotals = (a: readonly ArchiveTotal[], b: readonly ArchiveTotal[]): boolean => {
  const norm = (list: readonly ArchiveTotal[]) => list.map((t) => `${t.field}\u0000${t.currency}\u0000${toCents(t.total)}`).sort().join("\n");
  try {
    return norm(a) === norm(b);
  } catch {
    return false;
  }
};

function archiveDigestOf(options: LegacyArchiveOptions, categories: readonly { key: string; recordCount: number; sha256: string }[]): string {
  const head = `${LEGACY_ARCHIVE_FORMAT}\t${LEGACY_ARCHIVE_FORMAT_VERSION}\t${options.includeInvoiceContent}\t${options.includeNarrative}\n`;
  return sha256(head + categories.map((c) => `${c.key}\t${c.recordCount}\t${c.sha256}\n`).join(""));
}

function sumsFile(entries: readonly { name: string; sha256: string }[]): string {
  return entries.map((e) => `${e.sha256}  ${e.name}\n`).join("");
}

/**
 * Builds the archive from a snapshot. Fails closed — it never returns a partial archive:
 *  - a category missing from the snapshot, an invalid or missing value, a duplicate record, or a mismatch with the independent
 *    control figures (count / exact sums) throws.
 * Fields outside the spec (or outside the enabled tiers) are dropped even if the reader returned them.
 */
export function buildLegacyArchive(snapshot: LegacyArchiveSnapshot, options: LegacyArchiveOptions, generatedAt: Date): { files: ArchiveFile[]; manifest: ArchiveManifest; manifestSha256: string } {
  if (Number.isNaN(generatedAt.getTime())) throw new RangeError("generatedAt must be a valid date");
  const files: ArchiveFile[] = [];
  const manifestCategories: ArchiveManifestCategory[] = [];

  for (const spec of LEGACY_ARCHIVE_CATEGORIES) {
    const snap = snapshot.categories[spec.key];
    if (!snap) throw new ArchiveSnapshotIncompleteError(spec.key);
    const fields = archiveFields(spec, options);

    const records = snap.rows.map((row) => {
      const rec: Record<string, string | number | boolean | null> = {};
      for (const fl of fields) rec[fl.name] = normalizeValue(spec.key, fl, row[fl.name]);
      return rec;
    });
    const keyed = records.map((rec) => ({ key: archiveRecordKey(spec, rec), rec })).sort((a, b) => cmp(a.key, b.key));
    for (let i = 1; i < keyed.length; i += 1) {
      if (keyed[i]!.key === keyed[i - 1]!.key) throw new ArchiveDuplicateRecordError(spec.key, keyed[i]!.key);
    }
    const sorted = keyed.map((k) => k.rec);
    const totals = computeArchiveTotals(spec, sorted);

    if (snap.control) {
      if (snap.control.count !== sorted.length) throw new ArchiveControlMismatchError(spec.key, `count ${sorted.length} exported vs ${snap.control.count} in the database`);
      if (!sameTotals(totals, snap.control.totals)) throw new ArchiveControlMismatchError(spec.key, "exact money totals differ");
    }
    if (!Number.isInteger(snap.tableTotal) || snap.tableTotal < sorted.length) throw new ArchiveControlMismatchError(spec.key, "table total is smaller than the number of exported records");

    const content = Buffer.from(sorted.map((rec) => `${JSON.stringify(rec)}\n`).join(""), "utf8");
    const file = `${spec.key}.ndjson`;
    files.push({ name: file, content });
    manifestCategories.push({
      key: spec.key, title: spec.title, file, evidence: spec.evidence, recordCount: sorted.length, tableTotal: snap.tableTotal, outOfScopeCount: snap.tableTotal - sorted.length,
      bytes: content.length, sha256: sha256(content), controlled: snap.control !== null, fields: fields.map((fl) => fl.name), totals,
    });
  }

  const manifest: ArchiveManifest = {
    format: LEGACY_ARCHIVE_FORMAT,
    formatVersion: LEGACY_ARCHIVE_FORMAT_VERSION,
    module: "M167",
    generatedAt: generatedAt.toISOString(),
    options: { includeInvoiceContent: options.includeInvoiceContent, includeNarrative: options.includeNarrative },
    source: { flowBoundary: "LEGACY_QUOTE_PAYMENT", readConsistency: "REPEATABLE_READ_READ_ONLY" },
    notice: LEGACY_ARCHIVE_NOTICE,
    categories: manifestCategories,
    totalRecords: manifestCategories.reduce((n, c) => n + c.recordCount, 0),
    archiveDigest: archiveDigestOf(options, manifestCategories),
    retention: { periodsDefined: false, status: "UNRESOLVED_D20", note: "No retention period is defined or implied. Minimum and maximum periods must be confirmed by the appropriate Spanish professional adviser before any deletion." },
    blockers: LEGACY_ARCHIVE_BLOCKERS.map((b) => ({ ...b })),
    exclusions: LEGACY_ARCHIVE_EXCLUSIONS.map((e) => ({ ...e })),
  };
  const manifestContent = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  files.push({ name: LEGACY_ARCHIVE_MANIFEST_FILE, content: manifestContent });
  files.push({ name: LEGACY_ARCHIVE_SUMS_FILE, content: Buffer.from(sumsFile(files.map((f) => ({ name: f.name, sha256: sha256(f.content) }))), "utf8") });
  return { files, manifest, manifestSha256: sha256(manifestContent) };
}

// ---- verify --------------------------------------------------------------------------------------------------------------------

const MAX_LISTED_PER_CODE = 20;
class IssueCollector {
  private readonly listed: ArchiveIssue[] = [];
  private readonly counts = new Map<string, number>();
  add(code: string, detail: string, category?: string): void {
    const n = (this.counts.get(code) ?? 0) + 1;
    this.counts.set(code, n);
    if (n <= MAX_LISTED_PER_CODE) this.listed.push({ code, detail, ...(category ? { category } : {}) });
  }
  result(): ArchiveIssue[] {
    const out = [...this.listed];
    for (const [code, n] of this.counts) if (n > MAX_LISTED_PER_CODE) out.push({ code, detail: `${n - MAX_LISTED_PER_CODE} more "${code}" issue(s) not listed (${n} in total)` });
    return out;
  }
  get empty(): boolean {
    return this.counts.size === 0;
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function manifestShapeProblem(m: unknown): string | null {
  if (!isObj(m)) return "manifest is not an object";
  if (m.format !== LEGACY_ARCHIVE_FORMAT) return "unknown format";
  if (m.formatVersion !== LEGACY_ARCHIVE_FORMAT_VERSION) return `unsupported formatVersion ${String(m.formatVersion)}`;
  if (!isObj(m.options) || typeof m.options.includeInvoiceContent !== "boolean" || typeof m.options.includeNarrative !== "boolean") return "options are invalid";
  if (typeof m.archiveDigest !== "string" || typeof m.generatedAt !== "string" || typeof m.totalRecords !== "number") return "digest, generatedAt or totalRecords are invalid";
  if (!Array.isArray(m.categories)) return "categories are missing";
  for (const c of m.categories) {
    if (!isObj(c) || typeof c.key !== "string" || typeof c.file !== "string" || typeof c.sha256 !== "string" || !Number.isInteger(c.recordCount) || !Number.isInteger(c.bytes) || !Array.isArray(c.fields) || !Array.isArray(c.totals)) return "a category entry is invalid";
    if (!c.totals.every((t) => isObj(t) && typeof t.field === "string" && typeof t.currency === "string" && typeof t.total === "string" && MONEY_RE.test(t.total))) return "a category total is invalid";
  }
  return null;
}

/**
 * Verifies an archive from its files alone: manifest structure and version, exact file set, SHA-256 and byte size per file,
 * `SHA256SUMS`, record counts, strictly ascending unique keys, exact field set and value formats per record (so a field that is not
 * allowed by the manifest's options is detected), references between categories, exact money totals, `totalRecords` and
 * `archiveDigest`. Issue details name categories, fields and record ids only — never values.
 */
export function verifyLegacyArchive(files: readonly ArchiveFile[], pins: ArchivePins = {}): ArchiveVerification {
  const issues = new IssueCollector();
  for (const [name, value] of Object.entries(pins)) if (value !== undefined && !ARCHIVE_HEX_64.test(value)) throw new RangeError(`pinned ${name} must be 64 lowercase hex characters`);
  const pinned = { manifestSha256: pins.manifestSha256 !== undefined, archiveDigest: pins.archiveDigest !== undefined };
  /** A pinned value that cannot be established (manifest unreadable, file missing) counts as a mismatch: fail closed. */
  const checkPins = (manifestSha: string | null, recomputedDigest: string | null): void => {
    if (pins.manifestSha256 !== undefined && manifestSha !== pins.manifestSha256) issues.add("PINNED_MANIFEST_SHA256_MISMATCH", "manifest.json does not match the manifest SHA-256 recorded at export time");
    if (pins.archiveDigest !== undefined && recomputedDigest !== pins.archiveDigest) issues.add("PINNED_ARCHIVE_DIGEST_MISMATCH", "the archive digest recomputed from the files does not match the digest recorded at export time");
  };
  const finish = (manifest: ArchiveManifest | null, manifestSha: string | null, recordCounts: Record<string, number>, recomputedDigest: string | null = null): ArchiveVerification => {
    checkPins(manifestSha, recomputedDigest);
    return { ok: issues.empty, issues: issues.result(), manifest, manifestSha256: manifestSha, recordCounts, pinned };
  };

  const byName = new Map<string, ArchiveFile>();
  for (const file of files) {
    if (byName.has(file.name)) issues.add("ARCHIVE_DUPLICATE_FILE", `file "${file.name}" appears more than once`);
    byName.set(file.name, file);
  }
  const manifestFile = byName.get(LEGACY_ARCHIVE_MANIFEST_FILE);
  if (!manifestFile) {
    issues.add("MANIFEST_MISSING", `${LEGACY_ARCHIVE_MANIFEST_FILE} is missing`);
    return finish(null, null, {});
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifestFile.content.toString("utf8"));
  } catch {
    issues.add("MANIFEST_INVALID", "manifest is not valid JSON");
    return finish(null, null, {});
  }
  const shapeProblem = manifestShapeProblem(parsed);
  if (shapeProblem) {
    issues.add("MANIFEST_INVALID", shapeProblem);
    return finish(null, null, {});
  }
  const manifest = parsed as ArchiveManifest;
  const manifestSha = sha256(manifestFile.content);
  const options = manifest.options;
  const recordCounts: Record<string, number> = {};

  // Category list must be exactly the spec, in order.
  const expectedKeys = LEGACY_ARCHIVE_CATEGORIES.map((c) => c.key);
  if (manifest.categories.map((c) => c.key).join(",") !== expectedKeys.join(",")) issues.add("MANIFEST_CATEGORIES_MISMATCH", "the manifest does not list exactly the expected categories in order");

  // Exact file set.
  const expectedNames = new Set<string>([...manifest.categories.map((c) => c.file), LEGACY_ARCHIVE_MANIFEST_FILE, LEGACY_ARCHIVE_SUMS_FILE]);
  for (const name of byName.keys()) if (!expectedNames.has(name)) issues.add("ARCHIVE_UNEXPECTED_FILE", `unexpected file "${name}"`);
  for (const name of expectedNames) if (!byName.has(name)) issues.add("ARCHIVE_FILE_MISSING", `missing file "${name}"`);

  const idSets = new Map<string, Set<string>>();
  const parsedRecords = new Map<string, Record<string, unknown>[]>();
  const fileHashes: { name: string; sha256: string }[] = [];
  const actualCategoryHashes: { key: string; recordCount: number; sha256: string }[] = [];

  for (const entry of manifest.categories) {
    const spec = LEGACY_ARCHIVE_CATEGORIES.find((c) => c.key === entry.key);
    if (!spec) {
      issues.add("CATEGORY_UNKNOWN", `category "${entry.key}" is not part of format version ${LEGACY_ARCHIVE_FORMAT_VERSION}`);
      continue;
    }
    if (entry.file !== `${spec.key}.ndjson`) issues.add("MANIFEST_FILE_NAME_MISMATCH", `unexpected file name for "${spec.key}"`, spec.key);
    const file = byName.get(entry.file);
    if (!file) continue;

    const actualSha = sha256(file.content);
    fileHashes.push({ name: file.name, sha256: actualSha });
    if (actualSha !== entry.sha256) issues.add("CHECKSUM_MISMATCH", `SHA-256 of "${file.name}" differs from the manifest`, spec.key);
    if (file.content.length !== entry.bytes) issues.add("SIZE_MISMATCH", `size of "${file.name}" differs from the manifest`, spec.key);

    const fields = archiveFields(spec, options);
    const names = fields.map((fl) => fl.name);
    if (entry.fields.join(",") !== names.join(",")) issues.add("MANIFEST_FIELDS_MISMATCH", `the manifest field list for "${spec.key}" does not match the format and options`, spec.key);

    const text = file.content.toString("utf8");
    const lines = text === "" ? [] : text.split("\n");
    if (lines.length > 0) {
      if (lines[lines.length - 1] !== "") issues.add("FILE_NOT_NEWLINE_TERMINATED", `"${file.name}" does not end with a newline`, spec.key);
      lines.pop();
    }

    const records: Record<string, unknown>[] = [];
    const ids = new Set<string>();
    let previousKey: string | null = null;
    lines.forEach((line, index) => {
      let rec: unknown;
      try {
        rec = JSON.parse(line);
      } catch {
        issues.add("RECORD_NOT_JSON", `line ${index + 1} is not valid JSON`, spec.key);
        return;
      }
      if (!isObj(rec)) {
        issues.add("RECORD_NOT_OBJECT", `line ${index + 1} is not an object`, spec.key);
        return;
      }
      const keys = Object.keys(rec);
      if (keys.join(",") !== names.join(",")) {
        const unexpected = keys.filter((k) => !names.includes(k));
        issues.add("RECORD_FIELDS_MISMATCH", `line ${index + 1} does not carry exactly the allowed fields${unexpected.length > 0 ? ` (unexpected: ${unexpected.join(", ")})` : ""}`, spec.key);
        return;
      }
      for (const fl of fields) {
        const problem = checkSerializedValue(fl.kind, fl.nullable, rec[fl.name]);
        if (problem) issues.add("VALUE_INVALID", `line ${index + 1}, field "${fl.name}": ${problem}`, spec.key);
      }
      const key = archiveRecordKey(spec, rec);
      if (previousKey !== null) {
        if (key === previousKey) issues.add("RECORD_DUPLICATE", `record "${key}" appears more than once`, spec.key);
        else if (key < previousKey) issues.add("ORDER_VIOLATION", `record "${key}" is out of order`, spec.key);
      }
      previousKey = key;
      ids.add(key);
      records.push(rec);
    });
    recordCounts[spec.key] = lines.length;
    if (lines.length !== entry.recordCount) issues.add("COUNT_MISMATCH", `${lines.length} record(s) in "${file.name}" vs ${entry.recordCount} in the manifest`, spec.key);
    if (entry.outOfScopeCount !== entry.tableTotal - entry.recordCount || entry.outOfScopeCount < 0) issues.add("OUT_OF_SCOPE_COUNT_INVALID", `outOfScopeCount of "${spec.key}" is inconsistent`, spec.key);

    // Exact totals, recomputed from the records themselves.
    try {
      const recomputed = computeArchiveTotals(spec, records);
      if (!sameTotals(recomputed, entry.totals)) issues.add("TOTALS_MISMATCH", `exact money totals of "${spec.key}" differ from the manifest`, spec.key);
    } catch {
      issues.add("TOTALS_MISMATCH", `money totals of "${spec.key}" could not be recomputed`, spec.key);
    }

    idSets.set(spec.key, ids);
    parsedRecords.set(spec.key, records);
    actualCategoryHashes.push({ key: spec.key, recordCount: entry.recordCount, sha256: actualSha });
  }

  // References between categories.
  for (const spec of LEGACY_ARCHIVE_CATEGORIES) {
    const records = parsedRecords.get(spec.key);
    if (!records) continue;
    for (const fl of archiveFields(spec, options)) {
      if (!fl.ref) continue;
      const target = idSets.get(fl.ref);
      if (!target) continue;
      for (const rec of records) {
        const v = rec[fl.name];
        if (typeof v === "string" && !target.has(v)) issues.add("REFERENCE_UNRESOLVED", `${spec.key}.${fl.name} of record "${archiveRecordKey(spec, rec)}" points at a ${fl.ref} record that is not in the archive`, spec.key);
      }
    }
  }

  // Aggregate checks.
  if (manifest.totalRecords !== manifest.categories.reduce((n, c) => n + c.recordCount, 0)) issues.add("TOTAL_RECORDS_MISMATCH", "totalRecords differs from the sum of the category counts");
  const recomputedDigest = actualCategoryHashes.length === manifest.categories.length ? archiveDigestOf(options, actualCategoryHashes) : null;
  if (recomputedDigest !== null && recomputedDigest !== manifest.archiveDigest) issues.add("DIGEST_MISMATCH", "archiveDigest does not match the files");

  const sums = byName.get(LEGACY_ARCHIVE_SUMS_FILE);
  if (sums) {
    const expectedSums = sumsFile([...fileHashes, { name: LEGACY_ARCHIVE_MANIFEST_FILE, sha256: manifestSha }]);
    if (sums.content.toString("utf8") !== expectedSums) issues.add("SHA256SUMS_MISMATCH", `${LEGACY_ARCHIVE_SUMS_FILE} does not match the files`);
  }

  return finish(manifest, manifestSha, recordCounts, recomputedDigest);
}
