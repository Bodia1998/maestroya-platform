import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StripePaymentWebhookEvent } from "@/application/ports/stripe-payment-webhook-verifier";
import { ProcessLeadFeePaymentWebhookUseCase } from "@/application/use-cases/lead-fee-payment/process-lead-fee-payment-webhook.use-case";
import { ConfirmLeadPurchaseUseCase } from "@/application/use-cases/lead-purchase/confirm-lead-purchase.use-case";
import { TransitionLeadPurchaseUseCase } from "@/application/use-cases/lead-purchase/transition-lead-purchase.use-case";
import type { LeadFeeRevenueLedgerRepository } from "@/domain/repositories/lead-fee-revenue-ledger-repository";
import type { LeadPurchaseRecord, LeadPurchaseRepository } from "@/domain/repositories/lead-purchase-repository";
import type { LeadRepository } from "@/domain/repositories/lead-repository";
import type { ServiceRequestRepository } from "@/domain/repositories/service-request-repository";
import {
  LeadFeeLedgerConflictError,
  buildLeadFeeRevenueLedgerEntry,
  isSameLeadFeePayment,
  type LeadFeePaymentLedgerSource,
  type LeadFeeRevenueLedgerEntryRecord,
} from "@/domain/services/lead-fee-revenue-ledger";
import type { LeadPurchaseStatus } from "@/domain/services/lead-purchase";

import { FakeExternalWebhookEventRepository } from "../payments/fakes";
import { SNAPSHOT_DATA } from "../../../../../test-utils/lead-publication-fixtures";
import { pendingPurchaseFromPublication } from "../../../../../test-utils/lead-purchase-fixtures";

vi.mock("@/infrastructure/observability/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

/**
 * Module 149 — the webhook use case + confirmation + ledger, against fakes that reproduce the Prisma
 * contracts: `transition(..., ledgerSource)` is ATOMIC (status change + entry, or neither) and the ledger
 * enforces the (purchase, type) / (paymentReference, type) uniqueness exactly once.
 */
const LEAD = "11111111-1111-4111-8111-111111111111";
const PRO = "33333333-3333-4333-8333-333333333333";
const PURCHASE = "55555555-5555-4555-8555-555555555555";
const PI = "pi_lead_fee_149";
const PUBLICATION = { ...SNAPSHOT_DATA, publishedAt: new Date("2026-10-01T00:00:00Z"), price: "100.00" };

function world(o: { status?: LeadPurchaseStatus; confirmedWithoutEntry?: boolean; failLedgerInsert?: boolean; ledger?: boolean } = {}) {
  let base = pendingPurchaseFromPublication(PURCHASE, LEAD, PRO, PUBLICATION);
  base = { ...base, status: o.status ?? "PENDING_PAYMENT", paymentReference: PI, confirmedAt: o.status === "CONFIRMED" ? new Date("2026-10-08T00:00:00Z") : null };
  const rows = new Map<string, LeadPurchaseRecord>([[base.id, base]]);
  const entries = new Map<string, LeadFeeRevenueLedgerEntryRecord>(); // key: purchaseId
  const state = { failLedgerInsert: o.failLedgerInsert ?? false, insertAttempts: 0 };
  let seq = 0;

  const insert = (entry: ReturnType<typeof buildLeadFeeRevenueLedgerEntry>) => {
    state.insertAttempts += 1;
    if (state.failLedgerInsert) throw new Error("ledger insert failed");
    if (entries.has(entry.leadPurchaseId) || [...entries.values()].some((e) => e.paymentReference === entry.paymentReference)) {
      throw new Error("unique violation"); // what the DB indexes do for a second plain INSERT
    }
    const rec = { ...entry, id: `le-${++seq}`, recordedAt: new Date() };
    entries.set(entry.leadPurchaseId, rec);
    return rec;
  };

  const purchases = {
    findById: vi.fn(async (id: string) => (rows.has(id) ? structuredClone(rows.get(id)!) : null)),
    findByPaymentReference: vi.fn(async (ref: string) => {
      const row = [...rows.values()].find((r) => r.paymentReference === ref);
      return row ? structuredClone(row) : null;
    }),
    transition: vi.fn(async (id: string, from: LeadPurchaseStatus, to: LeadPurchaseStatus, now: Date, source?: LeadFeePaymentLedgerSource) => {
      await Promise.resolve();
      const row = rows.get(id);
      if (!row || row.status !== from) return null;
      const next: LeadPurchaseRecord = { ...row, status: to, ...(to === "CONFIRMED" ? { confirmedAt: now } : {}), ...(to === "CANCELLED" ? { cancelledAt: now } : {}) };
      if (source) {
        // single DB transaction: if the entry cannot be written, the status change is NOT kept.
        insert(buildLeadFeeRevenueLedgerEntry(next, source));
      }
      rows.set(id, next);
      return structuredClone(next);
    }),
    recordPaymentReference: vi.fn(),
  } as unknown as LeadPurchaseRepository & { findByPaymentReference: (r: string) => Promise<LeadPurchaseRecord | null> };

  const ledger: LeadFeeRevenueLedgerRepository = {
    recordIfAbsent: vi.fn(async (entry) => {
      const existing = entries.get(entry.leadPurchaseId);
      if (existing) {
        if (!isSameLeadFeePayment(existing, entry)) throw new LeadFeeLedgerConflictError(entry.leadPurchaseId);
        return { created: false, entry: existing };
      }
      return { created: true, entry: insert(entry) };
    }),
    findByLeadPurchaseId: vi.fn(async (id: string) => entries.get(id) ?? null),
  };

  const leads = { findById: vi.fn(async () => ({ id: LEAD, serviceRequestId: "sr-1", flowVersion: "LEAD_V1", status: "PUBLISHED" })) } as unknown as LeadRepository;
  const serviceRequests = { findById: vi.fn(async () => ({ id: "sr-1", status: "PUBLISHED", title: "Fuga", description: "Fuga en el baño", location: { city: "Madrid" }, flowVersion: "LEAD_V1" })) } as unknown as ServiceRequestRepository;
  const webhookEvents = new FakeExternalWebhookEventRepository();
  const useCase = new ProcessLeadFeePaymentWebhookUseCase(
    purchases,
    leads,
    new ConfirmLeadPurchaseUseCase(purchases, leads, serviceRequests),
    new TransitionLeadPurchaseUseCase(purchases),
    webhookEvents,
    undefined,
    o.ledger === false ? undefined : ledger,
  );
  return { useCase, rows, entries, ledger, purchases, state, webhookEvents, current: () => rows.get(PURCHASE)! };
}

let evtSeq = 0;
function event(over: Partial<NonNullable<StripePaymentWebhookEvent["paymentIntent"]>> = {}, type = "payment_intent.succeeded", id?: string): StripePaymentWebhookEvent {
  return {
    id: id ?? `evt_149_${++evtSeq}`,
    type,
    createdAt: new Date("2026-10-09T10:00:00Z"),
    paymentIntent: {
      paymentIntentId: PI,
      lastPaymentErrorMessage: null,
      amountMinorUnits: 12100,
      currency: "eur",
      flow: "LEAD_V1",
      leadPurchaseId: PURCHASE,
      leadId: LEAD,
      ...over,
    },
    chargeRefunded: null,
    dispute: null,
    chargeUpdated: null,
  };
}

describe("M149 — successful confirmation records exactly one ledger entry", () => {
  let w: ReturnType<typeof world>;
  beforeEach(() => {
    w = world();
  });

  it("confirms and records net/IVA/total, references and the audit source event, from persisted values", async () => {
    const result = await w.useCase.execute(event({}, "payment_intent.succeeded", "evt_src"));
    expect(result.outcome).toBe("confirmed");
    expect(w.entries.size).toBe(1);
    const entry = w.entries.get(PURCHASE)!;
    expect(entry).toMatchObject({
      leadPurchaseId: PURCHASE,
      leadId: LEAD,
      professionalProfileId: PRO,
      paymentReference: PI,
      providerEventId: "evt_src",
      providerEventCreatedAt: new Date("2026-10-09T10:00:00Z"),
      netFeeAmount: "100.00",
      taxAmount: "21.00",
      totalCollectedAmount: "121.00",
      currency: "EUR",
    });
    expect(entry.paymentConfirmedAt).toEqual(w.current().confirmedAt);
  });

  it("ledger amounts are the snapshot's, not the provider event's numbers (event amount only has to MATCH)", async () => {
    await w.useCase.execute(event());
    const entry = w.entries.get(PURCHASE)!;
    expect(entry.totalCollectedAmount).toBe(w.current().financialSnapshot.totalAmount);
    expect(entry.netFeeAmount).toBe(w.current().financialSnapshot.feeAmount);
    // A tampered amount is rejected before anything is written.
    const w2 = world();
    const r = await w2.useCase.execute(event({ amountMinorUnits: 100 }));
    expect(r).toMatchObject({ outcome: "rejected", rejection: "AMOUNT_MISMATCH" });
    expect(w2.entries.size).toBe(0);
    expect(w2.current().status).toBe("PENDING_PAYMENT");
  });

  it("the same event delivered twice -> duplicate, one entry", async () => {
    const evt = event({}, "payment_intent.succeeded", "evt_same");
    expect((await w.useCase.execute(evt)).outcome).toBe("confirmed");
    expect((await w.useCase.execute(evt)).outcome).toBe("duplicate");
    expect(w.entries.size).toBe(1);
    expect(w.state.insertAttempts).toBe(1);
  });

  it("reprocessing an already-confirmed payment (new event id) leaves the single entry untouched", async () => {
    await w.useCase.execute(event());
    const first = w.entries.get(PURCHASE)!;
    const result = await w.useCase.execute(event());
    expect(result.outcome).toBe("already-confirmed");
    expect(w.entries.size).toBe(1);
    expect(w.entries.get(PURCHASE)).toBe(first);
  });

  it("concurrent distinct-event deliveries produce exactly one entry", async () => {
    const results = await Promise.all([w.useCase.execute(event()), w.useCase.execute(event()), w.useCase.execute(event()), w.useCase.execute(event())]);
    expect(w.entries.size).toBe(1);
    expect(results.every((r) => r.outcome === "confirmed" || r.outcome === "already-confirmed")).toBe(true);
    expect(w.state.insertAttempts).toBe(1); // only the winning confirmation inserted
  });

  it("concurrent delivery of the SAME event id is processed once", async () => {
    const evt = event({}, "payment_intent.succeeded", "evt_race");
    const results = await Promise.all([w.useCase.execute(evt), w.useCase.execute(evt)]);
    expect(results.map((r) => r.outcome).sort()).toEqual(["confirmed", "duplicate"]);
    expect(w.entries.size).toBe(1);
  });
});

describe("M149 — already-confirmed purchase without an entry (confirmed before M149)", () => {
  it("is repaired idempotently from the verified event; a second reprocessing adds nothing", async () => {
    const w = world({ status: "CONFIRMED" });
    expect(w.entries.size).toBe(0);
    expect((await w.useCase.execute(event())).outcome).toBe("already-confirmed");
    expect(w.entries.size).toBe(1);
    expect(w.entries.get(PURCHASE)!.paymentConfirmedAt).toEqual(new Date("2026-10-08T00:00:00Z")); // original confirmation time, not "now"
    expect((await w.useCase.execute(event())).outcome).toBe("already-confirmed");
    expect(w.entries.size).toBe(1);
    expect(w.state.insertAttempts).toBe(1);
  });

  it("a mismatching amount on an already-confirmed purchase is rejected and records nothing", async () => {
    const w = world({ status: "CONFIRMED" });
    expect(await w.useCase.execute(event({ amountMinorUnits: 100 }))).toMatchObject({ outcome: "rejected", rejection: "AMOUNT_MISMATCH" });
    expect(w.entries.size).toBe(0);
  });

  it("a confirmed purchase whose confirmedAt is missing is rejected (LEDGER_ENTRY_INVALID), not silently recorded", async () => {
    const w = world({ status: "CONFIRMED" });
    w.rows.set(PURCHASE, { ...w.current(), confirmedAt: null });
    expect(await w.useCase.execute(event())).toMatchObject({ outcome: "rejected", rejection: "LEDGER_ENTRY_INVALID" });
    expect(w.entries.size).toBe(0);
  });

  it("an existing entry that disagrees with the confirmed payment is surfaced (rethrown), never overwritten", async () => {
    const w = world({ status: "CONFIRMED" });
    await w.useCase.execute(event());
    const stored = w.entries.get(PURCHASE)!;
    w.entries.set(PURCHASE, { ...stored, totalCollectedAmount: "99.00" });
    await expect(w.useCase.execute(event())).rejects.toBeInstanceOf(LeadFeeLedgerConflictError);
    expect(w.entries.get(PURCHASE)!.totalCollectedAmount).toBe("99.00");
  });
});

describe("M149 — non-success events never create revenue", () => {
  it.each([
    ["payment_intent.payment_failed", "payment-failed-observed"],
    ["payment_intent.canceled", "cancelled"],
  ] as const)("%s -> no entry", async (type, outcome) => {
    const w = world();
    expect((await w.useCase.execute(event({}, type))).outcome).toBe(outcome);
    expect(w.entries.size).toBe(0);
    expect(w.state.insertAttempts).toBe(0);
  });

  it("unrelated / non-LEAD_V1 / unmatched / terminal-status events create nothing", async () => {
    const w = world();
    expect((await w.useCase.execute(event({ flow: null }))).outcome).toBe("ignored");
    expect((await w.useCase.execute(event({ paymentIntentId: "pi_ghost", leadPurchaseId: null }))).outcome).toBe("unmatched");
    expect((await w.useCase.execute(event({}, "payment_intent.created"))).outcome).toBe("ignored");
    for (const status of ["FAILED", "CANCELLED", "REFUNDED", "REVOKED"] as const) {
      const t = world({ status });
      expect((await t.useCase.execute(event())).outcome).toBe("rejected");
      expect(t.entries.size).toBe(0);
    }
    expect(w.entries.size).toBe(0);
  });

  it("payment initiation / pending state alone has no entry (nothing but a verified success writes)", async () => {
    const w = world();
    expect(w.current().status).toBe("PENDING_PAYMENT");
    expect(await w.ledger.findByLeadPurchaseId(PURCHASE)).toBeNull();
  });
});

describe("M149 — ledger failures are surfaced, never swallowed", () => {
  it("an insert failure inside the confirmation rolls the purchase back to PENDING_PAYMENT and rethrows; the claim is failed (retryable)", async () => {
    const w = world({ failLedgerInsert: true });
    const evt = event({}, "payment_intent.succeeded", "evt_fail");
    await expect(w.useCase.execute(evt)).rejects.toThrow("ledger insert failed");
    expect(w.current().status).toBe("PENDING_PAYMENT");
    expect(w.current().confirmedAt).toBeNull();
    expect(w.entries.size).toBe(0);
    expect([...w.webhookEvents.events.values()][0]!.status).toBe("FAILED");

    // provider retry of the same event after the fault is fixed: claim is re-claimable, confirmation + entry succeed together
    w.state.failLedgerInsert = false;
    expect((await w.useCase.execute(evt)).outcome).toBe("confirmed");
    expect(w.current().status).toBe("CONFIRMED");
    expect(w.entries.size).toBe(1);
  });

  it("a failure of the idempotent already-confirmed path is rethrown, not reported as recorded", async () => {
    const w = world({ status: "CONFIRMED", failLedgerInsert: true });
    await expect(w.useCase.execute(event())).rejects.toThrow("ledger insert failed");
    expect(w.entries.size).toBe(0);
  });
});

describe("M149 — existing confirmation behaviour is unchanged", () => {
  it("confirmation still works and passes a verified source when no ledger repository is injected", async () => {
    const w = world({ ledger: false });
    expect((await w.useCase.execute(event())).outcome).toBe("confirmed");
    expect(w.current().status).toBe("CONFIRMED");
    expect(w.purchases.transition).toHaveBeenCalledWith(PURCHASE, "PENDING_PAYMENT", "CONFIRMED", expect.any(Date), expect.objectContaining({ providerEventId: expect.any(String) }));
  });

  it("plain ConfirmLeadPurchaseUseCase.execute (M126 contract: purchase id only) records no ledger entry", async () => {
    const w = world();
    const leads = { findById: vi.fn(async () => ({ id: LEAD, serviceRequestId: "sr-1", flowVersion: "LEAD_V1", status: "PUBLISHED" })) } as unknown as LeadRepository;
    const requests = { findById: vi.fn(async () => ({ id: "sr-1", status: "PUBLISHED", title: "Fuga", description: "Fuga en el baño", location: { city: "Madrid" }, flowVersion: "LEAD_V1" })) } as unknown as ServiceRequestRepository;
    const confirmer = new ConfirmLeadPurchaseUseCase(w.purchases, leads, requests);
    expect(ConfirmLeadPurchaseUseCase.prototype.execute.length).toBe(1);
    await confirmer.execute(PURCHASE);
    expect(w.current().status).toBe("CONFIRMED");
    expect(w.entries.size).toBe(0);
    expect((w.purchases.transition as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![4]).toBeUndefined();
  });

  it("the ledger source carries the verified event id/time and no amount", async () => {
    const w = world();
    await w.useCase.execute(event({}, "payment_intent.succeeded", "evt_meta"));
    const call = (w.purchases.transition as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]!;
    expect(call[4]).toEqual({ providerEventId: "evt_meta", providerEventCreatedAt: new Date("2026-10-09T10:00:00Z") });
  });
});
