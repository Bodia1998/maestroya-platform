import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StripePaymentWebhookEvent } from "@/application/ports/stripe-payment-webhook-verifier";
import {
  ProcessLeadFeePaymentWebhookUseCase,
  STRIPE_LEAD_FEE_PAYMENTS_WEBHOOK_PROVIDER,
  isLeadFeePaymentEvent,
} from "@/application/use-cases/lead-fee-payment/process-lead-fee-payment-webhook.use-case";
import { TransitionLeadPurchaseUseCase } from "@/application/use-cases/lead-purchase/transition-lead-purchase.use-case";
import { ConfirmLeadPurchaseUseCase } from "@/application/use-cases/lead-purchase/confirm-lead-purchase.use-case";
import type { LeadPurchaseRecord, LeadPurchaseRepository } from "@/domain/repositories/lead-purchase-repository";
import type { LeadRepository } from "@/domain/repositories/lead-repository";
import type { ServiceRequestRepository } from "@/domain/repositories/service-request-repository";
import type { LeadPurchaseStatus } from "@/domain/services/lead-purchase";

import { FakeExternalWebhookEventRepository } from "../payments/fakes";
import { SNAPSHOT_DATA } from "../../../../../test-utils/lead-publication-fixtures";
import { pendingPurchaseFromPublication } from "../../../../../test-utils/lead-purchase-fixtures";

vi.mock("@/infrastructure/observability/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const LEAD = "11111111-1111-4111-8111-111111111111";
const PRO = "33333333-3333-4333-8333-333333333333";
const PURCHASE = "55555555-5555-4555-8555-555555555555";
const OTHER_PURCHASE = "66666666-6666-4666-8666-666666666666";
const PI = "pi_lead_fee_1";
const PUBLICATION = { ...SNAPSHOT_DATA, publishedAt: new Date("2026-10-01T00:00:00Z"), price: "100.00" };

type Overrides = {
  status?: LeadPurchaseStatus;
  paymentReference?: string | null;
  mutate?: (p: LeadPurchaseRecord) => LeadPurchaseRecord;
  flow?: "LEAD_V1" | "LEGACY_QUOTE_PAYMENT";
  leadStatus?: string;
};

function world(o: Overrides = {}) {
  let base = pendingPurchaseFromPublication(PURCHASE, LEAD, PRO, PUBLICATION);
  base = { ...base, status: o.status ?? "PENDING_PAYMENT", paymentReference: o.paymentReference === undefined ? PI : o.paymentReference };
  if (o.mutate) base = o.mutate(base);
  const rows = new Map<string, LeadPurchaseRecord>([[base.id, base]]);
  const snapshotBefore = JSON.stringify(base.financialSnapshot);
  const writes: Array<{ id: string; to: LeadPurchaseStatus }> = [];

  const purchases = {
    findById: vi.fn(async (id: string) => (rows.has(id) ? structuredClone(rows.get(id)!) : null)),
    findByPaymentReference: vi.fn(async (ref: string) => {
      const row = [...rows.values()].find((r) => r.paymentReference === ref);
      return row ? structuredClone(row) : null;
    }),
    // Same contract as the Prisma adapter: status-conditional, exactly one caller wins.
    transition: vi.fn(async (id: string, from: LeadPurchaseStatus, to: LeadPurchaseStatus, now: Date) => {
      await Promise.resolve();
      const row = rows.get(id);
      if (!row || row.status !== from) return null;
      const next: LeadPurchaseRecord = {
        ...row,
        status: to,
        ...(to === "CONFIRMED" ? { confirmedAt: now } : {}),
        ...(to === "CANCELLED" ? { cancelledAt: now } : {}),
      };
      rows.set(id, next);
      writes.push({ id, to });
      return structuredClone(next);
    }),
    recordPaymentReference: vi.fn(),
  } as unknown as LeadPurchaseRepository & { findByPaymentReference: (r: string) => Promise<LeadPurchaseRecord | null> };

  const leads = {
    findById: vi.fn(async () => ({ id: LEAD, serviceRequestId: "sr-1", flowVersion: o.flow ?? "LEAD_V1", status: o.leadStatus ?? "PUBLISHED" })),
  } as unknown as LeadRepository;
  const serviceRequests = { findById: vi.fn(async () => ({ id: "sr-1", status: "PUBLISHED", title: "Fuga", description: "Fuga en el baño", location: { city: "Madrid" }, flowVersion: "LEAD_V1" })) } as unknown as ServiceRequestRepository;
  const events = new FakeExternalWebhookEventRepository();
  const confirmer = new ConfirmLeadPurchaseUseCase(purchases, leads, serviceRequests);
  const useCase = new ProcessLeadFeePaymentWebhookUseCase(purchases, leads, confirmer, new TransitionLeadPurchaseUseCase(purchases), events);
  return { useCase, purchases, events, rows, writes, snapshotBefore, current: () => rows.get(PURCHASE)! };
}

let evtSeq = 0;
function succeeded(over: Partial<NonNullable<StripePaymentWebhookEvent["paymentIntent"]>> = {}, type = "payment_intent.succeeded", id?: string): StripePaymentWebhookEvent {
  return {
    id: id ?? `evt_${++evtSeq}`,
    type,
    createdAt: new Date(),
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

describe("M141 — routing predicate", () => {
  it("is true only for the LEAD_V1 marker", () => {
    expect(isLeadFeePaymentEvent(succeeded())).toBe(true);
    expect(isLeadFeePaymentEvent(succeeded({ flow: null }))).toBe(false);
    expect(isLeadFeePaymentEvent(succeeded({ flow: "lead_v1" }))).toBe(false);
    expect(isLeadFeePaymentEvent(succeeded({ flow: "OTHER" }))).toBe(false);
    expect(isLeadFeePaymentEvent({ ...succeeded(), paymentIntent: null })).toBe(false);
  });

  it("ignores (without touching anything) an event that is not LEAD_V1", async () => {
    const w = world();
    expect((await w.useCase.execute(succeeded({ flow: null }))).outcome).toBe("ignored");
    expect(w.writes).toEqual([]);
    expect(w.current().status).toBe("PENDING_PAYMENT");
  });
});

describe("M141 — payment_intent.succeeded", () => {
  let w: ReturnType<typeof world>;
  beforeEach(() => {
    w = world();
  });

  it("PENDING_PAYMENT -> CONFIRMED when reference, amount (12100 cents) and currency match; snapshot and reference untouched", async () => {
    const result = await w.useCase.execute(succeeded());
    expect(result.outcome).toBe("confirmed");
    expect(w.current().status).toBe("CONFIRMED");
    expect(w.current().confirmedAt).toBeInstanceOf(Date);
    expect(JSON.stringify(w.current().financialSnapshot)).toBe(w.snapshotBefore);
    expect(w.current().paymentReference).toBe(PI);
    expect(w.purchases.recordPaymentReference).not.toHaveBeenCalled();
  });

  it("claims the event in the dedicated LEAD_V1 ledger stream (not the legacy one)", async () => {
    await w.useCase.execute(succeeded({}, "payment_intent.succeeded", "evt_ledger"));
    const rec = [...w.events.events.values()][0]!;
    expect(rec.provider).toBe(STRIPE_LEAD_FEE_PAYMENTS_WEBHOOK_PROVIDER);
    expect(rec.provider).not.toBe("STRIPE_PAYMENTS");
    expect(rec.status).toBe("PROCESSED");
  });

  it("the same event delivered twice is a 'duplicate' (one write)", async () => {
    const evt = succeeded({}, "payment_intent.succeeded", "evt_same");
    expect((await w.useCase.execute(evt)).outcome).toBe("confirmed");
    expect((await w.useCase.execute(evt)).outcome).toBe("duplicate");
    expect(w.writes).toHaveLength(1);
  });

  it("already CONFIRMED + same PaymentIntent (new event id) is idempotent: no write, no error, nothing changed", async () => {
    await w.useCase.execute(succeeded());
    const confirmedAt = w.current().confirmedAt;
    const result = await w.useCase.execute(succeeded());
    expect(result.outcome).toBe("already-confirmed");
    expect(w.writes).toHaveLength(1);
    expect(w.current().confirmedAt).toBe(confirmedAt);
    expect(JSON.stringify(w.current().financialSnapshot)).toBe(w.snapshotBefore);
  });

  it("already CONFIRMED + a DIFFERENT PaymentIntent matches nothing: unmatched, never overwrites the reference", async () => {
    await w.useCase.execute(succeeded());
    const result = await w.useCase.execute(succeeded({ paymentIntentId: "pi_other" }));
    expect(result.outcome).toBe("unmatched");
    expect(w.current().paymentReference).toBe(PI);
    expect(w.writes).toHaveLength(1);
  });

  it("already CONFIRMED + same PI but a wrong amount is rejected, not silently accepted", async () => {
    await w.useCase.execute(succeeded());
    const result = await w.useCase.execute(succeeded({ amountMinorUnits: 100 }));
    expect(result).toMatchObject({ outcome: "rejected", rejection: "AMOUNT_MISMATCH" });
  });

  it("concurrent identical successes (different event ids) confirm exactly once", async () => {
    const results = await Promise.all([w.useCase.execute(succeeded()), w.useCase.execute(succeeded()), w.useCase.execute(succeeded())]);
    expect(w.writes.filter((x) => x.to === "CONFIRMED")).toHaveLength(1);
    expect(w.current().status).toBe("CONFIRMED");
    expect(results.every((r) => r.outcome === "confirmed" || r.outcome === "already-confirmed")).toBe(true);
  });

  it("concurrent delivery of the SAME event id is processed once (ledger claim)", async () => {
    const evt = succeeded({}, "payment_intent.succeeded", "evt_race");
    const results = await Promise.all([w.useCase.execute(evt), w.useCase.execute(evt)]);
    expect(results.map((r) => r.outcome).sort()).toEqual(["confirmed", "duplicate"]);
    expect(w.writes).toHaveLength(1);
  });

  it("no purchase for the PaymentIntent -> unmatched; nothing is created", async () => {
    const result = await w.useCase.execute(succeeded({ paymentIntentId: "pi_ghost", leadPurchaseId: null }));
    expect(result.outcome).toBe("unmatched");
    expect(w.rows.size).toBe(1);
    expect(w.writes).toEqual([]);
  });

  it("a purchase with no reference is never matched, even if metadata names it (client/metadata id is not identity)", async () => {
    const w2 = world({ paymentReference: null });
    const result = await w2.useCase.execute(succeeded({ paymentIntentId: "pi_forged", leadPurchaseId: PURCHASE }));
    expect(result.outcome).toBe("unmatched");
    expect(w2.current().status).toBe("PENDING_PAYMENT");
    expect(w2.current().paymentReference).toBeNull();
  });

  it("metadata naming a different purchase/lead for a matching reference is rejected", async () => {
    expect(await w.useCase.execute(succeeded({ leadPurchaseId: OTHER_PURCHASE }))).toMatchObject({ outcome: "rejected", rejection: "PURCHASE_METADATA_MISMATCH" });
    expect(await w.useCase.execute(succeeded({ leadId: "99999999-9999-4999-8999-999999999999" }))).toMatchObject({ rejection: "PURCHASE_METADATA_MISMATCH" });
    expect(w.current().status).toBe("PENDING_PAYMENT");
  });

  it.each([
    ["amount too low", { amountMinorUnits: 10000 }, "AMOUNT_MISMATCH"],
    ["amount too high", { amountMinorUnits: 12101 }, "AMOUNT_MISMATCH"],
    ["amount in euros (float)", { amountMinorUnits: 121 }, "AMOUNT_MISMATCH"],
    ["fractional amount", { amountMinorUnits: 12100.5 }, "AMOUNT_MALFORMED"],
    ["NaN amount", { amountMinorUnits: Number.NaN }, "AMOUNT_MALFORMED"],
    ["negative amount", { amountMinorUnits: -12100 }, "AMOUNT_MALFORMED"],
    ["zero amount", { amountMinorUnits: 0 }, "AMOUNT_MALFORMED"],
    ["string amount", { amountMinorUnits: "12100" as unknown as number }, "AMOUNT_MALFORMED"],
    ["missing amount", { amountMinorUnits: null }, "AMOUNT_MALFORMED"],
    ["wrong currency", { currency: "usd" }, "CURRENCY_MISMATCH"],
    ["missing currency", { currency: null }, "CURRENCY_MISMATCH"],
  ] as const)("rejects: %s -> purchase unchanged", async (_name, over, rejection) => {
    const result = await w.useCase.execute(succeeded(over as never));
    expect(result).toMatchObject({ outcome: "rejected", rejection });
    expect(w.current().status).toBe("PENDING_PAYMENT");
    expect(w.writes).toEqual([]);
  });

  it("accepts the currency in any case / with whitespace (normalised safely)", async () => {
    expect((await w.useCase.execute(succeeded({ currency: " EUR " }))).outcome).toBe("confirmed");
  });

  it.each([
    ["missing total", (p: LeadPurchaseRecord) => ({ ...p, financialSnapshot: { ...p.financialSnapshot, totalAmount: null } })],
    ["missing tax", (p: LeadPurchaseRecord) => ({ ...p, financialSnapshot: { ...p.financialSnapshot, taxAmount: null } })],
    ["total != fee + tax", (p: LeadPurchaseRecord) => ({ ...p, financialSnapshot: { ...p.financialSnapshot, totalAmount: "130.00" } })],
    ["non-EUR currency", (p: LeadPurchaseRecord) => ({ ...p, currency: "USD", financialSnapshot: { ...p.financialSnapshot, currency: "USD" } })],
    ["malformed money", (p: LeadPurchaseRecord) => ({ ...p, financialSnapshot: { ...p.financialSnapshot, totalAmount: "abc" } })],
  ])("invalid/missing financial snapshot (%s) is rejected, never repaired", async (_n, mutate) => {
    const w2 = world({ mutate });
    const result = await w2.useCase.execute(succeeded({ amountMinorUnits: 12100 }));
    expect(result).toMatchObject({ outcome: "rejected", rejection: "SNAPSHOT_INVALID" });
    expect(w2.current().status).toBe("PENDING_PAYMENT");
    expect(w2.writes).toEqual([]);
  });

  it("a purchase whose lead is not LEAD_V1 is rejected", async () => {
    const w2 = world({ flow: "LEGACY_QUOTE_PAYMENT" });
    expect(await w2.useCase.execute(succeeded())).toMatchObject({ outcome: "rejected", rejection: "NOT_LEAD_V1" });
    expect(w2.current().status).toBe("PENDING_PAYMENT");
  });

  it("a lead that is no longer PUBLISHED is not confirmed (M126 rule) and is flagged, not retried", async () => {
    const w2 = world({ leadStatus: "CLOSED" });
    expect(await w2.useCase.execute(succeeded())).toMatchObject({ outcome: "rejected", rejection: "LEAD_NOT_CONFIRMABLE" });
    expect(w2.current().status).toBe("PENDING_PAYMENT");
  });

  it.each(["FAILED", "CANCELLED", "REFUNDED", "REVOKED"] as const)("a %s purchase can never become CONFIRMED by a late success", async (status) => {
    const w2 = world({ status });
    expect(await w2.useCase.execute(succeeded())).toMatchObject({ outcome: "rejected", rejection: "STATUS_NOT_CONFIRMABLE" });
    expect(w2.current().status).toBe(status);
    expect(w2.writes).toEqual([]);
  });

  it("an unexpected infrastructure error is rethrown (provider retries) and the event stays re-claimable", async () => {
    (w.purchases.transition as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("db down"));
    const evt = succeeded({}, "payment_intent.succeeded", "evt_retry");
    await expect(w.useCase.execute(evt)).rejects.toThrow("db down");
    expect([...w.events.events.values()][0]!.status).toBe("FAILED");
    expect((await w.useCase.execute(evt)).outcome).toBe("confirmed");
  });
});

describe("M141 — failed / canceled events", () => {
  it("payment_failed never confirms and leaves the purchase untouched (the PaymentIntent can still be retried)", async () => {
    const w = world();
    const result = await w.useCase.execute(succeeded({}, "payment_intent.payment_failed"));
    expect(result.outcome).toBe("payment-failed-observed");
    expect(w.current().status).toBe("PENDING_PAYMENT");
    expect(w.writes).toEqual([]);
    // ...and a later success on the same intent still confirms.
    expect((await w.useCase.execute(succeeded())).outcome).toBe("confirmed");
  });

  it("canceled never confirms: PENDING_PAYMENT -> CANCELLED (M137), snapshot and reference untouched", async () => {
    const w = world();
    const result = await w.useCase.execute(succeeded({}, "payment_intent.canceled"));
    expect(result.outcome).toBe("cancelled");
    expect(w.current().status).toBe("CANCELLED");
    expect(w.current().cancelledAt).toBeInstanceOf(Date);
    expect(w.current().confirmedAt).toBeNull();
    expect(JSON.stringify(w.current().financialSnapshot)).toBe(w.snapshotBefore);
    expect(w.current().paymentReference).toBe(PI);
  });

  it("canceled for an already CONFIRMED purchase changes nothing", async () => {
    const w = world();
    await w.useCase.execute(succeeded());
    expect((await w.useCase.execute(succeeded({}, "payment_intent.canceled"))).outcome).toBe("ignored");
    expect(w.current().status).toBe("CONFIRMED");
  });

  it("failed / canceled for an unknown PaymentIntent are unmatched, nothing created", async () => {
    const w = world();
    expect((await w.useCase.execute(succeeded({ paymentIntentId: "pi_ghost" }, "payment_intent.canceled"))).outcome).toBe("unmatched");
    expect((await w.useCase.execute(succeeded({ paymentIntentId: "pi_ghost" }, "payment_intent.payment_failed"))).outcome).toBe("unmatched");
    expect(w.writes).toEqual([]);
  });

  it("amount_capturable_updated and other event types are ignored", async () => {
    const w = world();
    expect((await w.useCase.execute(succeeded({}, "payment_intent.amount_capturable_updated"))).outcome).toBe("ignored");
    expect(w.current().status).toBe("PENDING_PAYMENT");
  });
});

describe("M141 — result carries no sensitive data", () => {
  it("the use case result is only an outcome label (+ internal rejection code)", async () => {
    const w = world();
    const result = await w.useCase.execute(succeeded());
    expect(Object.keys(result)).toEqual(["outcome"]);
    const text = JSON.stringify(result);
    for (const forbidden of ["@", "+34", "client_secret", "whsec", PI, "12100"]) expect(text).not.toContain(forbidden);
  });
});
