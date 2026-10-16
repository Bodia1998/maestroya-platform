import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  ArchiveControlMismatchError,
  ArchiveDuplicateRecordError,
  ArchiveRowInvalidError,
  ArchiveSnapshotIncompleteError,
  LEGACY_ARCHIVE_FORMAT_VERSION,
  LEGACY_ARCHIVE_MANIFEST_FILE,
  LEGACY_ARCHIVE_SUMS_FILE,
  NO_CURRENCY_ON_RECORD,
  buildLegacyArchive,
  computeArchiveTotals,
  verifyLegacyArchive,
  type ArchiveFile,
  type ArchiveManifest,
  type LegacyArchiveOptions,
  type LegacyArchiveSnapshot,
} from "@/domain/services/legacy-archive";
import { LEGACY_ARCHIVE_BLOCKERS, LEGACY_ARCHIVE_CATEGORIES, LEGACY_ARCHIVE_EXCLUSIONS } from "@/domain/services/legacy-archive-spec";
import { decimalLike, deepFreeze, fixtureSnapshot, idOf } from "../../../../test-utils/legacy-archive-m167-fixture";

const NOW = new Date("2026-10-15T12:00:00.000Z");
const DEFAULT: LegacyArchiveOptions = { includeInvoiceContent: false, includeNarrative: false };
const ALL: LegacyArchiveOptions = { includeInvoiceContent: true, includeNarrative: true };
const spec = (key: string) => LEGACY_ARCHIVE_CATEGORIES.find((c) => c.key === key)!;
const file = (files: ArchiveFile[], name: string) => files.find((f) => f.name === name)!;
const text = (files: ArchiveFile[], name: string) => file(files, name).content.toString("utf8");
const replaceFile = (files: ArchiveFile[], name: string, content: string): ArchiveFile[] => files.map((f) => (f.name === name ? { name, content: Buffer.from(content) } : f));
const manifestOf = (files: ArchiveFile[]) => JSON.parse(text(files, LEGACY_ARCHIVE_MANIFEST_FILE)) as ArchiveManifest;
const codes = (files: ArchiveFile[]) => verifyLegacyArchive(files).issues.map((i) => i.code);

/** Replaces one category's content AND re-hashes nothing: used to prove the verifier catches the change on its own. */
const emptySnapshot = (): LegacyArchiveSnapshot => ({
  categories: Object.fromEntries(LEGACY_ARCHIVE_CATEGORIES.map((c) => [c.key, { rows: [], tableTotal: 0, control: { count: 0, totals: [] } }])),
});

describe("M167 — archive spec (the inventory)", () => {
  it("has unique categories and field names; every reference, currency and total field exists", () => {
    const keys = LEGACY_ARCHIVE_CATEGORIES.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(LEGACY_ARCHIVE_CATEGORIES.map((c) => c.model)).size).toBe(keys.length);
    for (const c of LEGACY_ARCHIVE_CATEGORIES) {
      const names = c.fields.map((f) => f.name);
      expect(new Set(names).size, c.key).toBe(names.length);
      for (const f of c.fields) {
        if (f.ref) expect(keys, `${c.key}.${f.name}`).toContain(f.ref);
        expect(Boolean(f.ref && f.external), `${c.key}.${f.name} is both ref and external`).toBe(false);
      }
      if (c.currencyField) expect(names).toContain(c.currencyField);
      for (const t of c.totalFields) expect(c.fields.find((f) => f.name === t)?.kind, `${c.key}.${t}`).toBe("money");
      for (const id of c.idFields ?? ["id"]) expect(names).toContain(id);
      expect(c.why.length).toBeGreaterThan(20);
      expect(c.scope.length).toBeGreaterThan(10);
    }
  });

  it("keeps affiliate categories after commissions and audit_logs last (the reader depends on it)", () => {
    const keys = LEGACY_ARCHIVE_CATEGORIES.map((c) => c.key);
    expect(keys.indexOf("affiliate_commissions")).toBeGreaterThan(keys.indexOf("commissions"));
    expect(keys.indexOf("affiliate_commission_reversals")).toBeGreaterThan(keys.indexOf("affiliate_commissions"));
    expect(keys[keys.length - 1]).toBe("audit_logs");
  });

  it("never carries party data or free text in the CORE tier, and never declares credentials, URLs, IP/user agent or contact data at all", () => {
    const personalOrFreeText = ["issuerLegalName", "issuerTaxId", "recipientLegalName", "recipientTaxId", "description", "title", "notes", "cancellationNote", "resolutionNote", "releaseReason", "failureReason", "reversalFailureReason", "errorMessage", "explanation", "resolutionReason", "cancelReason", "fileName", "cancellationReason"];
    const neverDeclared = ["fileUrl", "ipAddress", "userAgent", "acceptanceIpAddress", "acceptanceUserAgent", "metadata", "email", "phone", "referralCode", "scopeAnswers", "addressId", "idempotencyKey", "password", "secret", "token", "resolutionMetadata"];
    for (const c of LEGACY_ARCHIVE_CATEGORIES) {
      for (const f of c.fields) {
        expect(neverDeclared, `${c.key}.${f.name}`).not.toContain(f.name);
        if (personalOrFreeText.includes(f.name) && f.kind === "string") expect(f.tier, `${c.key}.${f.name}`).not.toBe("CORE");
      }
    }
    // Free-text "reason" columns are never CORE; the one CORE "reason" string is the provider's own reason code.
    for (const c of LEGACY_ARCHIVE_CATEGORIES) for (const f of c.fields) if (f.name === "reason" && f.kind === "string" && f.tier === "CORE") expect(`${c.key}.${f.name}`).toBe("stripe_disputes.reason");
    expect(spec("invoices").fields.filter((f) => f.tier === "INVOICE_CONTENT").map((f) => f.name)).toEqual(["issuerLegalName", "issuerTaxId", "recipientLegalName", "recipientTaxId"]);
  });

  it("documents the unresolved decisions and exclusions, including retention (D20)", () => {
    const ids = LEGACY_ARCHIVE_BLOCKERS.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(LEGACY_ARCHIVE_BLOCKERS.find((b) => b.id === "B1")?.title).toMatch(/D20/);
    expect(LEGACY_ARCHIVE_BLOCKERS.some((b) => b.kind === "LEGAL_DECISION")).toBe(true);
    expect(LEGACY_ARCHIVE_EXCLUSIONS.length).toBeGreaterThan(5);
    // No invented retention period anywhere in the blockers text.
    for (const b of LEGACY_ARCHIVE_BLOCKERS) expect(`${b.title} ${b.detail}`).not.toMatch(/\b\d+\s*(years?|años|days?)\b/i);
  });
});

describe("M167 — build: empty datasets, ordering, determinism", () => {
  it("builds a valid archive from an empty dataset (every category present, zero bytes, zero counts)", () => {
    const built = buildLegacyArchive(emptySnapshot(), DEFAULT, NOW);
    expect(built.files).toHaveLength(LEGACY_ARCHIVE_CATEGORIES.length + 2);
    for (const c of LEGACY_ARCHIVE_CATEGORIES) expect(file(built.files, `${c.key}.ndjson`).content.length).toBe(0);
    expect(built.manifest.totalRecords).toBe(0);
    expect(built.manifest.categories.every((c) => c.recordCount === 0 && c.totals.length === 0)).toBe(true);
    const verification = verifyLegacyArchive(built.files);
    expect(verification.issues).toEqual([]);
    expect(verification.ok).toBe(true);
  });

  it("orders records by primary key regardless of input order, and is byte-identical across repeated builds", () => {
    const forward = buildLegacyArchive(fixtureSnapshot({ rowsPerCategory: 5 }), DEFAULT, NOW);
    const reversed = buildLegacyArchive(fixtureSnapshot({ rowsPerCategory: 5, reverse: true }), DEFAULT, NOW);
    const again = buildLegacyArchive(fixtureSnapshot({ rowsPerCategory: 5 }), DEFAULT, new Date("2027-01-01T00:00:00.000Z"));
    for (const c of LEGACY_ARCHIVE_CATEGORIES) {
      expect(file(reversed.files, `${c.key}.ndjson`).content.equals(file(forward.files, `${c.key}.ndjson`).content), c.key).toBe(true);
      expect(file(again.files, `${c.key}.ndjson`).content.equals(file(forward.files, `${c.key}.ndjson`).content), c.key).toBe(true);
    }
    expect(reversed.manifest.archiveDigest).toBe(forward.manifest.archiveDigest);
    expect(again.manifest.archiveDigest).toBe(forward.manifest.archiveDigest);
    // Only the clock differs.
    expect(again.manifest.generatedAt).not.toBe(forward.manifest.generatedAt);
    expect({ ...again.manifest, generatedAt: "" }).toEqual({ ...forward.manifest, generatedAt: "" });

    const ids = text(forward.files, "payments.ndjson").trim().split("\n").map((l) => (JSON.parse(l) as { id: string }).id);
    expect(ids).toEqual([...ids].sort());
    expect(ids).toHaveLength(5);
  });

  it("emits keys in the declared order, UTC ISO timestamps, one JSON object per line, newline-terminated", () => {
    const built = buildLegacyArchive(fixtureSnapshot({ rowsPerCategory: 1 }), DEFAULT, NOW);
    const content = text(built.files, "payments.ndjson");
    expect(content.endsWith("\n")).toBe(true);
    const rec = JSON.parse(content.trim()) as Record<string, unknown>;
    expect(Object.keys(rec)).toEqual(spec("payments").fields.filter((f) => f.tier === "CORE").map((f) => f.name));
    expect(rec.createdAt).toBe("2026-01-01T10:00:00.123Z");
    expect(rec.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("orders the composite-key counters by series then numeric year, and refuses a duplicate", () => {
    const snap = fixtureSnapshot({ rowsPerCategory: 4, reverse: true });
    const built = buildLegacyArchive(snap, DEFAULT, NOW);
    const rows = text(built.files, "invoice_number_counters.ndjson").trim().split("\n").map((l) => JSON.parse(l) as { series: string; year: number });
    expect(rows.map((r) => `${r.series}/${r.year}`)).toEqual(["CN/2026", "CN/2027", "INV/2026", "INV/2027"]);

    const dup = fixtureSnapshot({ rowsPerCategory: 2 });
    const counters = dup.categories.invoice_number_counters!;
    const withDup: LegacyArchiveSnapshot = { categories: { ...dup.categories, invoice_number_counters: { ...counters, rows: [...counters.rows, counters.rows[0]!] } } };
    expect(() => buildLegacyArchive(withDup, DEFAULT, NOW)).toThrow(ArchiveDuplicateRecordError);
  });

  it("does not mutate the snapshot it reads (source records are untouched)", () => {
    const frozen = deepFreeze(fixtureSnapshot({ rowsPerCategory: 3 }));
    expect(() => buildLegacyArchive(frozen, ALL, NOW)).not.toThrow();
  });
});

describe("M167 — monetary precision and currency", () => {
  it("serialises Decimal-like values as exact 2-decimal strings and never uses floating point", () => {
    const snap = fixtureSnapshot({
      rowsPerCategory: 2,
      money: decimalLike,
      patch: { payments: (n) => ({ amount: n === 0 ? "0.10" : "0.20", currency: "EUR" }) },
    });
    const built = buildLegacyArchive(snap, DEFAULT, NOW);
    expect(text(built.files, "payments.ndjson")).toContain('"amount":"0.10"');
    // 0.1 + 0.2 is 0.30000000000000004 in floating point; here it must be exact.
    expect(built.manifest.categories.find((c) => c.key === "payments")!.totals).toEqual([{ field: "amount", currency: "EUR", total: "0.30" }]);
    expect(verifyLegacyArchive(built.files).ok).toBe(true);
  });

  it("sums large and negative amounts exactly, and keeps currencies separate (never netted or mixed)", () => {
    const records = [
      { currency: "EUR", amount: "9999999999.99" },
      { currency: "EUR", amount: "0.01" },
      { currency: "USD", amount: "-5.50" },
      { currency: "USD", amount: "5.50" },
      { currency: "GBP", amount: "-0.05" },
    ];
    expect(computeArchiveTotals(spec("transactions"), records)).toEqual([
      { field: "amount", currency: "EUR", total: "10000000000.00" },
      { field: "amount", currency: "GBP", total: "-0.05" },
      { field: "amount", currency: "USD", total: "0.00" },
    ]);
  });

  it("tags rows with no currency column as NO_CURRENCY_ON_RECORD and skips null amounts", () => {
    const totals = computeArchiveTotals(spec("service_requests"), [{ budgetMin: "10.00", budgetMax: null }, { budgetMin: "5.50", budgetMax: null }]);
    expect(totals).toEqual([{ field: "budgetMin", currency: NO_CURRENCY_ON_RECORD, total: "15.50" }]);
  });

  it("preserves each record's own currency in the data and totals per currency in the manifest", () => {
    const snap = fixtureSnapshot({ rowsPerCategory: 2, patch: { payments: (n) => ({ currency: n === 0 ? "EUR" : "USD", amount: n === 0 ? "10.00" : "20.00" }) } });
    const built = buildLegacyArchive(snap, DEFAULT, NOW);
    const lines = text(built.files, "payments.ndjson").trim().split("\n").map((l) => JSON.parse(l) as { currency: string; amount: string });
    expect(lines.map((l) => `${l.currency}:${l.amount}`).sort()).toEqual(["EUR:10.00", "USD:20.00"]);
    expect(built.manifest.categories.find((c) => c.key === "payments")!.totals).toEqual([
      { field: "amount", currency: "EUR", total: "10.00" },
      { field: "amount", currency: "USD", total: "20.00" },
    ]);
  });

  it("rejects an amount that is not an exact 2-decimal value instead of rounding it", () => {
    const base = fixtureSnapshot({ rowsPerCategory: 1 });
    const p = base.categories.payments!;
    for (const bad of ["10.5", "10.555", "1e3", "abc", 10.5, Number.NaN, ""]) {
      const snap: LegacyArchiveSnapshot = { categories: { ...base.categories, payments: { ...p, rows: [{ ...p.rows[0]!, amount: bad }], control: null } } };
      expect(() => buildLegacyArchive(snap, DEFAULT, NOW), String(bad)).toThrow(ArchiveRowInvalidError);
    }
  });
});

describe("M167 — sensitive data exclusion", () => {
  const withExtras = (extras: Record<string, unknown>) => fixtureSnapshot({ rowsPerCategory: 1, patch: { invoices: () => extras, payments: () => extras, audit_logs: () => extras, self_billing_authorizations: () => extras } });

  it("drops any field the reader returns that the spec does not allow (defence in depth)", () => {
    const built = buildLegacyArchive(withExtras({ ipAddress: "203.0.113.9", userAgent: "UA-FAKE", email: "someone@example.test", fileUrl: "https://example.test/f", metadata: { x: 1 }, acceptanceIpAddress: "203.0.113.10" }), ALL, NOW);
    // The manifest's exclusion list legitimately names these concepts in prose; the data files must not carry them.
    const everything = built.files.filter((f) => f.name.endsWith(".ndjson")).map((f) => f.content.toString("utf8")).join("\n");
    for (const needle of ["203.0.113", "UA-FAKE", "someone@example.test", "https://example.test/f", "ipAddress", "userAgent", "fileUrl", "acceptanceIp"]) expect(everything, needle).not.toContain(needle);
  });

  it("excludes party identity, line descriptions and free text by default; includes them only with the explicit options", () => {
    const base = fixtureSnapshot({ rowsPerCategory: 1 });
    const def = buildLegacyArchive(base, DEFAULT, NOW);
    expect(text(def.files, "invoices.ndjson")).not.toMatch(/issuerLegalName|issuerTaxId|recipientLegalName|recipientTaxId|cancellationReason/);
    expect(text(def.files, "invoice_line_items.ndjson")).not.toContain("description");
    expect(text(def.files, "credit_notes.ndjson")).not.toContain('"reason"');
    expect(text(def.files, "disputes.ndjson")).not.toMatch(/"title"|"description"|resolutionNote/);

    const content = buildLegacyArchive(base, { includeInvoiceContent: true, includeNarrative: false }, NOW);
    expect(text(content.files, "invoices.ndjson")).toContain("issuerTaxId");
    expect(text(content.files, "invoices.ndjson")).not.toContain("cancellationReason");
    expect(text(content.files, "disputes.ndjson")).not.toContain("resolutionNote");

    const narrative = buildLegacyArchive(base, { includeInvoiceContent: false, includeNarrative: true }, NOW);
    expect(text(narrative.files, "disputes.ndjson")).toContain("resolutionNote");
    expect(text(narrative.files, "invoices.ndjson")).not.toContain("issuerTaxId");

    for (const built of [def, content, narrative]) expect(verifyLegacyArchive(built.files).ok).toBe(true);
    expect(def.manifest.options).toEqual(DEFAULT);
    expect(content.manifest.options).toEqual({ includeInvoiceContent: true, includeNarrative: false });
    expect(def.manifest.archiveDigest).not.toBe(content.manifest.archiveDigest);
  });

  it("writes the unresolved blockers, exclusions and an explicit 'no retention period' statement into every manifest", () => {
    const m = buildLegacyArchive(fixtureSnapshot({ rowsPerCategory: 1 }), DEFAULT, NOW).manifest;
    expect(m.retention).toMatchObject({ periodsDefined: false, status: "UNRESOLVED_D20" });
    expect(m.blockers.map((b) => b.id)).toEqual(LEGACY_ARCHIVE_BLOCKERS.map((b) => b.id));
    expect(m.exclusions.length).toBe(LEGACY_ARCHIVE_EXCLUSIONS.length);
    expect(m.notice).toMatch(/not an approved retention archive/i);
    expect(m.source.flowBoundary).toBe("LEGACY_QUOTE_PAYMENT");
    expect(m.formatVersion).toBe(LEGACY_ARCHIVE_FORMAT_VERSION);
  });
});

describe("M167 — build fails closed (never a partial archive)", () => {
  it("throws when a category is missing from the snapshot", () => {
    const snap = fixtureSnapshot();
    const { payments: _omitted, ...rest } = snap.categories;
    expect(() => buildLegacyArchive({ categories: rest }, DEFAULT, NOW)).toThrow(ArchiveSnapshotIncompleteError);
  });

  it("throws on a missing required value, an invalid date or a non-string id", () => {
    expect(() => buildLegacyArchive(fixtureSnapshot({ rowsPerCategory: 1, patch: { payments: () => ({ payerId: null }) } }), DEFAULT, NOW)).toThrow(ArchiveRowInvalidError);
    expect(() => buildLegacyArchive(fixtureSnapshot({ rowsPerCategory: 1, patch: { payments: () => ({ createdAt: new Date("nope") }) } }), DEFAULT, NOW)).toThrow(ArchiveRowInvalidError);
    expect(() => buildLegacyArchive(fixtureSnapshot({ rowsPerCategory: 1, patch: { payments: () => ({ id: 42 }) } }), DEFAULT, NOW)).toThrow(ArchiveRowInvalidError);
    expect(() => buildLegacyArchive(fixtureSnapshot({ rowsPerCategory: 1, patch: { payments: () => ({ capturedAt: undefined }) } }), DEFAULT, NOW)).not.toThrow(); // nullable
  });

  it("never echoes a value in an error message", () => {
    try {
      buildLegacyArchive(fixtureSnapshot({ rowsPerCategory: 1, patch: { payments: () => ({ amount: "SECRET-AMOUNT-123" }) } }), DEFAULT, NOW);
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toContain("SECRET-AMOUNT-123");
    }
  });

  it("throws on duplicate records", () => {
    const snap = fixtureSnapshot({ rowsPerCategory: 2 });
    const p = snap.categories.payments!;
    expect(() => buildLegacyArchive({ categories: { ...snap.categories, payments: { ...p, rows: [p.rows[0]!, p.rows[0]!], control: null } } }, DEFAULT, NOW)).toThrow(ArchiveDuplicateRecordError);
  });

  it("throws when the exported rows disagree with the database's independent control count or exact sums (truncation / drift)", () => {
    const snap = fixtureSnapshot({ rowsPerCategory: 3 });
    const p = snap.categories.payments!;
    const dropOne: LegacyArchiveSnapshot = { categories: { ...snap.categories, payments: { ...p, rows: p.rows.slice(0, 2) } } };
    expect(() => buildLegacyArchive(dropOne, DEFAULT, NOW)).toThrow(ArchiveControlMismatchError);

    const wrongSum: LegacyArchiveSnapshot = { categories: { ...snap.categories, payments: { ...p, control: { count: 3, totals: [{ field: "amount", currency: "EUR", total: "0.01" }] } } } };
    expect(() => buildLegacyArchive(wrongSum, DEFAULT, NOW)).toThrow(ArchiveControlMismatchError);

    const wrongCurrency: LegacyArchiveSnapshot = { categories: { ...snap.categories, payments: { ...p, control: { count: 3, totals: p.control!.totals.map((t) => ({ ...t, currency: "USD" })) } } } };
    expect(() => buildLegacyArchive(wrongCurrency, DEFAULT, NOW)).toThrow(ArchiveControlMismatchError);
  });

  it("reports rows that exist in the table but are out of scope, and rejects an impossible table total", () => {
    const built = buildLegacyArchive(fixtureSnapshot({ rowsPerCategory: 2, outOfScopeRows: 7 }), DEFAULT, NOW);
    expect(built.manifest.categories.every((c) => c.outOfScopeCount === 7 && c.tableTotal === c.recordCount + 7)).toBe(true);

    const snap = fixtureSnapshot({ rowsPerCategory: 2 });
    const p = snap.categories.payments!;
    expect(() => buildLegacyArchive({ categories: { ...snap.categories, payments: { ...p, tableTotal: 1 } } }, DEFAULT, NOW)).toThrow(ArchiveControlMismatchError);
  });
});

describe("M167 — verification (checksums, counts, ordering, references, totals)", () => {
  const good = () => buildLegacyArchive(fixtureSnapshot({ rowsPerCategory: 3 }), ALL, NOW).files;

  it("accepts an untouched archive", () => {
    expect(verifyLegacyArchive(good())).toMatchObject({ ok: true, issues: [] });
  });

  it("detects a changed file (checksum), a missing file, an extra file and an altered SHA256SUMS", () => {
    const g = good();
    expect(codes(replaceFile(g, "payments.ndjson", `${text(g, "payments.ndjson")}\n`))).toContain("CHECKSUM_MISMATCH");
    expect(codes(g.filter((f) => f.name !== "refunds.ndjson"))).toContain("ARCHIVE_FILE_MISSING");
    expect(codes([...g, { name: "extra.txt", content: Buffer.from("x") }])).toContain("ARCHIVE_UNEXPECTED_FILE");
    expect(codes(replaceFile(g, LEGACY_ARCHIVE_SUMS_FILE, "tampered\n"))).toContain("SHA256SUMS_MISMATCH");
    expect(codes(g.filter((f) => f.name !== LEGACY_ARCHIVE_MANIFEST_FILE))).toContain("MANIFEST_MISSING");
  });

  it("detects duplicate and out-of-order records, and a wrong record count, even when the file is rehashed consistently", () => {
    const g = good();
    const lines = text(g, "payments.ndjson").trim().split("\n");
    const rewrite = (content: string) => {
      const files = replaceFile(g, "payments.ndjson", content);
      const m = manifestOf(files);
      const entry = m.categories.find((c) => c.key === "payments")!;
      // Keep size and hash consistent so only the structural problem remains.
      entry.bytes = Buffer.byteLength(content);
      entry.sha256 = createHash("sha256").update(content).digest("hex");
      return replaceFile(files, LEGACY_ARCHIVE_MANIFEST_FILE, JSON.stringify(m, null, 2));
    };
    expect(codes(rewrite(`${[lines[1], lines[0], lines[2]].join("\n")}\n`))).toContain("ORDER_VIOLATION");
    expect(codes(rewrite(`${[lines[0], lines[0], lines[2]].join("\n")}\n`))).toContain("RECORD_DUPLICATE");
    expect(codes(rewrite(`${lines.slice(0, 2).join("\n")}\n`))).toContain("COUNT_MISMATCH");
  });

  it("detects a record carrying a field the manifest's options do not allow", () => {
    const g = buildLegacyArchive(fixtureSnapshot({ rowsPerCategory: 2 }), ALL, NOW).files;
    const m = manifestOf(g);
    m.options = { includeInvoiceContent: false, includeNarrative: false };
    const found = codes(replaceFile(g, LEGACY_ARCHIVE_MANIFEST_FILE, JSON.stringify(m, null, 2)));
    expect(found).toContain("RECORD_FIELDS_MISMATCH");
    expect(found).toContain("MANIFEST_FIELDS_MISMATCH");
  });

  it("detects a reference that does not resolve inside the archive (broken relationship)", () => {
    const snap = fixtureSnapshot({ rowsPerCategory: 2, patch: { payouts: () => ({ paymentId: idOf("payments", 99) }) } });
    const built = buildLegacyArchive(snap, DEFAULT, NOW);
    const v = verifyLegacyArchive(built.files);
    expect(v.ok).toBe(false);
    expect(v.issues.map((i) => i.code)).toContain("REFERENCE_UNRESOLVED");
    expect(v.issues.find((i) => i.code === "REFERENCE_UNRESOLVED")!.category).toBe("payouts");
  });

  it("accepts null optional references and still checks every non-null one", () => {
    const snap = fixtureSnapshot({ rowsPerCategory: 2, patch: { payouts: () => ({ paymentId: null, jobId: null }) } });
    expect(verifyLegacyArchive(buildLegacyArchive(snap, DEFAULT, NOW).files).ok).toBe(true);
  });

  it("detects altered manifest totals, counts, digest and an unsupported version", () => {
    const g = good();
    const m1 = manifestOf(g);
    m1.categories.find((c) => c.key === "payments")!.totals[0]!.total = "0.01";
    expect(codes(replaceFile(g, LEGACY_ARCHIVE_MANIFEST_FILE, JSON.stringify(m1)))).toContain("TOTALS_MISMATCH");

    const m2 = manifestOf(g);
    m2.totalRecords += 1;
    expect(codes(replaceFile(g, LEGACY_ARCHIVE_MANIFEST_FILE, JSON.stringify(m2)))).toContain("TOTAL_RECORDS_MISMATCH");

    const m3 = manifestOf(g);
    m3.archiveDigest = "0".repeat(64);
    expect(codes(replaceFile(g, LEGACY_ARCHIVE_MANIFEST_FILE, JSON.stringify(m3)))).toContain("DIGEST_MISMATCH");

    const m4 = { ...manifestOf(g), formatVersion: 999 };
    expect(codes(replaceFile(g, LEGACY_ARCHIVE_MANIFEST_FILE, JSON.stringify(m4)))).toContain("MANIFEST_INVALID");
    expect(codes(replaceFile(g, LEGACY_ARCHIVE_MANIFEST_FILE, "{not json"))).toContain("MANIFEST_INVALID");
    expect(codes(replaceFile(g, LEGACY_ARCHIVE_MANIFEST_FILE, JSON.stringify({ format: "other" })))).toContain("MANIFEST_INVALID");
  });

  it("detects an invalid value in a record and never reports record values in issue details", () => {
    const snap = fixtureSnapshot({ rowsPerCategory: 2, patch: { payments: () => ({ stripePaymentIntentId: "pi_SECRET_VALUE_9" }) } });
    const g = buildLegacyArchive(snap, DEFAULT, NOW).files;
    const broken = replaceFile(g, "payments.ndjson", text(g, "payments.ndjson").replace(/"amount":"[^"]+"/, '"amount":"oops"'));
    const v = verifyLegacyArchive(broken);
    expect(v.issues.map((i) => i.code)).toEqual(expect.arrayContaining(["VALUE_INVALID", "CHECKSUM_MISMATCH"]));
    expect(JSON.stringify(v.issues)).not.toContain("pi_SECRET_VALUE_9");
    expect(JSON.stringify(v.issues)).not.toContain("oops");
  });

  it("caps the number of listed issues per code but still reports that there were more", () => {
    const snap = fixtureSnapshot({ rowsPerCategory: 30, patch: { payouts: () => ({ paymentId: idOf("payments", 999) }) } });
    const v = verifyLegacyArchive(buildLegacyArchive(snap, DEFAULT, NOW).files);
    const refs = v.issues.filter((i) => i.code === "REFERENCE_UNRESOLVED");
    expect(refs.length).toBeLessThanOrEqual(21);
    expect(refs.some((i) => /more/.test(i.detail))).toBe(true);
  });

  it("does not need a database or a clock: the same files verify identically later", () => {
    const g = good();
    expect(verifyLegacyArchive(g).manifestSha256).toBe(verifyLegacyArchive([...g].reverse()).manifestSha256);
  });
});
