/**
 * Module 167 — acceptance review: the legacy archive reader/exporter against REAL PostgreSQL, synthetic fixtures only.
 *
 * Runs through the repo's real-DB harness (`TEST_DATABASE_URL`, guarded by `resolveTestDatabaseUrl`). Every value below is invented;
 * nothing here reads or writes production data. The archive is written to an OS temp directory outside the repository.
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, chmod } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/infrastructure/database/prisma/client";
import { PrismaLegacyArchiveReader } from "@/infrastructure/database/prisma/repositories/prisma-legacy-archive-reader";
import { FsLegacyArchiveStore } from "@/infrastructure/legacy-archive/fs-legacy-archive-store";
import { ExportLegacyArchiveUseCase } from "@/application/use-cases/legacy-archive/export-legacy-archive.use-case";
import { VerifyLegacyArchiveUseCase } from "@/application/use-cases/legacy-archive/verify-legacy-archive.use-case";
import { LEGACY_ARCHIVE_CATEGORIES } from "@/domain/services/legacy-archive-spec";
import { LegacyArchiveScopeTooLargeError, verifyLegacyArchive, type LegacyArchiveOptions } from "@/domain/services/legacy-archive";
import { createCapturedPayment, createFinancialGraph, createReconciliationRun } from "../../test-utils/db/seed-helpers";
import { setupDbTestLifecycle } from "../../test-utils/db/db-test-lifecycle";

setupDbTestLifecycle();

const NO_PII: LegacyArchiveOptions = { includeInvoiceContent: false, includeNarrative: false };
const ALL: LegacyArchiveOptions = { includeInvoiceContent: true, includeNarrative: true };
const SENTINELS = ["ISSUER-LEGAL-SENTINEL", "ISSUER-TAX-SENTINEL", "RECIPIENT-LEGAL-SENTINEL", "LINE-DESCRIPTION-SENTINEL", "CREDIT-REASON-SENTINEL"];
const NEVER = ["198.51.100.7", "agent-sentinel", "meta-sentinel", "https://example.invalid/evidence-sentinel", "192.0.2.1", "ua-sentinel"];

const tmpDirs: string[] = [];
const newTarget = async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "m167-review-"));
  tmpDirs.push(dir);
  return path.join(dir, "archive");
};
afterAll(async () => {
  for (const dir of tmpDirs) {
    await chmod(dir, 0o700).catch(() => undefined);
    for (const child of await readdir(dir).catch(() => [])) await chmod(path.join(dir, child), 0o700).catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  }
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE "audit_logs","invoice_number_counters","self_billing_authorizations","invoices","credit_notes","financial_adjustments","refunds","affiliate_commissions" RESTART IDENTITY CASCADE`,
  );
});

interface Seeded {
  paymentIds: string[];
  leadPaymentId: string;
  leadServiceRequestId: string;
  legacyServiceRequestIds: string[];
  invoiceIds: string[];
  professionalUserId: string;
  professionalProfileId: string;
  a: Awaited<ReturnType<typeof seedGraph>>;
}

async function seedGraph(opts: { amount: number; currency?: string; lead?: boolean }) {
  const g = await createFinancialGraph(prisma);
  if (opts.lead) await prisma.serviceRequest.update({ where: { id: g.serviceRequestId }, data: { flowVersion: "LEAD_V1" } });
  const payment = await createCapturedPayment(prisma, g, { amount: opts.amount });
  if (opts.currency) await prisma.payment.update({ where: { id: payment.id }, data: { currency: opts.currency } });
  await prisma.commission.create({ data: { paymentId: payment.id, rateBps: 1000, amount: opts.amount / 10 } });
  await prisma.refund.create({ data: { paymentId: payment.id, requestedByUserId: g.payerUserId, amount: 0.1, reason: "OTHER" } });
  const invoice = await prisma.invoice.create({
    data: {
      jobId: g.jobId, quoteId: g.quoteId, customerId: g.customerProfileId, professionalProfileId: g.professionalProfileId,
      issuerLegalName: "ISSUER-LEGAL-SENTINEL", issuerTaxId: "ISSUER-TAX-SENTINEL", recipientLegalName: "RECIPIENT-LEGAL-SENTINEL",
      invoiceDate: new Date("2026-03-01T10:00:00.000Z"),
      taxableBase: 0.1, vatRateBps: 2100, vatAmount: 0.2, commissionBase: 19.99, commissionRateBps: 1000, commissionAmount: 123.45, totalAmount: 9999999.99,
    },
  });
  await prisma.invoiceLineItem.create({ data: { invoiceId: invoice.id, description: "LINE-DESCRIPTION-SENTINEL", quantity: 1, unitPrice: 0.1, amount: 0.1 } });
  const creditNote = await prisma.creditNote.create({
    data: { originalInvoiceId: invoice.id, reason: "CREDIT-REASON-SENTINEL", idempotencyKey: `idem-${randomUUID()}`, reversedTaxableBase: 0.1, reversedVatRateBps: 2100, reversedVatAmount: 0.2, reversedCommissionAmount: 0.3, totalAmount: 0.6 },
  });
  await prisma.creditNoteLineItem.create({ data: { creditNoteId: creditNote.id, description: "LINE-DESCRIPTION-SENTINEL", amount: 0.6 } });
  return { g, payment, invoice };
}

async function seed(): Promise<Seeded> {
  const a = await seedGraph({ amount: 123.45 });
  const b = await seedGraph({ amount: 0.2, currency: "USD" });
  const c = await seedGraph({ amount: 19.99 });
  const lead = await seedGraph({ amount: 77.77, lead: true });

  await prisma.payout.create({ data: { amount: 100, jobId: a.g.jobId, paymentId: a.payment.id, professionalProfileId: a.g.professionalProfileId } });
  await prisma.transaction.create({ data: { type: "CHARGE", amount: 123.45, paymentId: a.payment.id } });
  await prisma.transaction.create({ data: { type: "CHARGE", amount: 77.77, paymentId: lead.payment.id } }); // LEAD_V1 decoy
  await prisma.financialAdjustment.create({ data: { jobId: b.g.jobId, type: "PARTIAL_REFUND", amount: 0.3, requestedByUserId: b.g.payerUserId, idempotencyKey: `adj-${randomUUID()}` } });
  await prisma.stripeDispute.create({ data: { stripeDisputeId: `dp_${randomUUID().slice(0, 8)}`, amount: 5.05, paymentId: a.payment.id, jobId: a.g.jobId } });
  await prisma.selfBillingAuthorization.create({ data: { professionalProfileId: a.g.professionalProfileId, agreementVersion: "v1", acceptedByUserId: a.g.professionalUserId, acceptedAt: new Date("2026-01-01T00:00:00.000Z"), acceptanceIpAddress: "192.0.2.1", acceptanceUserAgent: "ua-sentinel" } });
  await prisma.invoiceNumberCounter.create({ data: { series: "INV", year: 2026 } });
  await prisma.invoiceNumberCounter.create({ data: { series: "CN", year: 2026 } });
  await prisma.invoiceNumberCounter.create({ data: { series: "LF-DECOY", year: 2026 } });
  const run = await createReconciliationRun(prisma);
  await prisma.reconciliationDiscrepancy.create({ data: { detectedByRunId: run.id, lastSeenRunId: run.id, entityType: "PAYMENT", category: "PAYMENT_AMOUNT_MISMATCH", severity: "WARNING", explanation: "synthetic", fingerprint: `fp-${randomUUID()}` } });
  await prisma.externalWebhookEvent.create({ data: { provider: "STRIPE_PAYMENTS", externalEventId: "evt_synthetic_1" } });
  await prisma.externalWebhookEvent.create({ data: { provider: "SOME_OTHER_PROVIDER", externalEventId: "evt_decoy_1" } });

  const audit = (entityType: string, entityId: string | null) =>
    prisma.auditLog.create({ data: { action: "CREATE", entityType, entityId, metadata: { note: "meta-sentinel" }, ipAddress: "198.51.100.7", userAgent: "agent-sentinel" } });
  await audit("PAYMENT", a.payment.id); // in scope
  await audit("PAYMENT", b.payment.id); // in scope
  await audit("PAYMENT", lead.payment.id); // LEAD_V1 decoy: entityType allow-listed but id not archived
  await audit("PAYMENT", randomUUID()); // unknown id
  await audit("UnrelatedEntity", a.payment.id); // entityType not allow-listed

  return {
    paymentIds: [a.payment.id, b.payment.id, c.payment.id],
    leadPaymentId: lead.payment.id,
    leadServiceRequestId: lead.g.serviceRequestId,
    legacyServiceRequestIds: [a.g.serviceRequestId, b.g.serviceRequestId, c.g.serviceRequestId],
    invoiceIds: [a.invoice.id, b.invoice.id, c.invoice.id],
    professionalUserId: a.g.professionalUserId,
    professionalProfileId: a.g.professionalProfileId,
    a,
  };
}


/** Rows for the categories `seed()` leaves empty. Raw SQL, FK checks relaxed for this one transaction (disposable database). */
async function seedExtras(s: Seeded) {
  const enumFirst = async (typ: string) => (await prisma.$queryRawUnsafe<{ v: string }[]>(`SELECT (enum_range(NULL::"${typ}"))[1]::text AS v`))[0]!.v;
  const [dReason, dResolution, dOutcome, revType] = await Promise.all([enumFirst("DisputeReason"), enumFirst("DisputeResolution"), enumFirst("DisputeFinancialOutcome"), enumFirst("AffiliateCommissionReversalType")]);
  const { g } = s.a;
  const commissionId = (await prisma.commission.findFirstOrThrow({ where: { paymentId: s.a.payment.id } })).id;
  const disputeId = randomUUID();
  const affiliateId = randomUUID();
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
    await tx.$executeRawUnsafe(`INSERT INTO quote_items ("id","quoteId","description","quantity","unitPrice","amount","updatedAt") VALUES (gen_random_uuid(), '${g.quoteId}', 'QUOTE-ITEM-NARRATIVE-SENTINEL', 3, 0.10, 0.30, now())`);
    await tx.$executeRawUnsafe(`INSERT INTO job_completion_confirmations ("jobId","professionalCompletedAt","confirmationDeadlineAt","releaseReason","updatedAt") VALUES ('${g.jobId}', now(), now(), 'AUTO_RELEASE_SYNTHETIC', now())`);
    await tx.$executeRawUnsafe(`INSERT INTO appointments ("id","quoteId","serviceRequestId","addressId","jobId","professionalProfileId","updatedAt") VALUES (gen_random_uuid(), '${g.quoteId}', '${g.serviceRequestId}', '${g.addressId}', '${g.jobId}', '${g.professionalProfileId}', now())`);
    await tx.$executeRawUnsafe(`INSERT INTO disputes ("id","serviceRequestId","raisedByUserId","reason","description","caseNumber","title","jobId","respondentProfessionalProfileId","updatedAt") VALUES ('${disputeId}', '${g.serviceRequestId}', '${g.payerUserId}', '${dReason}', 'DISPUTE-NARRATIVE-SENTINEL', 'CASE-SYNTH-1', 'Synthetic dispute', '${g.jobId}', '${g.professionalProfileId}', now())`);
    await tx.$executeRawUnsafe(`INSERT INTO dispute_evidence ("id","disputeId","submittedByUserId","fileUrl","updatedAt") VALUES (gen_random_uuid(), '${disputeId}', '${g.payerUserId}', 'https://example.invalid/evidence-sentinel', now())`);
    await tx.$executeRawUnsafe(`INSERT INTO dispute_resolution_decisions ("disputeId","jobId","resolution","outcome","reason","decidedByUserId","decidedAt","updatedAt") VALUES ('${disputeId}', '${g.jobId}', '${dResolution}', '${dOutcome}', 'DECISION-NARRATIVE-SENTINEL', '${g.payerUserId}', now(), now())`);
    await tx.$executeRawUnsafe(`INSERT INTO affiliate_commissions ("id","partnerId","referralCode","conversionEventId","platformCommissionRefId","platformCommissionAmount","affiliateRateBps","affiliateAmount","expiresAt","updatedAt") VALUES ('${affiliateId}', gen_random_uuid(), 'REFERRAL-CODE-SENTINEL', gen_random_uuid(), '${commissionId}', 12.35, 500, 0.62, now(), now())`);
    await tx.$executeRawUnsafe(`INSERT INTO affiliate_commissions ("id","partnerId","referralCode","conversionEventId","platformCommissionRefId","platformCommissionAmount","affiliateRateBps","affiliateAmount","expiresAt","updatedAt") VALUES (gen_random_uuid(), gen_random_uuid(), 'REFERRAL-CODE-SENTINEL', gen_random_uuid(), 'a-lead-v1-commission-ref', 99.99, 500, 5.00, now(), now())`);
    await tx.$executeRawUnsafe(`INSERT INTO affiliate_commission_reversals ("id","affiliateCommissionId","amount","type","financialAdjustmentId") VALUES (gen_random_uuid(), '${affiliateId}', 0.10, '${revType}', 'fa-synth-1')`);
  });
  return { disputeId, affiliateId, commissionId };
}

const parseNdjson = (text: string): Record<string, unknown>[] => text.split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
async function readArchive(target: string) {
  const files = new Map<string, string>();
  for (const name of await readdir(target)) files.set(name, await readFile(path.join(target, name), "utf8"));
  return files;
}
async function exportArchive(options: LegacyArchiveOptions, readerOptions: ConstructorParameters<typeof PrismaLegacyArchiveReader>[0] = {}) {
  const target = await newTarget();
  const result = await new ExportLegacyArchiveUseCase(new PrismaLegacyArchiveReader(readerOptions), new FsLegacyArchiveStore()).execute({ targetPath: target, options });
  return { target, result, files: await readArchive(target) };
}
const tableDigests = async () => {
  const out: Record<string, string> = {};
  for (const c of LEGACY_ARCHIVE_CATEGORIES) {
    const rows = await prisma.$queryRawUnsafe<{ h: string; n: bigint }[]>(`SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS h, count(*) AS n FROM "${c.key}" t`);
    out[c.key] = `${rows[0]!.h}:${rows[0]!.n}`;
  }
  return out;
};

describe("M167 acceptance review — real PostgreSQL", () => {
  it("schema conformance: every spec category is a table, every spec field a column; money is scale 2, timestamps <= ms precision", async () => {
    const problems: string[] = [];
    for (const c of LEGACY_ARCHIVE_CATEGORIES) {
      const cols = await prisma.$queryRawUnsafe<{ column_name: string; data_type: string; numeric_scale: number | null; datetime_precision: number | null }[]>(
        `SELECT column_name::text AS column_name, data_type::text AS data_type, numeric_scale, datetime_precision FROM information_schema.columns WHERE table_schema='public' AND table_name='${c.key}'`,
      );
      if (cols.length === 0) problems.push(`${c.key}: no such table`);
      const byName = new Map(cols.map((x) => [x.column_name, x]));
      for (const f of c.fields) {
        const col = byName.get(f.name);
        if (!col) { problems.push(`${c.key}.${f.name}: no such column`); continue; }
        if ((f.kind === "money" || f.kind === "decimal") && col.numeric_scale !== 2) problems.push(`${c.key}.${f.name}: kind ${f.kind} but numeric_scale=${String(col.numeric_scale)} (toFixed(2) would round)`);
        if (f.kind === "date" && (col.datetime_precision ?? 0) > 3) problems.push(`${c.key}.${f.name}: timestamp precision ${String(col.datetime_precision)} > 3 (ISO ms would truncate)`);
        if (f.kind === "int" && !["integer", "smallint"].includes(col.data_type)) problems.push(`${c.key}.${f.name}: kind int but column is ${col.data_type}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("exports the legacy scope only: LEAD_V1 decoys are excluded and reported as out-of-scope, never exported", async () => {
    const s = await seed();
    const { result, files } = await exportArchive(NO_PII);
    expect(result.status).toBe("COMPLETE");
    const m = JSON.parse(files.get("manifest.json")!) as { categories: { key: string; recordCount: number; outOfScopeCount: number; tableTotal: number; controlled: boolean }[] };
    const cat = (k: string) => m.categories.find((c) => c.key === k)!;

    expect(cat("service_requests")).toMatchObject({ recordCount: 3, outOfScopeCount: 1, tableTotal: 4 });
    expect(cat("payments")).toMatchObject({ recordCount: 3, outOfScopeCount: 1 });
    expect(cat("commissions")).toMatchObject({ recordCount: 3, outOfScopeCount: 1 });
    expect(cat("invoices")).toMatchObject({ recordCount: 3, outOfScopeCount: 1 });
    expect(cat("invoice_line_items")).toMatchObject({ recordCount: 3 });
    expect(cat("credit_notes")).toMatchObject({ recordCount: 3 });
    expect(cat("refunds")).toMatchObject({ recordCount: 3 });
    expect(cat("transactions")).toMatchObject({ recordCount: 1, outOfScopeCount: 1 }); // LEAD_V1 CHARGE transaction excluded
    expect(cat("invoice_number_counters")).toMatchObject({ recordCount: 2, outOfScopeCount: 1 }); // decoy series excluded
    expect(cat("external_webhook_events")).toMatchObject({ recordCount: 1, outOfScopeCount: 1 }); // other provider excluded
    expect(cat("audit_logs")).toMatchObject({ recordCount: 2, tableTotal: 5, controlled: false }); // only allow-listed type AND archived id
    expect(cat("payouts")).toMatchObject({ recordCount: 1 });
    expect(cat("stripe_disputes")).toMatchObject({ recordCount: 1 });
    expect(cat("self_billing_authorizations")).toMatchObject({ recordCount: 1 });
    expect(cat("reconciliation_discrepancies")).toMatchObject({ recordCount: 1 });
    expect(cat("disputes")).toMatchObject({ recordCount: 0 }); // empty category exports as an empty, verifiable file
    expect(files.get("disputes.ndjson")).toBe("");

    const whole = [...files.values()].join("\n");
    expect(whole).not.toContain(s.leadPaymentId);
    expect(whole).not.toContain(s.leadServiceRequestId);
    for (const id of s.legacyServiceRequestIds) expect(files.get("service_requests.ndjson")).toContain(id);
  });

  it("keyset pagination (page size 2) returns exactly the database's ids, once each, in primary-key order", async () => {
    await seed();
    const { files } = await exportArchive(NO_PII, { pageSize: 2 });
    const expected = await prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT p.id FROM payments p JOIN service_requests sr ON sr.id = p."serviceRequestId" WHERE sr."flowVersion"='LEGACY_QUOTE_PAYMENT' ORDER BY p.id`,
    );
    const got = parseNdjson(files.get("payments.ndjson")!).map((r) => r.id);
    expect(got).toEqual(expected.map((r) => r.id));
    expect(new Set(got).size).toBe(got.length);
  });

  it("preserves money exactly per currency, and amounts that float arithmetic would corrupt", async () => {
    await seed();
    const { files } = await exportArchive(NO_PII);
    const inv = parseNdjson(files.get("invoices.ndjson")!);
    for (const r of inv) expect(r).toMatchObject({ taxableBase: "0.10", vatAmount: "0.20", commissionBase: "19.99", commissionAmount: "123.45", totalAmount: "9999999.99" });
    const manifest = JSON.parse(files.get("manifest.json")!) as { categories: { key: string; totals: { field: string; currency: string; total: string }[] }[] };
    const totals = manifest.categories.find((c) => c.key === "invoices")!.totals;
    expect(totals.find((t) => t.field === "taxableBase")!.total).toBe("0.30"); // 3 x 0.10 exactly
    expect(totals.find((t) => t.field === "totalAmount")!.total).toBe("29999999.97");
    const pay = manifest.categories.find((c) => c.key === "payments")!.totals.filter((t) => t.field === "amount");
    expect(pay).toEqual(expect.arrayContaining([{ field: "amount", currency: "EUR", total: "143.44" }, { field: "amount", currency: "USD", total: "0.20" }]));
    expect(pay).toHaveLength(2); // never netted across currencies
  });

  it("the reader's own transaction is REPEATABLE READ + READ ONLY and the database refuses a write inside it", async () => {
    await seed();
    const observed: { readOnly?: string; isolation?: string; writeError?: string } = {};
    const client = {
      $transaction: ((cb: (tx: never) => Promise<unknown>, opts?: unknown) =>
        prisma.$transaction(async (tx) => {
          const result = await cb(tx as never);
          observed.readOnly = String((await tx.$queryRawUnsafe<{ transaction_read_only: string }[]>("SHOW transaction_read_only"))[0]!.transaction_read_only);
          observed.isolation = String((await tx.$queryRawUnsafe<{ transaction_isolation: string }[]>("SHOW transaction_isolation"))[0]!.transaction_isolation);
          await tx.$executeRawUnsafe("SAVEPOINT m167_probe");
          try {
            await tx.$executeRawUnsafe(`INSERT INTO "invoice_number_counters" ("series","year","updatedAt") VALUES ('WRITE-PROBE', 1999, now())`);
            observed.writeError = "NO ERROR - WRITE SUCCEEDED";
          } catch (error) {
            observed.writeError = String((error as Error).message).slice(0, 200);
          }
          await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT m167_probe");
          return result;
        }, opts as never)) as never,
    };
    await new PrismaLegacyArchiveReader({ client }).readSnapshot(NO_PII);
    expect(observed.readOnly).toBe("on");
    expect(observed.isolation).toBe("repeatable read");
    expect(observed.writeError).toMatch(/read-only|25006/i);
    expect(await prisma.invoiceNumberCounter.count({ where: { series: "WRITE-PROBE" } })).toBe(0);
  });

  it("a write committed by another connection DURING the export is not seen (consistent snapshot) and the export still reconciles", async () => {
    await seed();
    let injected: string | null = null;
    const client = {
      $transaction: ((cb: (tx: never) => Promise<unknown>, opts?: unknown) =>
        prisma.$transaction(async (tx) => {
          const proxied = new Proxy(tx, {
            get(target, prop, receiver) {
              if (prop === "payment") {
                const delegate = Reflect.get(target, prop, receiver) as { findMany: (a: unknown) => Promise<unknown> };
                return new Proxy(delegate, {
                  get(d, p) {
                    if (p === "findMany") {
                      return async (args: unknown) => {
                        if (injected === null) {
                          const g = await createFinancialGraph(prisma); // other connection, autocommit, LEGACY by default
                          injected = (await createCapturedPayment(prisma, g, { amount: 999.99 })).id;
                        }
                        return d.findMany(args);
                      };
                    }
                    return Reflect.get(d, p);
                  },
                });
              }
              return Reflect.get(target, prop, receiver);
            },
          });
          return cb(proxied as never);
        }, opts as never)) as never,
    };
    const target = await newTarget();
    const result = await new ExportLegacyArchiveUseCase(new PrismaLegacyArchiveReader({ client }), new FsLegacyArchiveStore()).execute({ targetPath: target, options: NO_PII });
    expect(result.status).toBe("COMPLETE");
    expect(injected).not.toBeNull();
    expect(await prisma.payment.count({ where: { id: injected! } })).toBe(1); // the concurrent write really committed
    expect((await readArchive(target)).get("payments.ndjson")).not.toContain(injected!);
  });

  it("row-level fidelity: every archived field equals the source column, compared in SQL with native types (numeric, timestamp, uuid)", async () => {
    await seedExtras(await seed());
    const { files } = await exportArchive(ALL);
    const mismatches: string[] = [];
    let compared = 0;
    for (const c of LEGACY_ARCHIVE_CATEGORIES) {
      const docs = parseNdjson(files.get(`${c.key}.ndjson`)!);
      if (docs.length === 0) continue;
      const cond = c.fields.map((f) => {
        const a = `(a.doc->>'${f.name}')`;
        const sCol = `s."${f.name}"`;
        switch (f.kind) {
          case "money": case "decimal": return `${a}::numeric IS NOT DISTINCT FROM ${sCol}`;
          case "date": return `${a}::timestamp IS NOT DISTINCT FROM ${sCol}`;
          case "int": return `${a}::int IS NOT DISTINCT FROM ${sCol}`;
          case "bool": return `${a}::boolean IS NOT DISTINCT FROM ${sCol}`;
          default: return `${a} IS NOT DISTINCT FROM ${sCol}::text`;
        }
      });
      const on = (c.idFields ?? ["id"]).map((n) => `${n === "year" ? `(a.doc->>'year')::int` : `(a.doc->>'${n}')`} = ${n === "year" ? `s."year"` : `s."${n}"::text`}`).join(" AND ");
      const sql = `SELECT count(*) FILTER (WHERE NOT (${cond.join(" AND ")})) AS bad, count(*) AS joined FROM jsonb_array_elements($1::jsonb) AS a(doc) JOIN "${c.key}" s ON ${on}`;
      const [row] = await prisma.$queryRawUnsafe<{ bad: bigint; joined: bigint }[]>(sql, JSON.stringify(docs));
      compared += Number(row!.joined);
      if (Number(row!.joined) !== docs.length) mismatches.push(`${c.key}: ${docs.length} archived but ${String(row!.joined)} matched a source row by key`);
      if (Number(row!.bad) !== 0) mismatches.push(`${c.key}: ${String(row!.bad)} row(s) differ from the source`);
    }
    expect(mismatches).toEqual([]);
    expect(compared).toBeGreaterThan(40);
  });

  it("scope completeness: independent SQL (not the reader's filters) selects exactly the archived ids", async () => {
    await seed();
    const { files } = await exportArchive(NO_PII);
    const idsOf = (k: string) => parseNdjson(files.get(`${k}.ndjson`)!).map((r) => String(r.id));
    const sql = async (q: string) => (await prisma.$queryRawUnsafe<{ id: string }[]>(q)).map((r) => r.id);
    const L = `'LEGACY_QUOTE_PAYMENT'`;
    const expected: Record<string, string> = {
      service_requests: `SELECT id::text FROM service_requests WHERE "flowVersion"=${L} ORDER BY id`,
      quotes: `SELECT q.id::text FROM quotes q JOIN service_requests r ON r.id=q."serviceRequestId" WHERE r."flowVersion"=${L} ORDER BY q.id`,
      jobs: `SELECT j.id::text FROM jobs j JOIN service_requests r ON r.id=j."serviceRequestId" WHERE r."flowVersion"=${L} ORDER BY j.id`,
      payments: `SELECT p.id::text FROM payments p JOIN service_requests r ON r.id=p."serviceRequestId" WHERE r."flowVersion"=${L} ORDER BY p.id`,
      commissions: `SELECT c.id::text FROM commissions c JOIN payments p ON p.id=c."paymentId" JOIN service_requests r ON r.id=p."serviceRequestId" WHERE r."flowVersion"=${L} ORDER BY c.id`,
      refunds: `SELECT f.id::text FROM refunds f JOIN payments p ON p.id=f."paymentId" JOIN service_requests r ON r.id=p."serviceRequestId" WHERE r."flowVersion"=${L} ORDER BY f.id`,
      invoices: `SELECT i.id::text FROM invoices i JOIN jobs j ON j.id=i."jobId" JOIN service_requests r ON r.id=j."serviceRequestId" WHERE r."flowVersion"=${L} ORDER BY i.id`,
      credit_notes: `SELECT n.id::text FROM credit_notes n JOIN invoices i ON i.id=n."originalInvoiceId" JOIN jobs j ON j.id=i."jobId" JOIN service_requests r ON r.id=j."serviceRequestId" WHERE r."flowVersion"=${L} ORDER BY n.id`,
      transactions: `SELECT t.id::text FROM transactions t
        LEFT JOIN payments p ON p.id=t."paymentId" LEFT JOIN service_requests rp ON rp.id=p."serviceRequestId"
        LEFT JOIN refunds f ON f.id=t."refundId" LEFT JOIN payments pf ON pf.id=f."paymentId" LEFT JOIN service_requests rf ON rf.id=pf."serviceRequestId"
        LEFT JOIN commissions c ON c.id=t."commissionId" LEFT JOIN payments pc ON pc.id=c."paymentId" LEFT JOIN service_requests rc ON rc.id=pc."serviceRequestId"
        WHERE rp."flowVersion"=${L} OR rf."flowVersion"=${L} OR rc."flowVersion"=${L} OR t."payoutId" IS NOT NULL
           OR EXISTS (SELECT 1 FROM financial_adjustments fa JOIN jobs j ON j.id=fa."jobId" JOIN service_requests r ON r.id=j."serviceRequestId" WHERE fa."transactionId"=t.id AND r."flowVersion"=${L})
        ORDER BY t.id`,
    };
    for (const [key, q] of Object.entries(expected)) expect(idsOf(key), key).toEqual(await sql(q));
  });

  it("every one of the 28 categories can be populated and exports; affiliate rows follow ONLY archived commissions; never-exported fields stay out", async () => {
    const s = await seed();
    const x = await seedExtras(s);
    const { files } = await exportArchive(ALL);
    const m = JSON.parse(files.get("manifest.json")!) as { categories: { key: string; recordCount: number }[] };
    const empty = m.categories.filter((c) => c.recordCount === 0).map((c) => c.key);
    expect(empty).toEqual([]); // no category left unexercised
    const aff = parseNdjson(files.get("affiliate_commissions.ndjson")!);
    expect(aff.map((r) => r.id)).toEqual([x.affiliateId]); // the commission referencing an unknown/LEAD_V1 ref is excluded
    expect(parseNdjson(files.get("affiliate_commission_reversals.ndjson")!)).toHaveLength(1);
    const whole = [...files.values()].join("\n");
    for (const never of ["REFERRAL-CODE-SENTINEL", "https://example.invalid/evidence-sentinel", "a-lead-v1-commission-ref"]) expect(whole).not.toContain(never);
    for (const narrative of ["QUOTE-ITEM-NARRATIVE-SENTINEL", "DISPUTE-NARRATIVE-SENTINEL", "DECISION-NARRATIVE-SENTINEL"]) expect(whole).toContain(narrative); // ALL options
    const base = [...(await exportArchive(NO_PII)).files.values()].join("\n");
    for (const narrative of ["QUOTE-ITEM-NARRATIVE-SENTINEL", "DISPUTE-NARRATIVE-SENTINEL", "DECISION-NARRATIVE-SENTINEL"]) expect(base).not.toContain(narrative);
  });

  it("is non-destructive: every exported table is byte-for-byte unchanged after the export, and no transaction is left open", async () => {
    await seed();
    const before = await tableDigests();
    await exportArchive(ALL);
    expect(await tableDigests()).toEqual(before);
    const open = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM pg_stat_activity WHERE datname = current_database() AND state LIKE 'idle in transaction%'`);
    expect(Number(open[0]!.n)).toBe(0);
  });

  it("excludes personal data by default; opt-in tiers add only their own fields; technical personal data is never exported", async () => {
    await seed();
    const base = [...(await exportArchive(NO_PII)).files.values()].join("\n");
    for (const s of [...SENTINELS, ...NEVER]) expect(base).not.toContain(s);
    const full = [...(await exportArchive(ALL)).files.values()].join("\n");
    for (const s of SENTINELS) expect(full).toContain(s);
    for (const s of NEVER) expect(full).not.toContain(s);
  });

  it("is deterministic: two runs over unchanged data give identical category files and archiveDigest", async () => {
    await seed();
    const one = await exportArchive(NO_PII);
    const two = await exportArchive(NO_PII);
    expect(two.result.archiveDigest).toBe(one.result.archiveDigest);
    for (const [name, content] of one.files) if (name.endsWith(".ndjson")) expect(two.files.get(name)).toBe(content);
  });

  it("the published archive verifies from files alone (no database), with owner-only read-only permissions", async () => {
    await seed();
    const { target, files } = await exportArchive(NO_PII);
    const verification = await new VerifyLegacyArchiveUseCase(new FsLegacyArchiveStore()).execute(target);
    expect(verification.ok).toBe(true);
    expect(verifyLegacyArchive([...files].map(([name, content]) => ({ name, content: Buffer.from(content) }))).ok).toBe(true);
    const { stat } = await import("node:fs/promises");
    expect(((await stat(target)).mode & 0o777).toString(8)).toBe("500");
    expect(((await stat(path.join(target, "manifest.json"))).mode & 0o777).toString(8)).toBe("400");
    const sums = files.get("SHA256SUMS")!;
    expect(sums).toContain(createHash("sha256").update(files.get("manifest.json")!).digest("hex"));
  });

  it("fails closed and publishes nothing when a category exceeds the ceiling", async () => {
    await seed();
    const target = await newTarget();
    const uc = new ExportLegacyArchiveUseCase(new PrismaLegacyArchiveReader({ maxRowsPerCategory: 2 }), new FsLegacyArchiveStore());
    await expect(uc.execute({ targetPath: target, options: NO_PII })).rejects.toBeInstanceOf(LegacyArchiveScopeTooLargeError);
    await expect(readdir(target)).rejects.toThrow();
    expect((await readdir(path.dirname(target))).filter((n) => n.includes(".partial-"))).toEqual([]);
  });

  it("refuses to overwrite an existing target and leaves it untouched", async () => {
    await seed();
    const first = await exportArchive(NO_PII);
    const uc = new ExportLegacyArchiveUseCase(new PrismaLegacyArchiveReader(), new FsLegacyArchiveStore());
    await expect(uc.execute({ targetPath: first.target, options: NO_PII })).rejects.toMatchObject({ code: "LEGACY_ARCHIVE_TARGET_EXISTS" });
    expect(await readArchive(first.target)).toEqual(first.files);
  });

  it("an empty database exports a complete, verifiable archive with zero records", async () => {
    const { result, files } = await exportArchive(NO_PII);
    expect(result.totalRecords).toBe(0);
    expect(files.size).toBe(LEGACY_ARCHIVE_CATEGORIES.length + 2);
    expect([...files].filter(([n]) => n.endsWith(".ndjson")).every(([, c]) => c === "")).toBe(true);
  });

  // ---- in-memory-scoped categories share their table with the live LEAD_V1 flow ------------------------------------------------
  it("REGRESSION: legacy audit rows still export when NON-legacy audit rows of allow-listed entity types exceed the ceiling", async () => {
    const s = await seed();
    // A LEAD_V1 service request produces audit rows of an allow-listed entity type ("ServiceRequest") that are not in the archive scope.
    for (let i = 0; i < 5; i += 1) await prisma.auditLog.create({ data: { action: "CREATE", entityType: "ServiceRequest", entityId: s.leadServiceRequestId } });
    const result = await exportArchive(NO_PII, { maxRowsPerCategory: 4 }).then((r) => ({ ok: true as const, r }), (e: unknown) => ({ ok: false as const, e }));
    // Expected by a correct implementation: the ceiling bounds ARCHIVED rows (2 legacy audit rows), so this succeeds.
    expect(result.ok, result.ok ? "" : `export failed: ${(result.e as Error).message}`).toBe(true);
  });
});
