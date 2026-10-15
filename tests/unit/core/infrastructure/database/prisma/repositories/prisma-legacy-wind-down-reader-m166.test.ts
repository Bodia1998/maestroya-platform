import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

// The reader's default client is the shared singleton; every test here injects its own client, so the real one is never touched.
vi.mock("@/infrastructure/database/prisma/client", () => ({ prisma: {} }));

import { PrismaLegacyWindDownReader } from "@/infrastructure/database/prisma/repositories/prisma-legacy-wind-down-reader";
import {
  LEGACY_CAPTURED_PAYMENT_STATUSES,
  LEGACY_OPEN_QUOTE_STATUSES,
  LEGACY_PAYMENT_WEBHOOK_PROVIDER,
  LEGACY_UNCONFIRMED_PAYMENT_STATUSES,
  LegacyWindDownScopeTooLargeError,
} from "@/domain/services/legacy-wind-down";

type Row = Record<string, unknown> & { id?: string };
type Dict = Record<string, unknown>;
/** The subset of a Prisma query's arguments the fake and the assertions look at. */
interface QueryArgs {
  where?: Dict;
  select?: Dict;
  include?: unknown;
  take?: number;
  skip?: number;
  cursor?: { id: string };
  orderBy?: unknown;
}
interface Call {
  model: string;
  method: string;
  args: QueryArgs | string;
}

/** Safe deep read: returns undefined instead of throwing on a missing path. */
function at(obj: unknown, ...path: string[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Dict)[key];
  }
  return cur;
}
const queryArgs = (c: Call): QueryArgs => (typeof c.args === "string" ? {} : c.args);
const statusIn = (c: Call): unknown[] => (at(queryArgs(c).where, "status", "in") as unknown[] | undefined) ?? [];

const READ_METHODS = new Set(["findMany", "findFirst", "count", "aggregate"]);
const dec = (s: string) => new Prisma.Decimal(s);

/**
 * A fake transaction client. Any property other than a known READ method throws, so a write (create/update/delete/upsert) or an
 * unexpected raw query would fail the test. Rows are served with real keyset semantics (orderBy id asc, cursor, skip, take) and
 * the `where` is NOT evaluated — the filters are asserted on the recorded arguments instead.
 */
function fakeClient(data: { rows?: Record<string, Row[]>; payoutLinks?: Row[]; capturedPayments?: Row[]; aggregates?: Record<string, Date | null>; run?: Row | null; counts?: Record<string, number> } = {}) {
  const calls: Call[] = [];
  const raw: string[] = [];
  let txOptions: unknown;

  const serve = (rows: Row[], args: QueryArgs) => {
    const sorted = [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id)));
    let start = 0;
    const cursorId = args.cursor?.id;
    if (cursorId !== undefined) start = sorted.findIndex((r) => r.id === cursorId) + (args.skip ?? 0);
    return sorted.slice(start, start + (args.take ?? sorted.length));
  };

  const handle = (model: string, method: string, args: QueryArgs): unknown => {
    if (method === "aggregate") {
      const date = data.aggregates?.[model] ?? null;
      return { _max: { updatedAt: date, createdAt: data.aggregates?.[`${model}.createdAt`] ?? null } };
    }
    if (method === "count") return data.counts?.[`${model}:${JSON.stringify(args.where)}`] ?? data.counts?.[model] ?? 0;
    if (method === "findFirst") return data.run ?? null;
    if (model === "payout" && args.select && "paymentId" in args.select) return data.payoutLinks ?? [];
    if (model === "payment" && ((at(args.where, "status", "in") as unknown[] | undefined) ?? []).includes("CAPTURED")) return serve(data.capturedPayments ?? [], args);
    return serve(data.rows?.[model] ?? [], args);
  };

  const tx = new Proxy(
    {},
    {
      get(_t, name: string) {
        if (name === "$executeRawUnsafe") {
          return async (sql: string) => {
            raw.push(sql);
            calls.push({ model: "$raw", method: "$executeRawUnsafe", args: sql });
            return 0;
          };
        }
        return new Proxy(
          {},
          {
            get(_m, method: string) {
              if (!READ_METHODS.has(method)) throw new Error(`forbidden call on the read-only reader: ${name}.${method}`);
              return async (args: QueryArgs) => {
                calls.push({ model: name, method, args });
                return handle(name, method, args);
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
  return { client: client as never, calls, raw, options: () => txOptions, transaction: client.$transaction };
}

const FORBIDDEN_FIELDS = ["notes", "description", "title", "recipientLegalName", "recipientTaxId", "issuerLegalName", "issuerTaxId", "reason", "cancellationNote", "failureReason", "email", "customer", "address", "photos"];

describe("PrismaLegacyWindDownReader — read-only by construction", () => {
  it("opens ONE READ ONLY / REPEATABLE READ transaction and sets READ ONLY before the first query", async () => {
    const f = fakeClient();
    await new PrismaLegacyWindDownReader({ client: f.client }).readSnapshot();

    expect(f.transaction).toHaveBeenCalledTimes(1);
    expect(f.raw).toEqual(["SET TRANSACTION READ ONLY"]);
    expect(f.calls[0]).toMatchObject({ model: "$raw", method: "$executeRawUnsafe", args: "SET TRANSACTION READ ONLY" });
    expect(f.options()).toMatchObject({ isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    expect(new Set(f.calls.filter((c) => c.model !== "$raw").map((c) => c.method))).toEqual(new Set(["findMany", "findFirst", "count", "aggregate"]));
  });

  it("any write method on the transaction client would fail the run (the fake throws on it)", async () => {
    const f = fakeClient();
    const tx = await (f.client as { $transaction: (fn: (t: unknown) => Promise<unknown>, o: unknown) => Promise<unknown> }).$transaction(async (t) => t, {});
    const models = tx as Record<string, Record<string, unknown>>;
    expect(() => models.quote!.update).toThrow(/forbidden/);
    expect(() => models.payment!.create).toThrow(/forbidden/);
    expect(() => models.payout!.deleteMany).toThrow(/forbidden/);
  });

  it("every relation-bearing query is restricted to LEGACY_QUOTE_PAYMENT and never mentions LEAD_V1", async () => {
    const f = fakeClient();
    await new PrismaLegacyWindDownReader({ client: f.client }).readSnapshot();

    const scoped = ["serviceRequest", "quote", "job", "jobCompletionConfirmation", "payment", "refund", "financialAdjustment", "disputeResolutionDecision", "dispute", "invoice", "creditNote"];
    for (const model of scoped) {
      const qs = f.calls.filter((c) => c.model === model && queryArgs(c).where);
      expect(qs.length, model).toBeGreaterThan(0);
      for (const q of qs) expect(JSON.stringify(queryArgs(q).where), `${model}.${q.method}`).toContain("LEGACY_QUOTE_PAYMENT");
    }
    expect(JSON.stringify(f.calls)).not.toContain("LEAD_V1");
  });

  it("filters each kind in the database to its NON-FINAL statuses (the same constants the rules use)", async () => {
    const f = fakeClient();
    await new PrismaLegacyWindDownReader({ client: f.client }).readSnapshot();

    expect(statusIn(f.calls.find((c) => c.model === "quote")!)).toEqual([...LEGACY_OPEN_QUOTE_STATUSES]);
    expect(statusIn(f.calls.find((c) => c.model === "payment" && statusIn(c).includes("PENDING"))!)).toEqual([...LEGACY_UNCONFIRMED_PAYMENT_STATUSES]);
    expect(statusIn(f.calls.find((c) => c.model === "payment" && statusIn(c).includes("CAPTURED"))!)).toEqual([...LEGACY_CAPTURED_PAYMENT_STATUSES]);
    expect(at(queryArgs(f.calls.find((c) => c.model === "dispute")!).where, "status")).toEqual({ not: "CLOSED" });
    const provider = at(queryArgs(f.calls.find((c) => c.model === "externalWebhookEvent")!).where, "provider");
    expect(provider).toBe(LEGACY_PAYMENT_WEBHOOK_PROVIDER);
    expect(String(provider)).not.toMatch(/LEAD_FEE/);
  });

  it("never selects party data, free text, contact details or relations to people", async () => {
    const f = fakeClient();
    await new PrismaLegacyWindDownReader({ client: f.client }).readSnapshot();
    const selects = f.calls.map((c) => queryArgs(c).select).filter((s): s is Dict => s !== undefined);
    expect(selects.length).toBeGreaterThan(10);
    const keys = new Set<string>();
    const collect = (o: unknown) => {
      if (o && typeof o === "object") {
        for (const [k, v] of Object.entries(o)) {
          keys.add(k);
          collect(v);
        }
      }
    };
    selects.forEach(collect);
    for (const forbidden of FORBIDDEN_FIELDS) expect(keys.has(forbidden), forbidden).toBe(false);
    expect(f.calls.some((c) => "include" in queryArgs(c))).toBe(false);
  });
});

describe("PrismaLegacyWindDownReader — snapshot content", () => {
  it("maps rows to exact 2-decimal strings and carries ids/statuses unchanged", async () => {
    const f = fakeClient({
      rows: {
        quote: [{ id: "q1", status: "SENT", validUntil: new Date("2026-11-01T00:00:00Z") }],
        payout: [{ id: "po1", status: "PAID", amount: dec("12.5"), currency: "EUR", jobId: "j1", reversalFailureReason: "stripe error" }],
        refund: [{ id: "rf1", status: "REQUESTED", amount: dec("3"), paymentId: "p9", payment: { currency: "GBP" } }],
        stripeDispute: [{ id: "sd1", status: "LOST", amount: dec("40.10"), currency: "EUR", financialAdjustmentId: null }],
        affiliateCommission: [{ id: "ac1", status: "PENDING", affiliateAmount: dec("1.2") }],
      },
    });
    const s = await new PrismaLegacyWindDownReader({ client: f.client }).readSnapshot();
    expect(s.quotes).toEqual([{ id: "q1", status: "SENT", validUntil: new Date("2026-11-01T00:00:00Z") }]);
    expect(s.payouts).toEqual([{ id: "po1", status: "PAID", amount: "12.50", currency: "EUR", jobId: "j1", reversalIncomplete: true }]);
    expect(s.refunds).toEqual([{ id: "rf1", status: "REQUESTED", amount: "3.00", currency: "GBP", paymentId: "p9" }]);
    expect(s.stripeDisputes).toEqual([{ id: "sd1", status: "LOST", amount: "40.10", currency: "EUR", financialAdjustmentId: null }]);
    expect(s.affiliateCommissions).toEqual([{ id: "ac1", status: "PENDING", affiliateAmount: "1.20" }]);
  });

  it("joins captured payments to their job, release and payouts (by payment id OR job id)", async () => {
    const f = fakeClient({
      capturedPayments: [
        { id: "p1", status: "CAPTURED", amount: dec("100"), currency: "EUR", quote: { job: { id: "j1", status: "COMPLETED", completionConfirmation: { releaseStatus: "RELEASE_APPROVED" } } } },
        { id: "p2", status: "PARTIALLY_REFUNDED", amount: dec("50"), currency: "EUR", quote: null },
      ],
      payoutLinks: [
        { paymentId: "p1", jobId: null, status: "PAID" },
        { paymentId: null, jobId: "j1", status: "PAID" },
      ],
    });
    const s = await new PrismaLegacyWindDownReader({ client: f.client }).readSnapshot();
    expect(s.capturedPayments).toEqual([
      { id: "p1", status: "CAPTURED", amount: "100.00", currency: "EUR", jobStatus: "COMPLETED", releaseStatus: "RELEASE_APPROVED", payoutStatuses: ["PAID"] },
      { id: "p2", status: "PARTIALLY_REFUNDED", amount: "50.00", currency: "EUR", jobStatus: null, releaseStatus: null, payoutStatuses: [] },
    ]);
  });

  it("derives the latest legacy financial change as the max of the aggregates, and null when there is none", async () => {
    const some = fakeClient({ aggregates: { payment: new Date("2026-09-01T00:00:00Z"), payout: new Date("2026-10-03T00:00:00Z"), invoice: new Date("2026-08-01T00:00:00Z") } });
    expect((await new PrismaLegacyWindDownReader({ client: some.client }).readSnapshot()).latestLegacyFinancialChangeAt).toEqual(new Date("2026-10-03T00:00:00Z"));
    const none = fakeClient();
    expect((await new PrismaLegacyWindDownReader({ client: none.client }).readSnapshot()).latestLegacyFinancialChangeAt).toBeNull();
  });

  it("reads the existing reconciliation state: OPEN discrepancies per severity, the latest COMPLETED FULL run and RUNNING runs", async () => {
    const f = fakeClient({
      run: { id: "run-9", startedAt: new Date("2026-10-10T00:00:00Z"), completedAt: new Date("2026-10-10T00:10:00Z"), discrepancyCount: 2, recordsInspected: 480 },
      counts: { reconciliationRun: 1 },
    });
    const s = await new PrismaLegacyWindDownReader({ client: f.client }).readSnapshot();
    expect(s.reconciliation.latestCompletedFullRun).toEqual({ id: "run-9", startedAt: new Date("2026-10-10T00:00:00Z"), completedAt: new Date("2026-10-10T00:10:00Z"), discrepancyCount: 2, recordsInspected: 480 });
    expect(s.reconciliation.runningRunCount).toBe(1);
    const runQuery = f.calls.find((c) => c.model === "reconciliationRun" && c.method === "findFirst")!;
    expect(queryArgs(runQuery).where).toEqual({ scope: "FULL", status: "COMPLETED" });
    const discQueries = f.calls.filter((c) => c.model === "reconciliationDiscrepancy");
    expect(discQueries.map((c) => at(queryArgs(c).where, "severity")).sort()).toEqual(["CRITICAL", "ERROR", "INFO", "WARNING"]);
    expect(discQueries.every((c) => at(queryArgs(c).where, "resolutionStatus") === "OPEN")).toBe(true);
  });

  it("no completed FULL run -> null (never a fabricated run)", async () => {
    const s = await new PrismaLegacyWindDownReader({ client: fakeClient().client }).readSnapshot();
    expect(s.reconciliation.latestCompletedFullRun).toBeNull();
  });
});

describe("PrismaLegacyWindDownReader — paging, limits and failure", () => {
  const quotes = ["q1", "q2", "q3", "q4", "q5"].map((id) => ({ id, status: "SENT", validUntil: null }));

  it("returns the same complete snapshot for page sizes 1, 2 and the default", async () => {
    const results = [] as unknown[];
    for (const pageSize of [1, 2, undefined]) {
      const f = fakeClient({ rows: { quote: quotes } });
      results.push((await new PrismaLegacyWindDownReader({ client: f.client, ...(pageSize ? { pageSize } : {}) }).readSnapshot()).quotes);
    }
    expect((results[0] as unknown[]).length).toBe(5);
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
  });

  it("every paged query is ordered by the primary key (deterministic keyset paging)", async () => {
    const f = fakeClient({ rows: { quote: quotes } });
    await new PrismaLegacyWindDownReader({ client: f.client, pageSize: 2 }).readSnapshot();
    const paged = f.calls.filter((c) => c.method === "findMany" && queryArgs(c).take);
    expect(paged.length).toBeGreaterThan(5);
    for (const c of paged) expect(queryArgs(c).orderBy).toEqual({ id: "asc" });
  });

  it("refuses to report a partial inventory: a kind above the ceiling throws LegacyWindDownScopeTooLargeError", async () => {
    const f = fakeClient({ rows: { quote: quotes } });
    await expect(new PrismaLegacyWindDownReader({ client: f.client, maxRowsPerKind: 3, pageSize: 2 }).readSnapshot()).rejects.toBeInstanceOf(LegacyWindDownScopeTooLargeError);
  });

  it("FAILS CLOSED: a database error propagates and no snapshot is returned", async () => {
    const boom = new Error("connection lost");
    const client = { $transaction: vi.fn().mockRejectedValue(boom) } as never;
    await expect(new PrismaLegacyWindDownReader({ client }).readSnapshot()).rejects.toBe(boom);
  });

  it("rejects an invalid configuration", () => {
    expect(() => new PrismaLegacyWindDownReader({ pageSize: 0, client: fakeClient().client })).toThrow(RangeError);
    expect(() => new PrismaLegacyWindDownReader({ pageSize: 10_001, client: fakeClient().client })).toThrow(RangeError);
    expect(() => new PrismaLegacyWindDownReader({ maxRowsPerKind: 0, client: fakeClient().client })).toThrow(RangeError);
  });
});
