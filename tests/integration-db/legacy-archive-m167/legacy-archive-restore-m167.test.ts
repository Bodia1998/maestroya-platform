/**
 * Module 167 — scratch-restore rehearsal against REAL PostgreSQL (synthetic data only, repo harness guard via TEST_DATABASE_URL).
 * The archive is exported from the seeded test database, then loaded into an archive-shaped scratch schema of the same disposable
 * database and reconciled against the manifest.
 */
import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/infrastructure/database/prisma/client";
import { PrismaLegacyArchiveReader } from "@/infrastructure/database/prisma/repositories/prisma-legacy-archive-reader";
import { LegacyArchiveRestoreError, PrismaLegacyArchiveScratchRestorer, type ScratchSqlClient } from "@/infrastructure/database/prisma/repositories/prisma-legacy-archive-scratch-restorer";
import { FsLegacyArchiveStore } from "@/infrastructure/legacy-archive/fs-legacy-archive-store";
import { ExportLegacyArchiveUseCase } from "@/application/use-cases/legacy-archive/export-legacy-archive.use-case";
import { RestoreLegacyArchiveRehearsalUseCase } from "@/application/use-cases/legacy-archive/restore-legacy-archive-rehearsal.use-case";
import { ArchiveVerificationFailedError } from "@/domain/services/legacy-archive";
import { planScratchRestore } from "@/domain/services/legacy-archive-restore";
import { LEGACY_ARCHIVE_CATEGORIES } from "@/domain/services/legacy-archive-spec";
import { createCapturedPayment, createFinancialGraph } from "../../test-utils/db/seed-helpers";
import { setupDbTestLifecycle } from "../../test-utils/db/db-test-lifecycle";

setupDbTestLifecycle();

const client = prisma as unknown as ScratchSqlClient;
const restorer = new PrismaLegacyArchiveScratchRestorer(client); // injected: the shared test client stays open
const store = new FsLegacyArchiveStore();
const dirs: string[] = [];

async function seed() {
  for (const [amount, currency] of [[123.45, "PLN"], [0.2, "USD"], [19.99, "PLN"]] as const) {
    const g = await createFinancialGraph(prisma);
    const payment = await createCapturedPayment(prisma, g, { amount });
    await prisma.payment.update({ where: { id: payment.id }, data: { currency } });
    await prisma.commission.create({ data: { paymentId: payment.id, rateBps: 1000, amount: amount / 10 } });
    const invoice = await prisma.invoice.create({
      data: {
        jobId: g.jobId, quoteId: g.quoteId, customerId: g.customerProfileId, professionalProfileId: g.professionalProfileId,
        issuerLegalName: "X", issuerTaxId: "Y", recipientLegalName: "Z", invoiceDate: new Date("2026-03-01T10:00:00.123Z"),
        taxableBase: 0.1, vatRateBps: 2100, vatAmount: 0.2, commissionBase: 19.99, commissionRateBps: 1000, commissionAmount: 123.45, totalAmount: 9999999.99,
      },
    });
    await prisma.creditNote.create({
      data: { originalInvoiceId: invoice.id, reason: "R", idempotencyKey: `idem-${randomUUID()}`, reversedTaxableBase: 0.1, reversedVatRateBps: 2100, reversedVatAmount: 0.2, reversedCommissionAmount: 0.3, totalAmount: 0.6 },
    });
  }
}

async function exportArchive(includeAll = false) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "m167-restore-"));
  dirs.push(dir);
  const target = path.join(dir, "archive");
  const result = await new ExportLegacyArchiveUseCase(new PrismaLegacyArchiveReader(), store).execute({ targetPath: target, options: { includeInvoiceContent: includeAll, includeNarrative: includeAll } });
  return { target, result };
}
const useCase = () => new RestoreLegacyArchiveRehearsalUseCase(store, restorer);
const scratchSchemas = async () => (await prisma.$queryRawUnsafe<{ schema_name: string }[]>(`SELECT schema_name::text AS schema_name FROM information_schema.schemata WHERE schema_name LIKE 'legacy_archive_restore_%'`)).map((r) => r.schema_name);
const publicDigest = async () => {
  const out: string[] = [];
  for (const c of LEGACY_ARCHIVE_CATEGORIES) out.push(((await prisma.$queryRawUnsafe<{ h: string }[]>(`SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS h FROM public."${c.key}" t`))[0]!).h);
  return out.join(",");
};

beforeEach(async () => {
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "audit_logs","invoice_number_counters","self_billing_authorizations","invoices","credit_notes","financial_adjustments","refunds","affiliate_commissions" RESTART IDENTITY CASCADE`);
});
afterEach(async () => {
  for (const s of await scratchSchemas()) await prisma.$executeRawUnsafe(`DROP SCHEMA "${s}" CASCADE`);
});
afterAll(async () => {
  for (const dir of dirs) {
    await chmod(dir, 0o700).catch(() => undefined);
    for (const child of await readdir(dir).catch(() => [])) await chmod(path.join(dir, child), 0o700).catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  }
});

describe("M167 — scratch restore rehearsal on real PostgreSQL", () => {
  it("restores every category, reconciles counts / checksums / exact totals with the manifest, and leaves nothing behind by default", async () => {
    await seed();
    const { target, result } = await exportArchive(true);
    expect(result.totalRecords).toBeGreaterThan(0);
    const before = await publicDigest();

    const r = await useCase().execute(target, { keepSchema: false, pins: { manifestSha256: result.manifestSha256, archiveDigest: result.archiveDigest } });

    expect(r.issues).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.keptSchema).toBeNull();
    expect(Object.keys(r.figures.tables)).toHaveLength(LEGACY_ARCHIVE_CATEGORIES.length);
    for (const c of result.categories) expect(r.figures.tables[c.key]!.count, c.key).toBe(c.recordCount);
    expect(await scratchSchemas()).toEqual([]); // rolled back
    expect(await publicDigest()).toBe(before); // source untouched
  });

  it("invoice totals restored in PostgreSQL equal the source database's SUM per currency, and the net position is exact", async () => {
    await seed();
    const { target } = await exportArchive();
    const r = await useCase().execute(target, { keepSchema: false });
    const src = await prisma.$queryRawUnsafe<{ currency: string | null; inv: string }[]>(`SELECT (SELECT currency FROM payments LIMIT 1) AS currency, SUM("totalAmount")::text AS inv FROM invoices`);
    const invoiced = r.figures.tables["invoices"]!.totals.find((t) => t.field === "totalAmount")!;
    expect(r.invoiceNet.length).toBeGreaterThan(0);
    expect(r.invoiceNet.reduce((n, x) => n + Number(x.invoiced), 0)).toBeCloseTo(Number(src[0]!.inv), 2);
    expect(invoiced.total).toMatch(/^\d+\.\d{2}$/);
  });

  it("keepSchema keeps an archive-shaped schema with real foreign keys, only when all checks pass", async () => {
    await seed();
    const { target } = await exportArchive();
    const r = await useCase().execute(target, { keepSchema: true });
    expect(r.ok).toBe(true);
    expect(r.keptSchema).toMatch(/^legacy_archive_restore_[0-9a-f]{12}$/);
    const fks = await prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM information_schema.table_constraints WHERE constraint_schema = '${r.keptSchema}' AND constraint_type = 'FOREIGN KEY'`);
    expect(fks[0]!.n).toBeGreaterThan(0);
    const n = await prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM "${r.keptSchema}".invoices`);
    expect(n[0]!.n).toBe(3);
  });

  it("refuses a consistent forgery when the pinned digest is not matched, before anything is created in the database", async () => {
    await seed();
    const { target } = await exportArchive();
    await expect(useCase().execute(target, { keepSchema: true, pins: { archiveDigest: "e".repeat(64) } })).rejects.toBeInstanceOf(ArchiveVerificationFailedError);
    expect(await scratchSchemas()).toEqual([]);
  });

  it("a failing load (duplicate key / orphan reference) is rolled back completely and reported by SQLSTATE only", async () => {
    await seed();
    const { target } = await exportArchive();
    const plan = planScratchRestore(await store.read(target));
    const inv = plan.tables.find((t) => t.category === "invoices")!;
    inv.rows.push([...inv.rows[0]!]); // duplicate primary key
    const dup = await restorer.restore(plan, { keepSchema: true }).catch((e) => e);
    expect(dup).toBeInstanceOf(LegacyArchiveRestoreError);
    expect((dup as LegacyArchiveRestoreError).sqlState).toBe("23505");
    expect((dup as Error).message).not.toMatch(/Key \(/);

    const plan2 = planScratchRestore(await store.read(target));
    const cn = plan2.tables.find((t) => t.category === "credit_notes")!;
    const col = cn.columns.findIndex((c) => c.name === "originalInvoiceId");
    cn.rows[0]![col] = randomUUID();
    const orphan = await restorer.restore(plan2, { keepSchema: true }).catch((e) => e);
    expect((orphan as LegacyArchiveRestoreError).sqlState).toBe("23503");
    expect(await scratchSchemas()).toEqual([]);
  });

  it("detects a lossy load: a value changed after planning no longer hashes to the manifest checksum", async () => {
    await seed();
    const { target } = await exportArchive();
    const plan = planScratchRestore(await store.read(target));
    const inv = plan.tables.find((t) => t.category === "invoices")!;
    const col = inv.columns.findIndex((c) => c.name === "totalAmount");
    inv.rows[0]![col] = "1.00";
    const outcome = await restorer.restore(plan, { keepSchema: true });
    expect(outcome.kept).toBe(false); // not kept because checks failed
    expect(outcome.issues.map((i) => i.code)).toEqual(expect.arrayContaining(["RESTORE_CHECKSUM_MISMATCH", "RESTORE_TOTALS_MISMATCH"]));
    expect(await scratchSchemas()).toEqual([]);
  });

  it("an empty database yields an archive that restores to empty tables and passes", async () => {
    const { target } = await exportArchive();
    const r = await useCase().execute(target, { keepSchema: false });
    expect(r.ok).toBe(true);
    expect(Object.values(r.figures.tables).every((t) => t.count === 0)).toBe(true);
  });
});
