import { describe, expect, it } from "vitest";

import { NON_TERMINAL_STATUSES as DISPUTE_NON_TERMINAL } from "@/domain/services/dispute-state";
import { NON_TERMINAL_STATUSES as JOB_NON_TERMINAL } from "@/domain/services/job-state";
import {
  LEGACY_OPEN_DISPUTE_STATUSES,
  LEGACY_OPEN_JOB_STATUSES,
  LEGACY_WIND_DOWN_CATALOG,
  LEGACY_WIND_DOWN_EXTERNAL_CONFIRMATIONS,
  LEGACY_WIND_DOWN_MAX_IDS_PER_ITEM,
  evaluateLegacyWindDown,
  hasFinalDisposition,
  isCapturedPaymentInFlight,
  type LegacyWindDownFindingCode,
  type LegacyWindDownSnapshot,
  type ObservedLegacyCapturedPayment,
} from "@/domain/services/legacy-wind-down";

const D = (s: string) => new Date(s);

function clean(): LegacyWindDownSnapshot {
  return {
    serviceRequests: [],
    quotes: [],
    jobs: [],
    completionConfirmations: [],
    unconfirmedPayments: [],
    capturedPayments: [],
    payouts: [],
    refunds: [],
    financialAdjustments: [],
    disputeResolutionDecisions: [],
    disputes: [],
    stripeDisputes: [],
    invoices: [],
    creditNotes: [],
    affiliateCommissions: [],
    webhookEvents: [],
    reconciliation: {
      openDiscrepancies: { INFO: 0, WARNING: 0, ERROR: 0, CRITICAL: 0 },
      latestCompletedFullRun: { id: "run-1", startedAt: D("2026-10-01T00:00:00Z"), completedAt: D("2026-10-01T00:05:00Z"), discrepancyCount: 0, recordsInspected: 42 },
      runningRunCount: 0,
    },
    latestLegacyFinancialChangeAt: D("2026-09-30T00:00:00Z"),
    legacyRequestTotal: 3,
    newestLegacyRequestCreatedAt: D("2026-09-01T00:00:00Z"),
  };
}

const codes = (s: LegacyWindDownSnapshot) => evaluateLegacyWindDown(s).items.map((i) => i.code);
const item = (s: LegacyWindDownSnapshot, code: LegacyWindDownFindingCode) => evaluateLegacyWindDown(s).items.find((i) => i.code === code);

const captured = (over: Partial<ObservedLegacyCapturedPayment> = {}): ObservedLegacyCapturedPayment => ({
  id: "pay-1",
  status: "CAPTURED",
  amount: "100.00",
  currency: "EUR",
  jobStatus: "COMPLETED",
  releaseStatus: "RELEASE_APPROVED",
  payoutStatuses: [],
  ...over,
});

describe("M166 — readiness can never be 'ready' from data alone", () => {
  it("a fully clean snapshot is DATA_CLEAN_PENDING_SIGN_OFF, never READY, and every external confirmation stays unverified", () => {
    const e = evaluateLegacyWindDown(clean());
    expect(e.items).toEqual([]);
    expect(e.readiness.dataClean).toBe(true);
    expect(e.readiness.decision).toBe("DATA_CLEAN_PENDING_SIGN_OFF");
    expect(e.readiness.blockingCodes).toEqual([]);
    expect(e.readiness.externalConfirmations.map((c) => c.id)).toEqual(LEGACY_WIND_DOWN_EXTERNAL_CONFIRMATIONS.map((c) => c.id));
    expect(e.readiness.externalConfirmations.every((c) => c.status === "NOT_VERIFIABLE_FROM_REPOSITORY")).toBe(true);
    expect(JSON.stringify(e)).not.toMatch(/"decision":"READY"/);
  });

  it("names D20, the disputed/unpaid handling, the notice period, Gate B, the zero-new-requests period, the webhook grace window and the accountant sign-off", () => {
    const ids = LEGACY_WIND_DOWN_EXTERNAL_CONFIRMATIONS.map((c) => c.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "D20_RETENTION_AND_WIND_DOWN_HANDLING",
        "DISPUTED_OR_UNPAID_LEGACY_ITEMS_HANDLING",
        "CUSTOMER_PROFESSIONAL_NOTICE_PERIOD",
        "GATE_B_PASSED",
        "ZERO_NEW_LEGACY_REQUESTS_PERIOD",
        "LATE_DISPUTE_GRACE_WINDOW",
        "ACCOUNTANT_SIGN_OFF",
      ]),
    );
  });

  it("invents no period, deadline or retention number in any catalog text", () => {
    for (const [code, entry] of Object.entries(LEGACY_WIND_DOWN_CATALOG)) {
      expect(entry.nextAction, code).not.toMatch(/\b\d+\s*(day|days|week|weeks|month|months|year|years|hour|hours)\b/i);
    }
    for (const c of LEGACY_WIND_DOWN_EXTERNAL_CONFIRMATIONS) expect(c.description).not.toMatch(/\b\d+\s*(day|days|week|weeks|month|months|year|years)\b/i);
  });

  it("any single blocking finding makes the decision NOT_READY", () => {
    const s = clean();
    s.quotes = [{ id: "q1", status: "SENT", validUntil: null }];
    const e = evaluateLegacyWindDown(s);
    expect(e.readiness.decision).toBe("NOT_READY");
    expect(e.readiness.dataClean).toBe(false);
    expect(e.readiness.blockingCodes).toEqual(["LEGACY_QUOTE_OPEN"]);
  });
});

describe("M166 — status vocabulary comes from the repository's own state machines", () => {
  it("the open job statuses equal job-state NON_TERMINAL_STATUSES", () => {
    expect([...LEGACY_OPEN_JOB_STATUSES].sort()).toEqual([...JOB_NON_TERMINAL].sort());
  });
  it("the open dispute statuses equal dispute-state NON_TERMINAL_STATUSES (RESOLVED and REJECTED are NOT terminal; only CLOSED is)", () => {
    expect([...LEGACY_OPEN_DISPUTE_STATUSES].sort()).toEqual([...DISPUTE_NON_TERMINAL].sort());
  });

  it("counts every open status of each object kind and ignores final ones (defence in depth)", () => {
    const s = clean();
    s.serviceRequests = [
      { id: "r1", status: "DRAFT", createdAt: D("2026-01-01") },
      { id: "r2", status: "PUBLISHED", createdAt: D("2026-01-01") },
      { id: "r3", status: "QUOTED", createdAt: D("2026-01-01") },
      // ACCEPTED is a resting state governed by its Job; the rest are final.
      { id: "r4", status: "ACCEPTED", createdAt: D("2026-01-01") },
      { id: "r5", status: "COMPLETED", createdAt: D("2026-01-01") },
      { id: "r6", status: "IN_PROGRESS", createdAt: D("2026-01-01") },
      { id: "r7", status: "CANCELLED", createdAt: D("2026-01-01") },
      { id: "r8", status: "EXPIRED", createdAt: D("2026-01-01") },
    ];
    expect(item(s, "LEGACY_REQUEST_OPEN")?.byStatus).toEqual({ DRAFT: 1, PUBLISHED: 1, QUOTED: 1 });

    const q = clean();
    q.quotes = ["PENDING", "SENT", "VIEWED", "ACCEPTED", "REJECTED", "EXPIRED", "WITHDRAWN"].map((status, i) => ({ id: `q${i}`, status, validUntil: null }));
    expect(item(q, "LEGACY_QUOTE_OPEN")?.byStatus).toEqual({ PENDING: 1, SENT: 1, VIEWED: 1 });

    const j = clean();
    j.jobs = ["CREATED", "IN_PROGRESS", "COMPLETED", "CANCELLED"].map((status, i) => ({ id: `j${i}`, status }));
    expect(item(j, "LEGACY_JOB_NON_TERMINAL")?.byStatus).toEqual({ CREATED: 1, IN_PROGRESS: 1 });

    const d = clean();
    d.disputes = ["OPEN", "UNDER_REVIEW", "WAITING_FOR_CUSTOMER", "WAITING_FOR_PROFESSIONAL", "RESOLVED", "REJECTED", "CLOSED"].map((status, i) => ({ id: `d${i}`, status }));
    expect(item(d, "LEGACY_DISPUTE_NOT_CLOSED")?.count).toBe(6);
    expect(item(d, "LEGACY_DISPUTE_NOT_CLOSED")?.byStatus.CLOSED).toBeUndefined();

    const p = clean();
    p.unconfirmedPayments = ["PENDING", "AUTHORIZED", "CAPTURED", "FAILED", "CANCELLED", "REFUNDED"].map((status, i) => ({ id: `p${i}`, status, amount: "1.00", currency: "EUR" }));
    expect(item(p, "LEGACY_PAYMENT_UNCONFIRMED")?.byStatus).toEqual({ AUTHORIZED: 1, PENDING: 1 });

    const po = clean();
    po.payouts = ["PENDING", "IN_TRANSIT", "FAILED", "PAID", "CANCELLED", "REVERSED"].map((status, i) => ({ id: `po${i}`, status, amount: "1.00", currency: "EUR", jobId: null, reversalIncomplete: false }));
    expect(item(po, "LEGACY_PAYOUT_NOT_FINAL")?.byStatus).toEqual({ FAILED: 1, IN_TRANSIT: 1, PENDING: 1 });

    const r = clean();
    r.refunds = ["REQUESTED", "APPROVED", "FAILED", "PROCESSED", "REJECTED"].map((status, i) => ({ id: `rf${i}`, status, amount: "1.00", currency: "EUR", paymentId: "x" }));
    expect(item(r, "LEGACY_REFUND_NOT_FINAL")?.byStatus).toEqual({ APPROVED: 1, FAILED: 1, REQUESTED: 1 });
  });

  it("a completion confirmation is open when unconfirmed OR when its release is still PENDING/RELEASE_HELD", () => {
    const s = clean();
    s.completionConfirmations = [
      { id: "c1", jobId: "j", status: "WAITING_FOR_CUSTOMER", releaseStatus: "PENDING" },
      { id: "c2", jobId: "j", status: "CONFIRMED", releaseStatus: "RELEASE_HELD" },
      { id: "c3", jobId: "j", status: "TIMED_OUT_UNDER_REVIEW", releaseStatus: "RELEASE_APPROVED" },
      { id: "c4", jobId: "j", status: "CONFIRMED", releaseStatus: "RELEASE_APPROVED" },
      { id: "c5", jobId: "j", status: "CONFIRMED", releaseStatus: "RELEASE_DENIED" },
    ];
    expect(item(s, "LEGACY_COMPLETION_CONFIRMATION_OPEN")?.ids).toEqual(["c1", "c2", "c3"]);
  });

  it("invoices: a self-billed invoice is final only at PAID/CANCELLED (ISSUED is open); a customer receipt is open only while DRAFT", () => {
    const s = clean();
    const mk = (id: string, type: string, status: string) => ({ id, type, status, totalAmount: "10.00", currency: "EUR" });
    s.invoices = [
      mk("a", "PROFESSIONAL_SELF_BILLED", "DRAFT"),
      mk("b", "PROFESSIONAL_SELF_BILLED", "PENDING_ACCEPTANCE"),
      mk("c", "PROFESSIONAL_SELF_BILLED", "ACCEPTED"),
      mk("d", "PROFESSIONAL_SELF_BILLED", "ISSUED"),
      mk("e", "PROFESSIONAL_SELF_BILLED", "PAID"),
      mk("f", "PROFESSIONAL_SELF_BILLED", "CANCELLED"),
      mk("g", "CUSTOMER_RECEIPT", "DRAFT"),
      mk("h", "CUSTOMER_RECEIPT", "ISSUED"),
      mk("i", "SOMETHING_NEW", "DRAFT"),
    ];
    expect(item(s, "LEGACY_INVOICE_NOT_FINAL")?.ids).toEqual(["a", "b", "c", "d", "g"]);
  });

  it("credit notes: only DRAFT is open; affiliate commissions: only PENDING/APPROVED; webhook events: PROCESSING/FAILED", () => {
    const s = clean();
    s.creditNotes = ["DRAFT", "ISSUED", "CANCELLED"].map((status, i) => ({ id: `cn${i}`, status, totalAmount: "5.00", currency: "EUR" }));
    s.affiliateCommissions = ["PENDING", "APPROVED", "PAID", "CANCELLED", "EXPIRED", "REVERSED"].map((status, i) => ({ id: `ac${i}`, status, affiliateAmount: "2.00" }));
    s.webhookEvents = ["PROCESSING", "FAILED", "PROCESSED"].map((status, i) => ({ id: `w${i}`, status }));
    expect(item(s, "LEGACY_CREDIT_NOTE_NOT_FINAL")?.count).toBe(1);
    expect(item(s, "LEGACY_AFFILIATE_COMMISSION_OPEN")?.byStatus).toEqual({ APPROVED: 1, PENDING: 1 });
    expect(item(s, "LEGACY_WEBHOOK_EVENT_UNSETTLED")?.byStatus).toEqual({ FAILED: 1, PROCESSING: 1 });
  });
});

describe("M166 — captured payments need a final disposition", () => {
  it("a PAID payout is a final disposition", () => {
    const p = captured({ payoutStatuses: ["PAID"] });
    expect(hasFinalDisposition(p)).toBe(true);
    const s = clean();
    s.capturedPayments = [p];
    expect(codes(s)).toEqual([]);
  });

  it("in-flight captured payments are covered by their own findings, not flagged here", () => {
    for (const p of [
      captured({ jobStatus: "IN_PROGRESS", releaseStatus: null }),
      captured({ jobStatus: "COMPLETED", releaseStatus: "PENDING" }),
      captured({ jobStatus: "COMPLETED", releaseStatus: "RELEASE_HELD" }),
      captured({ payoutStatuses: ["FAILED"] }),
      captured({ payoutStatuses: ["PENDING"] }),
    ]) {
      expect(isCapturedPaymentInFlight(p)).toBe(true);
      const s = clean();
      s.capturedPayments = [p];
      expect(codes(s)).not.toContain("LEGACY_CAPTURED_PAYMENT_WITHOUT_FINAL_DISPOSITION");
    }
  });

  it("captured funds with no PAID payout and nothing in flight are flagged for human review (CRITICAL)", () => {
    for (const p of [
      captured({ releaseStatus: "RELEASE_APPROVED", payoutStatuses: [] }), // approved but no payout exists
      captured({ releaseStatus: "RELEASE_DENIED", payoutStatuses: [] }), // denied but still captured (needs refund)
      captured({ jobStatus: null, releaseStatus: null }), // no job at all
      captured({ jobStatus: "CANCELLED", releaseStatus: null }),
      captured({ status: "PARTIALLY_REFUNDED", payoutStatuses: ["REVERSED"] }),
    ]) {
      const s = clean();
      s.capturedPayments = [p];
      const f = item(s, "LEGACY_CAPTURED_PAYMENT_WITHOUT_FINAL_DISPOSITION");
      expect(f, JSON.stringify(p)).toBeDefined();
      expect(f?.severity).toBe("CRITICAL");
      expect(f?.verification).toBe("HUMAN_REVIEW_REQUIRED");
    }
  });

  it("REFUNDED/FAILED/CANCELLED payments are final and never appear", () => {
    const s = clean();
    s.capturedPayments = [captured({ status: "REFUNDED", jobStatus: null, releaseStatus: null }), captured({ id: "p2", status: "FAILED", jobStatus: null, releaseStatus: null })];
    expect(codes(s)).toEqual([]);
  });
});

describe("M166 — chargebacks and payout reversals", () => {
  it("open provider disputes and lost disputes WITHOUT a recorded adjustment are CRITICAL; a recorded adjustment, WON and WARNING_CLOSED are not findings", () => {
    const s = clean();
    const sd = (id: string, status: string, financialAdjustmentId: string | null) => ({ id, status, amount: "30.00", currency: "EUR", financialAdjustmentId });
    s.stripeDisputes = [sd("d1", "NEEDS_RESPONSE", null), sd("d2", "UNDER_REVIEW", null), sd("d3", "LOST", null), sd("d4", "LOST", "adj-1"), sd("d5", "WON", null), sd("d6", "WARNING_CLOSED", null)];
    expect(item(s, "LEGACY_STRIPE_DISPUTE_OPEN")?.ids).toEqual(["d1", "d2"]);
    expect(item(s, "LEGACY_STRIPE_DISPUTE_OPEN")?.severity).toBe("CRITICAL");
    const lost = item(s, "LEGACY_STRIPE_DISPUTE_LOST_WITHOUT_ADJUSTMENT");
    expect(lost?.ids).toEqual(["d3"]);
    expect(lost?.severity).toBe("CRITICAL");
    expect(lost?.verification).toBe("HUMAN_REVIEW_REQUIRED");
  });

  it("an incomplete payout reversal is flagged even when the payout is PAID; a REVERSED payout never is", () => {
    const s = clean();
    s.payouts = [
      { id: "a", status: "PAID", amount: "9.00", currency: "EUR", jobId: "j", reversalIncomplete: true },
      { id: "b", status: "REVERSED", amount: "9.00", currency: "EUR", jobId: "j", reversalIncomplete: true },
    ];
    expect(item(s, "LEGACY_PAYOUT_REVERSAL_INCOMPLETE")?.ids).toEqual(["a"]);
  });
});

describe("M166 — reconciliation state (read from the existing framework)", () => {
  it("no COMPLETED FULL run is a blocker", () => {
    const s = clean();
    s.reconciliation.latestCompletedFullRun = null;
    expect(codes(s)).toEqual(["LEGACY_FINAL_RECONCILIATION_MISSING"]);
  });

  it("a FULL run older than the latest legacy financial change is stale; one that started at/after it is not", () => {
    const stale = clean();
    stale.latestLegacyFinancialChangeAt = D("2026-10-02T00:00:00Z");
    expect(item(stale, "LEGACY_FINAL_RECONCILIATION_STALE")?.ids).toEqual(["run-1"]);

    const equal = clean();
    equal.latestLegacyFinancialChangeAt = D("2026-10-01T00:00:00Z");
    expect(codes(equal)).toEqual([]);

    const none = clean();
    none.latestLegacyFinancialChangeAt = null;
    expect(codes(none)).toEqual([]);
  });

  it("a RUNNING run and OPEN discrepancies (any severity) block, with exact counts by severity", () => {
    const s = clean();
    s.reconciliation.runningRunCount = 2;
    s.reconciliation.openDiscrepancies = { INFO: 3, WARNING: 0, ERROR: 1, CRITICAL: 0 };
    expect(item(s, "LEGACY_RECONCILIATION_RUN_IN_PROGRESS")?.count).toBe(2);
    const d = item(s, "LEGACY_RECONCILIATION_DISCREPANCIES_OPEN");
    expect(d?.count).toBe(4);
    expect(d?.byStatus).toEqual({ INFO: 3, ERROR: 1 });
    expect(d?.ids).toEqual([]);
  });
});

describe("M166 — money is exact, per currency, never netted and never invented", () => {
  it("sums with fixed-point arithmetic, grouped by currency", () => {
    const s = clean();
    s.unconfirmedPayments = [
      { id: "a", status: "PENDING", amount: "0.10", currency: "EUR" },
      { id: "b", status: "PENDING", amount: "0.20", currency: "EUR" },
      { id: "c", status: "AUTHORIZED", amount: "5.00", currency: "USD" },
    ];
    expect(item(s, "LEGACY_PAYMENT_UNCONFIRMED")?.amountByCurrency).toEqual({ EUR: "0.30", USD: "5.00" });
  });

  it("an unparseable amount is excluded from totals, reported as LEGACY_AMOUNT_UNPARSEABLE and keeps the data not clean", () => {
    const s = clean();
    s.payouts = [
      { id: "a", status: "FAILED", amount: "1.005", currency: "EUR", jobId: null, reversalIncomplete: false },
      { id: "b", status: "FAILED", amount: "2.50", currency: "EUR", jobId: null, reversalIncomplete: false },
    ];
    expect(item(s, "LEGACY_PAYOUT_NOT_FINAL")?.amountByCurrency).toEqual({ EUR: "2.50" });
    expect(item(s, "LEGACY_AMOUNT_UNPARSEABLE")?.ids).toEqual(["a"]);
    expect(evaluateLegacyWindDown(s).readiness.dataClean).toBe(false);
  });

  it("different items are never added together (no net figure exists)", () => {
    const s = clean();
    s.payouts = [{ id: "a", status: "FAILED", amount: "10.00", currency: "EUR", jobId: null, reversalIncomplete: false }];
    s.refunds = [{ id: "r", status: "REQUESTED", amount: "10.00", currency: "EUR", paymentId: "p" }];
    const e = evaluateLegacyWindDown(s);
    expect(Object.keys(e)).toEqual(["items", "readiness", "context"]);
    for (const i of e.items) {
      expect(Object.keys(i).sort()).toEqual(["amountByCurrency", "blocksGateC", "byStatus", "category", "code", "count", "ids", "idsTruncated", "nextAction", "severity", "verification"]);
    }
    expect(e.items.map((i) => i.amountByCurrency)).toEqual([{ EUR: "10.00" }, { EUR: "10.00" }]);
  });

  it("an affiliate commission total is reported under an explicit no-currency marker, never assumed EUR", () => {
    const s = clean();
    s.affiliateCommissions = [{ id: "a", status: "PENDING", affiliateAmount: "4.20" }];
    expect(item(s, "LEGACY_AFFILIATE_COMMISSION_OPEN")?.amountByCurrency).toEqual({ NO_CURRENCY_ON_RECORD: "4.20" });
  });

  it("a refund is reported in the currency of its payment", () => {
    const s = clean();
    s.refunds = [{ id: "r", status: "APPROVED", amount: "7.50", currency: "GBP", paymentId: "p" }];
    expect(item(s, "LEGACY_REFUND_NOT_FINAL")?.amountByCurrency).toEqual({ GBP: "7.50" });
  });
});

describe("M166 — determinism and bounded output", () => {
  it("count is exact; ids are sorted and capped", () => {
    const s = clean();
    s.quotes = Array.from({ length: 120 }, (_, i) => ({ id: `q-${String(120 - i).padStart(3, "0")}`, status: "SENT", validUntil: null }));
    const f = item(s, "LEGACY_QUOTE_OPEN")!;
    expect(f.count).toBe(120);
    expect(f.ids).toHaveLength(LEGACY_WIND_DOWN_MAX_IDS_PER_ITEM);
    expect(f.idsTruncated).toBe(true);
    expect(f.ids).toEqual([...f.ids].sort());
    expect(f.ids[0]).toBe("q-001");
  });

  it("the same data in any input order yields the identical evaluation", () => {
    const a = clean();
    a.quotes = [
      { id: "q2", status: "SENT", validUntil: null },
      { id: "q1", status: "PENDING", validUntil: null },
    ];
    a.payouts = [
      { id: "p2", status: "FAILED", amount: "2.00", currency: "EUR", jobId: null, reversalIncomplete: false },
      { id: "p1", status: "PENDING", amount: "1.00", currency: "EUR", jobId: null, reversalIncomplete: false },
    ];
    const b = clean();
    b.quotes = [...a.quotes].reverse();
    b.payouts = [...a.payouts].reverse();
    expect(evaluateLegacyWindDown(b)).toEqual(evaluateLegacyWindDown(a));
  });

  it("findings are ordered by severity then code", () => {
    const s = clean();
    s.quotes = [{ id: "q", status: "SENT", validUntil: null }]; // WARNING
    s.stripeDisputes = [{ id: "d", status: "NEEDS_RESPONSE", amount: "1.00", currency: "EUR", financialAdjustmentId: null }]; // CRITICAL
    s.payouts = [{ id: "p", status: "FAILED", amount: "1.00", currency: "EUR", jobId: null, reversalIncomplete: false }]; // ERROR
    expect(codes(s)).toEqual(["LEGACY_STRIPE_DISPUTE_OPEN", "LEGACY_PAYOUT_NOT_FINAL", "LEGACY_QUOTE_OPEN"]);
  });

  it("never mutates its input", () => {
    const s = clean();
    s.quotes = [{ id: "q", status: "SENT", validUntil: null }];
    const frozen = Object.freeze({ ...s, quotes: Object.freeze([...s.quotes]) }) as LegacyWindDownSnapshot;
    expect(() => evaluateLegacyWindDown(frozen)).not.toThrow();
  });

  it("carries context facts without judging them (no period is applied)", () => {
    const e = evaluateLegacyWindDown(clean());
    expect(e.context).toEqual({
      legacyRequestTotal: 3,
      newestLegacyRequestCreatedAt: D("2026-09-01T00:00:00Z"),
      latestLegacyFinancialChangeAt: D("2026-09-30T00:00:00Z"),
      latestCompletedFullRun: { id: "run-1", startedAt: D("2026-10-01T00:00:00Z"), completedAt: D("2026-10-01T00:05:00Z"), discrepancyCount: 0, recordsInspected: 42 },
    });
  });

  it("lists reconciliation coverage as a human confirmation: a bounded FULL run is not proof that every legacy job was inspected", () => {
    const c = LEGACY_WIND_DOWN_EXTERNAL_CONFIRMATIONS.find((x) => x.id === "RECONCILIATION_COVERAGE_COMPLETE");
    expect(c?.description).toMatch(/bounded batch/);
    expect(c?.description).toMatch(/not a coverage guarantee/);
  });
});

describe("M166 — catalog integrity", () => {
  it("every code has a severity, a verification, a category and a non-empty next action", () => {
    for (const [code, entry] of Object.entries(LEGACY_WIND_DOWN_CATALOG)) {
      expect(["INFO", "WARNING", "ERROR", "CRITICAL"], code).toContain(entry.severity);
      expect(["AUTOMATIC", "HUMAN_REVIEW_REQUIRED"], code).toContain(entry.verification);
      expect(["OPERATIONAL", "FINANCIAL", "RECONCILIATION", "DATA_INTEGRITY"], code).toContain(entry.category);
      expect(entry.nextAction.length, code).toBeGreaterThan(20);
    }
  });

  it("never proposes an unapproved legal outcome: the Stripe-fee deduction is explicitly excluded and no deletion is suggested", () => {
    expect(LEGACY_WIND_DOWN_CATALOG.LEGACY_REFUND_NOT_FINAL.nextAction).toMatch(/Do not introduce a Stripe-fee deduction/);
    for (const [code, entry] of Object.entries(LEGACY_WIND_DOWN_CATALOG)) {
      expect(entry.nextAction, code).not.toMatch(/\b(delete|drop|purge|truncate)\b(?! records to make)/i);
    }
    expect(LEGACY_WIND_DOWN_CATALOG.LEGACY_RECONCILIATION_DISCREPANCIES_OPEN.nextAction).toMatch(/Never delete records/);
  });
});
