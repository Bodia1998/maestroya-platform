import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

// The reader's default client is the shared singleton; every test here injects its own client, so the real one is never touched.
vi.mock("@/infrastructure/database/prisma/client", () => ({ prisma: {} }));

import { PrismaLegacyArchiveReader } from "@/infrastructure/database/prisma/repositories/prisma-legacy-archive-reader";
import {
  ArchiveControlMismatchError,
  LegacyArchiveScopeTooLargeError,
  archiveFieldNames,
  buildLegacyArchive,
  verifyLegacyArchive,
  type LegacyArchiveOptions,
} from "@/domain/services/legacy-archive";
import { LEGACY_ARCHIVE_CATEGORIES, LEGACY_AUDIT_ENTITY_TYPES, LEGACY_COUNTER_SERIES, LEGACY_WEBHOOK_PROVIDER } from "@/domain/services/legacy-archive-spec";
import { LEGACY_PAYMENT_WEBHOOK_PROVIDER } from "@/domain/services/legacy-wind-down";
import { fixtureRows, idOf, uid } from "../../../../../../test-utils/legacy-archive-m167-fixture";

type Row = Record<string, unknown>;
type Dict = Record<string, unknown>;
interface Call { model: string; method: string; args: Dict | string }

const DEFAULT: LegacyArchiveOptions = { includeInvoiceContent: false, includeNarrative: false };
const ALL: LegacyArchiveOptions = { includeInvoiceContent: true, includeNarrative: true };
const READ_METHODS = new Set(["findMany", "count", "aggregate", "groupBy"]);
const NOW = new Date("2026-10-15T12:00:00.000Z");
const spec = (key: string) => LEGACY_ARCHIVE_CATEGORIES.find((c) => c.key === key)!;
const modelOf = (key: string) => spec(key).model;

/** Money columns are Prisma.Decimal in the real client; wrap them so the reader's Decimal handling is exercised. */
function withDecimals(rows: Record<string, Row[]>): Record<string, Row[]> {
  return Object.fromEntries(
    LEGACY_ARCHIVE_CATEGORIES.map((c) => {
      const money = new Set(c.fields.filter((f) => f.kind === "money" || f.kind === "decimal").map((f) => f.name));
      return [c.key, (rows[c.key] ?? []).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, money.has(k) && typeof v === "string" ? new Prisma.Decimal(v) : v])))];
    }),
  );
}

interface FakeData {
  /** Rows by CATEGORY key (the fake maps them to the Prisma delegate name). */
  rows: Record<string, Row[]>;
  /** Whole-table row counts by category key (default: number of rows given). */
  tableTotals?: Record<string, number>;
  /** What the database would answer for count({ where }) by category key (default: number of rows given). */
  controlCounts?: Record<string, number>;
  failOnModel?: string;
}

/**
 * A fake transaction client. Any property other than a known READ method throws, so a write (create/update/delete/upsert) or an
 * unexpected raw query fails the test. Rows are projected to the requested `select` (so excluded fields cannot leak through the
 * fake), served with real keyset semantics, and the `where` is NOT evaluated — filters are asserted on the recorded arguments.
 */
function fakeClient(data: FakeData) {
  const calls: Call[] = [];
  let txOptions: unknown;
  const byModel = new Map(LEGACY_ARCHIVE_CATEGORIES.map((c) => [c.model, c.key]));

  const rowsFor = (model: string) => data.rows[byModel.get(model)!] ?? [];
  const project = (row: Row, select?: Dict) => (select ? Object.fromEntries(Object.keys(select).map((k) => [k, row[k]])) : row);

  const handle = (model: string, method: string, args: Dict): unknown => {
    const key = byModel.get(model)!;
    const rows = rowsFor(model);
    if (data.failOnModel === model) throw new Error("connection terminated");
    if (method === "count") return args && "where" in args ? (data.controlCounts?.[key] ?? rows.length) : (data.tableTotals?.[key] ?? rows.length);
    if (method === "groupBy") {
      const by = (args.by as string[])[0]!;
      const sums = Object.keys(args._sum as Dict);
      const groups = new Map<string, Row>();
      for (const row of rows) {
        const g = String(row[by]);
        const entry = groups.get(g) ?? { [by]: g, _sum: Object.fromEntries(sums.map((s) => [s, null])) };
        for (const s of sums) {
          const v = row[s];
          if (v === null || v === undefined) continue;
          const dec = v instanceof Prisma.Decimal ? v : new Prisma.Decimal(String(v));
          const cur = (entry._sum as Dict)[s] as Prisma.Decimal | null;
          (entry._sum as Dict)[s] = cur ? cur.plus(dec) : dec;
        }
        groups.set(g, entry);
      }
      return [...groups.values()];
    }
    if (method === "aggregate") {
      const sums = Object.keys(args._sum as Dict);
      const _sum: Dict = Object.fromEntries(sums.map((s) => [s, null]));
      for (const row of rows) {
        for (const s of sums) {
          const v = row[s];
          if (v === null || v === undefined) continue;
          const dec = v instanceof Prisma.Decimal ? v : new Prisma.Decimal(String(v));
          _sum[s] = _sum[s] ? (_sum[s] as Prisma.Decimal).plus(dec) : dec;
        }
      }
      return { _sum };
    }
    // findMany
    const select = args.select as Dict | undefined;
    if (Array.isArray(args.orderBy)) return rows.slice(0, args.take as number).map((r) => project(r, select));
    const sorted = [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id)));
    let start = 0;
    const cursor = args.cursor as { id: string } | undefined;
    if (cursor) start = sorted.findIndex((r) => r.id === cursor.id) + ((args.skip as number | undefined) ?? 0);
    return sorted.slice(start, start + ((args.take as number | undefined) ?? sorted.length)).map((r) => project(r, select));
  };

  const tx = new Proxy(
    {},
    {
      get(_t, name: string) {
        if (name === "$executeRawUnsafe") {
          return async (sql: string) => {
            calls.push({ model: "$raw", method: "$executeRawUnsafe", args: sql });
            return 0;
          };
        }
        return new Proxy(
          {},
          {
            get(_m, method: string) {
              if (!READ_METHODS.has(method)) throw new Error(`forbidden call on the read-only reader: ${name}.${method}`);
              return async (args: Dict) => {
                calls.push({ model: name, method, args: args ?? {} });
                return handle(name, method, args ?? {});
              };
            },
          },
        );
      },
    },
  );

  const client = {
    $transaction: vi.fn(async (fn: (t: unknown) => Promise<unknown>, options: unknown) => {
      txOptions = options;
      return fn(tx);
    }),
  };
  return { client, inject: client as never, calls, txOptions: () => txOptions };
}

const argsOf = (c: Call): Dict => (typeof c.args === "string" ? {} : c.args);
const findManyOf = (calls: Call[], key: string) => calls.filter((c) => c.model === modelOf(key) && c.method === "findMany");
const whereJson = (calls: Call[], key: string) => JSON.stringify(argsOf(findManyOf(calls, key)[0]!).where);
const baseRows = (n = 2) => withDecimals(fixtureRows({ rowsPerCategory: n }));

describe("M167 — PrismaLegacyArchiveReader: read-only transaction", () => {
  it("opens ONE READ ONLY / REPEATABLE READ transaction and sets READ ONLY before the first query", async () => {
    const f = fakeClient({ rows: baseRows() });
    await new PrismaLegacyArchiveReader({ client: f.inject }).readSnapshot(DEFAULT);
    expect(f.client.$transaction).toHaveBeenCalledTimes(1);
    expect(f.calls[0]).toEqual({ model: "$raw", method: "$executeRawUnsafe", args: "SET TRANSACTION READ ONLY" });
    expect(f.txOptions()).toMatchObject({ isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: expect.any(Number) });
    expect(f.calls.filter((c) => c.model === "$raw")).toHaveLength(1);
  });

  it("issues only read methods (the fake throws on anything else), never `include`, and covers every category exactly once", async () => {
    const f = fakeClient({ rows: baseRows() });
    const snap = await new PrismaLegacyArchiveReader({ client: f.inject }).readSnapshot(ALL);
    expect(Object.keys(snap.categories)).toEqual(LEGACY_ARCHIVE_CATEGORIES.map((c) => c.key));
    for (const c of f.calls) {
      if (c.model === "$raw") continue;
      expect(READ_METHODS.has(c.method)).toBe(true);
      expect(Object.keys(argsOf(c))).not.toContain("include");
    }
    for (const c of LEGACY_ARCHIVE_CATEGORIES) expect(findManyOf(f.calls, c.key).length, c.key).toBeGreaterThan(0);
  });

  it("propagates a database failure and returns no snapshot (never an empty 'clean' result)", async () => {
    const f = fakeClient({ rows: baseRows(), failOnModel: "invoice" });
    await expect(new PrismaLegacyArchiveReader({ client: f.inject }).readSnapshot(DEFAULT)).rejects.toThrow("connection terminated");
  });

  it("validates its constructor limits", () => {
    expect(() => new PrismaLegacyArchiveReader({ client: {} as never, pageSize: 0 })).toThrow(RangeError);
    expect(() => new PrismaLegacyArchiveReader({ client: {} as never, pageSize: 10_001 })).toThrow(RangeError);
    expect(() => new PrismaLegacyArchiveReader({ client: {} as never, maxRowsPerCategory: 0 })).toThrow(RangeError);
  });
});

describe("M167 — PrismaLegacyArchiveReader: legacy scope (flow boundary)", () => {
  it("filters every table with a service-request relation on flowVersion = LEGACY_QUOTE_PAYMENT", async () => {
    const f = fakeClient({ rows: baseRows() });
    await new PrismaLegacyArchiveReader({ client: f.inject }).readSnapshot(DEFAULT);
    const relational = ["service_requests", "quotes", "quote_items", "jobs", "disputes", "job_completion_confirmations", "appointments", "payments", "commissions", "dispute_resolution_decisions", "transactions", "refunds", "financial_adjustments", "dispute_evidence", "invoices", "invoice_line_items", "credit_notes", "credit_note_line_items"];
    for (const key of relational) {
      expect(whereJson(f.calls, key), key).toContain("LEGACY_QUOTE_PAYMENT");
      expect(whereJson(f.calls, key), key).not.toContain("LEAD_V1");
    }
    // The control figures use exactly the same filter as the rows.
    for (const key of relational) {
      const rowsWhere = whereJson(f.calls, key);
      const control = f.calls.find((c) => c.model === modelOf(key) && c.method === "count" && "where" in argsOf(c));
      expect(JSON.stringify(argsOf(control!).where), key).toBe(rowsWhere);
    }
  });

  it("scopes shared tables explicitly: counter series INV/CN only, the legacy webhook provider only, audit entity types by allow-list", async () => {
    const f = fakeClient({ rows: baseRows() });
    await new PrismaLegacyArchiveReader({ client: f.inject }).readSnapshot(DEFAULT);
    expect(argsOf(findManyOf(f.calls, "invoice_number_counters")[0]!).where).toEqual({ series: { in: [...LEGACY_COUNTER_SERIES] } });
    expect(LEGACY_COUNTER_SERIES).toEqual(["INV", "CN"]);
    expect(whereJson(f.calls, "invoice_number_counters")).not.toMatch(/LFI|LFC/);
    expect(argsOf(findManyOf(f.calls, "external_webhook_events")[0]!).where).toEqual({ provider: LEGACY_WEBHOOK_PROVIDER });
    // M167 declares its own constant (so the M166 source surface is untouched); it must stay equal to M166's.
    expect(LEGACY_WEBHOOK_PROVIDER).toBe(LEGACY_PAYMENT_WEBHOOK_PROVIDER);
    expect(LEGACY_WEBHOOK_PROVIDER).toBe("STRIPE_PAYMENTS");
    expect(argsOf(findManyOf(f.calls, "audit_logs")[0]!).where).toEqual({ entityType: { in: [...LEGACY_AUDIT_ENTITY_TYPES] }, entityId: { not: null } });
    expect(LEGACY_AUDIT_ENTITY_TYPES.some((t) => /lead/i.test(t))).toBe(false);
    // Legacy-only-by-construction tables carry no filter (documented in the spec).
    for (const key of ["payouts", "stripe_disputes", "self_billing_authorizations", "reconciliation_runs", "reconciliation_discrepancies"]) expect(argsOf(findManyOf(f.calls, key)[0]!).where, key).toEqual({});
  });

  it("scopes transactions to legacy payments, refunds, commissions and adjustments, or any payout", async () => {
    const f = fakeClient({ rows: baseRows() });
    await new PrismaLegacyArchiveReader({ client: f.inject }).readSnapshot(DEFAULT);
    const where = argsOf(findManyOf(f.calls, "transactions")[0]!).where as { OR: Dict[] };
    expect(where.OR).toHaveLength(5);
    expect(JSON.stringify(where.OR)).toContain("payoutId");
  });

  it("keeps affiliate rewards only when they derive from an archived commission, and reversals only of archived rewards", async () => {
    const rows = baseRows(2);
    rows.affiliate_commissions = [
      ...rows.affiliate_commissions!,
      { ...rows.affiliate_commissions![0]!, id: uid(26, 77), platformCommissionRefId: uid(77, 1) }, // derived from a non-archived commission
    ];
    rows.affiliate_commission_reversals = [
      ...rows.affiliate_commission_reversals!,
      { ...rows.affiliate_commission_reversals![0]!, id: uid(27, 77), affiliateCommissionId: uid(26, 77) }, // reversal of the dropped reward
    ];
    const f = fakeClient({ rows });
    const snap = await new PrismaLegacyArchiveReader({ client: f.inject }).readSnapshot(DEFAULT);
    expect(snap.categories.affiliate_commissions!.rows).toHaveLength(2);
    expect(snap.categories.affiliate_commissions!.rows.map((r) => r.id)).not.toContain(uid(26, 77));
    expect(snap.categories.affiliate_commission_reversals!.rows).toHaveLength(2);
    expect(snap.categories.affiliate_commissions!.tableTotal).toBe(3); // the excluded row is visible as out-of-scope, not hidden
    expect(snap.categories.affiliate_commissions!.control).toBeNull();
    expect(snap.categories.audit_logs!.control).toBeNull();
  });

  it("keeps audit entries only for records that are in the archive and reports the rest as out of scope", async () => {
    const rows = baseRows(2);
    rows.audit_logs = [
      ...rows.audit_logs!, // entityId = an archived payment
      { ...rows.audit_logs![0]!, id: uid(28, 50), entityId: uid(555, 1) }, // some other module's record
    ];
    const f = fakeClient({ rows });
    const snap = await new PrismaLegacyArchiveReader({ client: f.inject }).readSnapshot(DEFAULT);
    expect(snap.categories.audit_logs!.rows.map((r) => r.entityId)).toEqual([idOf("payments", 0), idOf("payments", 1)]);
    expect(snap.categories.audit_logs!.tableTotal).toBe(3);
  });
});

describe("M167 — PrismaLegacyArchiveReader: field selection and personal data", () => {
  it("selects exactly the fields the spec allows for the chosen options — nothing else", async () => {
    for (const options of [DEFAULT, { includeInvoiceContent: true, includeNarrative: false }, ALL]) {
      const f = fakeClient({ rows: baseRows() });
      await new PrismaLegacyArchiveReader({ client: f.inject }).readSnapshot(options);
      for (const c of LEGACY_ARCHIVE_CATEGORIES) {
        const select = argsOf(findManyOf(f.calls, c.key)[0]!).select as Dict;
        expect(Object.keys(select).sort(), `${c.key} ${JSON.stringify(options)}`).toEqual(archiveFieldNames(c, options).sort());
      }
    }
  });

  it("never selects party data, free text, URLs, IP/user agent or contact data by default", async () => {
    const f = fakeClient({ rows: baseRows() });
    await new PrismaLegacyArchiveReader({ client: f.inject }).readSnapshot(DEFAULT);
    const selected = new Set(f.calls.filter((c) => c.method === "findMany").flatMap((c) => Object.keys((argsOf(c).select as Dict | undefined) ?? {})));
    for (const forbidden of ["issuerLegalName", "issuerTaxId", "recipientLegalName", "recipientTaxId", "description", "title", "notes", "fileUrl", "fileName", "ipAddress", "userAgent", "acceptanceIpAddress", "acceptanceUserAgent", "metadata", "email", "referralCode", "scopeAnswers", "addressId", "idempotencyKey", "explanation", "resolutionNote", "cancellationNote", "failureReason"]) {
      expect(selected.has(forbidden), forbidden).toBe(false);
    }
    // (`reason` is selected by default only where it is an enum or the provider's own reason code: refunds, disputes, Stripe disputes.)
    // Even with every opt-in, the URL, IP / user agent, metadata and referral code are never selected.
    const g = fakeClient({ rows: baseRows() });
    await new PrismaLegacyArchiveReader({ client: g.inject }).readSnapshot(ALL);
    const all = new Set(g.calls.filter((c) => c.method === "findMany").flatMap((c) => Object.keys((argsOf(c).select as Dict | undefined) ?? {})));
    for (const forbidden of ["fileUrl", "ipAddress", "userAgent", "acceptanceIpAddress", "acceptanceUserAgent", "metadata", "referralCode", "scopeAnswers", "addressId", "idempotencyKey"]) expect(all.has(forbidden), forbidden).toBe(false);
    expect(all.has("issuerTaxId")).toBe(true);
  });
});

describe("M167 — PrismaLegacyArchiveReader: completeness (paging, ceiling, control figures)", () => {
  it("pages with keyset cursors and returns every row exactly once", async () => {
    const rows = withDecimals(fixtureRows({ rowsPerCategory: 5 }));
    const f = fakeClient({ rows });
    const snap = await new PrismaLegacyArchiveReader({ client: f.inject, pageSize: 2 }).readSnapshot(DEFAULT);
    const calls = findManyOf(f.calls, "payments");
    expect(calls).toHaveLength(3);
    expect(argsOf(calls[0]!)).toMatchObject({ take: 2, orderBy: { id: "asc" } });
    expect(argsOf(calls[1]!)).toMatchObject({ take: 2, skip: 1, cursor: { id: idOf("payments", 1) } });
    const ids = snap.categories.payments!.rows.map((r) => r.id);
    expect(ids).toEqual([0, 1, 2, 3, 4].map((n) => idOf("payments", n)));
  });

  it("fails closed when a category exceeds the ceiling instead of exporting a subset", async () => {
    const f = fakeClient({ rows: withDecimals(fixtureRows({ rowsPerCategory: 4 })) });
    await expect(new PrismaLegacyArchiveReader({ client: f.inject, maxRowsPerCategory: 3, pageSize: 2 }).readSnapshot(DEFAULT)).rejects.toBeInstanceOf(LegacyArchiveScopeTooLargeError);
    const g = fakeClient({ rows: withDecimals(fixtureRows({ rowsPerCategory: 4 })) });
    await expect(new PrismaLegacyArchiveReader({ client: g.inject, maxRowsPerCategory: 3, pageSize: 1000 }).readSnapshot(DEFAULT)).rejects.toThrow(/refusing to export a partial dataset/);
    // Exactly at the ceiling is allowed.
    const h = fakeClient({ rows: withDecimals(fixtureRows({ rowsPerCategory: 3 })) });
    await expect(new PrismaLegacyArchiveReader({ client: h.inject, maxRowsPerCategory: 3 }).readSnapshot(DEFAULT)).resolves.toBeDefined();
  });

  it("applies the ceiling to ARCHIVED rows: rows of other flows in a shared table (audit_logs) do not count against it", async () => {
    // Acceptance-review regression: the ceiling used to be checked BEFORE the in-memory legacy filter, so unrelated rows of the live
    // LEAD_V1 flow in a shared table could make the export impossible although only a few legacy rows qualify.
    const rows = baseRows(2);
    rows.audit_logs = [...rows.audit_logs!, ...[1, 2, 3, 4, 5, 6].map((n) => ({ ...rows.audit_logs![0]!, id: uid(28, 60 + n), entityId: uid(555, n) }))];
    const f = fakeClient({ rows });
    const snap = await new PrismaLegacyArchiveReader({ client: f.inject, maxRowsPerCategory: 3, pageSize: 2 }).readSnapshot(DEFAULT);
    expect(snap.categories.audit_logs!.rows.map((r) => r.entityId)).toEqual([idOf("payments", 0), idOf("payments", 1)]);
    expect(snap.categories.audit_logs!.tableTotal).toBe(8);

    // The ceiling still bounds what would be archived: too many QUALIFYING rows still fails closed.
    const many = baseRows(4);
    const g = fakeClient({ rows: many });
    await expect(new PrismaLegacyArchiveReader({ client: g.inject, maxRowsPerCategory: 3, pageSize: 2 }).readSnapshot(DEFAULT)).rejects.toBeInstanceOf(LegacyArchiveScopeTooLargeError);
  });

  it("asks the database independently for counts and exact sums (per currency where the row has one)", async () => {
    const f = fakeClient({ rows: baseRows(2) });
    const snap = await new PrismaLegacyArchiveReader({ client: f.inject }).readSnapshot(DEFAULT);
    expect(f.calls.some((c) => c.model === "payment" && c.method === "groupBy" && JSON.stringify(argsOf(c).by) === '["currency"]')).toBe(true);
    expect(f.calls.some((c) => c.model === "commission" && c.method === "aggregate")).toBe(true);
    const payments = snap.categories.payments!.control!;
    expect(payments.count).toBe(2);
    expect(payments.totals).toEqual([{ field: "amount", currency: "EUR", total: expect.stringMatching(/^\d+\.\d{2}$/) }]);
    expect(snap.categories.commissions!.control!.totals[0]).toMatchObject({ field: "amount", currency: "NO_CURRENCY_ON_RECORD" });
  });

  it("produces a snapshot that builds and verifies end to end, with Decimal money kept exact", async () => {
    const rows = baseRows(3);
    rows.payments = rows.payments!.map((r, i) => ({ ...r, amount: new Prisma.Decimal(i === 0 ? "0.10" : i === 1 ? "0.20" : "1234567.89") }));
    const f = fakeClient({ rows });
    const snap = await new PrismaLegacyArchiveReader({ client: f.inject }).readSnapshot(DEFAULT);
    const built = buildLegacyArchive(snap, DEFAULT, NOW);
    expect(verifyLegacyArchive(built.files)).toMatchObject({ ok: true });
    expect(built.manifest.categories.find((c) => c.key === "payments")!.totals).toEqual([{ field: "amount", currency: "EUR", total: "1234568.19" }]);
  });

  it("lets the builder detect a drifting or truncated read: control count above what was read aborts the export", async () => {
    const f = fakeClient({ rows: baseRows(2), controlCounts: { payments: 3 } });
    const snap = await new PrismaLegacyArchiveReader({ client: f.inject }).readSnapshot(DEFAULT);
    expect(() => buildLegacyArchive(snap, DEFAULT, NOW)).toThrow(ArchiveControlMismatchError);
  });

  it("reports whole-table totals so rows outside the legacy scope are visible, not silently dropped", async () => {
    const f = fakeClient({ rows: baseRows(2), tableTotals: { payments: 10, transactions: 9 } });
    const snap = await new PrismaLegacyArchiveReader({ client: f.inject }).readSnapshot(DEFAULT);
    const built = buildLegacyArchive(snap, DEFAULT, NOW);
    expect(built.manifest.categories.find((c) => c.key === "payments")).toMatchObject({ recordCount: 2, tableTotal: 10, outOfScopeCount: 8 });
    expect(built.manifest.categories.find((c) => c.key === "transactions")).toMatchObject({ recordCount: 2, tableTotal: 9, outOfScopeCount: 7 });
  });

  it("handles empty tables", async () => {
    const f = fakeClient({ rows: {} });
    const snap = await new PrismaLegacyArchiveReader({ client: f.inject }).readSnapshot(DEFAULT);
    expect(Object.values(snap.categories).every((c) => c.rows.length === 0 && c.tableTotal === 0)).toBe(true);
    expect(verifyLegacyArchive(buildLegacyArchive(snap, DEFAULT, NOW).files).ok).toBe(true);
  });
});
