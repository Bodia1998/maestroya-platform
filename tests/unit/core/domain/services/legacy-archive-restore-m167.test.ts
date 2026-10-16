import { describe, expect, it } from "vitest";

import { buildLegacyArchive } from "@/domain/services/legacy-archive";
import { ArchiveVerificationFailedError } from "@/domain/services/legacy-archive";
import { LEGACY_ARCHIVE_CATEGORIES } from "@/domain/services/legacy-archive-spec";
import { assertSafeIdentifier, compareScratchFigures, invoiceNetPosition, planScratchRestore, restoredRowsSha256 } from "@/domain/services/legacy-archive-restore";
import { RestoreLegacyArchiveRehearsalUseCase } from "@/application/use-cases/legacy-archive/restore-legacy-archive-rehearsal.use-case";
import { countSql, createTableSql, foreignKeySql, insertStatements, selectRowsSql, totalsSql } from "@/infrastructure/database/prisma/repositories/prisma-legacy-archive-scratch-restorer";
import { fixtureSnapshot } from "../../../../test-utils/legacy-archive-m167-fixture";

const OPTS = { includeInvoiceContent: false, includeNarrative: false };
const built = () => buildLegacyArchive(fixtureSnapshot({ rowsPerCategory: 3 }), OPTS, new Date("2026-10-15T12:00:00.000Z"));

describe("M167 — scratch restore plan (pure)", () => {
  it("has one table per category with the manifest's counts, hashes and totals, rows in archive order", () => {
    const b = built();
    const plan = planScratchRestore(b.files, { manifestSha256: b.manifestSha256, archiveDigest: b.manifest.archiveDigest });
    expect(plan.tables.map((t) => t.category)).toEqual(LEGACY_ARCHIVE_CATEGORIES.map((c) => c.key));
    for (const t of plan.tables) {
      expect(t.rows).toHaveLength(t.expected.recordCount);
      expect(t.columns.length).toBeGreaterThan(0);
      expect(t.primaryKey.length).toBeGreaterThan(0);
    }
    expect(plan.manifestSha256).toBe(b.manifestSha256);
  });

  it("round trip: rows rendered as the archive renders them hash to the manifest checksum (so a lossless load is provable)", () => {
    const b = built();
    const plan = planScratchRestore(b.files);
    for (const t of plan.tables) {
      const rows = t.rows.map((r) => Object.fromEntries(t.columns.map((c, i) => [c.name, r[i]])));
      expect(restoredRowsSha256(t, rows), t.category).toBe(t.expected.sha256);
    }
  });

  it("comparison reports count, checksum and total divergences by category, without values", () => {
    const plan = planScratchRestore(built().files);
    const ok = { tables: Object.fromEntries(plan.tables.map((t) => [t.category, { count: t.expected.recordCount, sha256: t.expected.sha256, totals: t.expected.totals }])) };
    expect(compareScratchFigures(plan, ok)).toEqual([]);
    const target = plan.tables.find((t) => t.expected.totals.length > 0)!;
    const bad = structuredClone(ok);
    bad.tables[target.category] = { count: target.expected.recordCount + 1, sha256: "0".repeat(64), totals: [{ ...target.expected.totals[0]!, total: "999999.99" }] };
    const codes = compareScratchFigures(plan, bad).map((i) => i.code).sort();
    expect(codes).toEqual(["RESTORE_CHECKSUM_MISMATCH", "RESTORE_COUNT_MISMATCH", "RESTORE_TOTALS_MISMATCH"]);
    delete (bad.tables as Record<string, unknown>)[target.category];
    expect(compareScratchFigures(plan, bad).map((i) => i.code)).toContain("RESTORE_TABLE_MISSING");
  });

  it("refuses to plan an archive that does not verify or does not match a pin", () => {
    const b = built();
    const tampered = b.files.map((f, i) => (i === 1 ? { ...f, content: Buffer.concat([f.content, Buffer.from("x")]) } : f));
    expect(() => planScratchRestore(tampered)).toThrow(ArchiveVerificationFailedError);
    expect(() => planScratchRestore(b.files, { archiveDigest: "f".repeat(64) })).toThrow(ArchiveVerificationFailedError);
  });

  it("invoice net position is exact, per currency, and never mixes currencies", () => {
    const figures = { tables: { invoices: { count: 0, sha256: "", totals: [{ field: "totalAmount", currency: "PLN", total: "1000.10" }, { field: "totalAmount", currency: "EUR", total: "5.00" }] }, credit_notes: { count: 0, sha256: "", totals: [{ field: "totalAmount", currency: "PLN", total: "0.30" }] } } };
    expect(invoiceNetPosition(figures)).toEqual([
      { currency: "EUR", invoiced: "5.00", creditNoted: "0.00", net: "5.00" },
      { currency: "PLN", invoiced: "1000.10", creditNoted: "0.30", net: "999.80" },
    ]);
  });

  it("identifiers are validated because they end up in SQL text", () => {
    expect(() => assertSafeIdentifier('x"; DROP TABLE y;--')).toThrow(RangeError);
    expect(() => assertSafeIdentifier("a".repeat(64))).toThrow(RangeError);
    expect(assertSafeIdentifier("credit_notes")).toBe("credit_notes");
  });
});

describe("M167 — scratch restore SQL builders", () => {
  const plan = planScratchRestore(built().files);
  const inv = plan.tables.find((t) => t.category === "invoices")!;

  it("never inlines values: inserts are parameterised, typed and batched under the parameter limit", () => {
    const statements = insertStatements("legacy_archive_restore_abc", inv);
    expect(statements.length).toBeGreaterThan(0);
    for (const s of statements) {
      expect(s.sql).toMatch(/^INSERT INTO "legacy_archive_restore_abc"\."invoices"/);
      expect(s.sql).toMatch(/\$1::/);
      expect(s.params.length).toBeLessThanOrEqual(30_000);
      for (const p of s.params) if (typeof p === "string") expect(s.sql).not.toContain(p.length > 12 ? p : "\u0000");
    }
    expect(statements.reduce((n, s) => n + s.params.length, 0)).toBe(inv.rows.length * inv.columns.length);
  });

  it("creates only inside the scratch schema; reads back with exact money text, UTC timestamps and byte-order sorting", () => {
    expect(createTableSql("legacy_archive_restore_abc", inv)).toMatch(/^CREATE TABLE "legacy_archive_restore_abc"\."invoices" \(/);
    expect(createTableSql("legacy_archive_restore_abc", inv)).toContain("numeric(20,2)");
    const select = selectRowsSql("legacy_archive_restore_abc", inv);
    expect(select).toContain('::text AS "totalAmount"');
    expect(select).toContain("to_char(");
    expect(select).toContain('COLLATE "C"');
    expect(countSql("s_1", inv)).toContain("count(*)");
    expect(totalsSql("s_1", inv, "totalAmount")).toContain("SUM(");
    expect(plan.tables.flatMap((t) => foreignKeySql("s_1", t)).length).toBeGreaterThan(0);
  });

  it("rejects an unsafe schema name", () => {
    expect(() => createTableSql('x"; DROP SCHEMA public;--', inv)).toThrow(RangeError);
  });
});

describe("M167 — restore rehearsal use case", () => {
  it("does not call the restorer when the archive does not verify", async () => {
    const b = built();
    let called = 0;
    const uc = new RestoreLegacyArchiveRehearsalUseCase(
      { read: async () => b.files.filter((f) => f.name !== "manifest.json") } as never,
      { restore: async () => { called += 1; throw new Error("must not run"); } },
    );
    await expect(uc.execute("/x", { keepSchema: false })).rejects.toBeInstanceOf(ArchiveVerificationFailedError);
    expect(called).toBe(0);
  });

  it("passes keepSchema through and reports the outcome and net position", async () => {
    const b = built();
    const seen: boolean[] = [];
    const uc = new RestoreLegacyArchiveRehearsalUseCase({ read: async () => b.files } as never, {
      restore: async (plan, o) => {
        seen.push(o.keepSchema);
        return { schemaName: null, kept: false, issues: [], figures: { tables: Object.fromEntries(plan.tables.map((t) => [t.category, { count: t.expected.recordCount, sha256: t.expected.sha256, totals: t.expected.totals }])) } };
      },
    });
    const r = await uc.execute("/x", { keepSchema: false, pins: { manifestSha256: b.manifestSha256 } });
    expect(seen).toEqual([false]);
    expect(r).toMatchObject({ ok: true, keptSchema: null, manifestSha256: b.manifestSha256 });
  });
});
