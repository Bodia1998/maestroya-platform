import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StripePaymentWebhookEvent } from "@/application/ports/stripe-payment-webhook-verifier";
import type { DomainEvent } from "@/domain/events/domain-event";
import { LeadPurchaseCancelled } from "@/domain/events/lead-purchase-cancelled";
import { LeadPurchaseConfirmed } from "@/domain/events/lead-purchase-confirmed";
import { ProcessLeadFeePaymentWebhookUseCase } from "@/application/use-cases/lead-fee-payment/process-lead-fee-payment-webhook.use-case";
import { ConfirmLeadPurchaseUseCase } from "@/application/use-cases/lead-purchase/confirm-lead-purchase.use-case";
import { TransitionLeadPurchaseUseCase } from "@/application/use-cases/lead-purchase/transition-lead-purchase.use-case";
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

/**
 * Module 145 — the M141 webhook is the ONLY source of purchase-outcome notifications.
 * These tests pin which webhook outcomes raise which domain event (and which raise none).
 */
const LEAD = "11111111-1111-4111-8111-111111111111";
const PRO = "33333333-3333-4333-8333-333333333333";
const PURCHASE = "55555555-5555-4555-8555-555555555555";
const PI = "pi_lead_fee_1";
const PUBLICATION = { ...SNAPSHOT_DATA, publishedAt: new Date("2026-10-01T00:00:00Z"), price: "100.00" };

function world(o: { status?: LeadPurchaseStatus; flow?: "LEAD_V1" | "LEGACY_QUOTE_PAYMENT"; publishFails?: boolean; withBus?: boolean } = {}) {
  const base = { ...pendingPurchaseFromPublication(PURCHASE, LEAD, PRO, PUBLICATION), status: o.status ?? "PENDING_PAYMENT", paymentReference: PI };
  const rows = new Map<string, LeadPurchaseRecord>([[base.id, base]]);
  const published: DomainEvent[] = [];

  const purchases = {
    findById: vi.fn(async (id: string) => (rows.has(id) ? structuredClone(rows.get(id)!) : null)),
    findByPaymentReference: vi.fn(async (ref: string) => {
      const row = [...rows.values()].find((r) => r.paymentReference === ref);
      return row ? structuredClone(row) : null;
    }),
    transition: vi.fn(async (id: string, from: LeadPurchaseStatus, to: LeadPurchaseStatus, now: Date) => {
      await Promise.resolve();
      const row = rows.get(id);
      if (!row || row.status !== from) return null;
      const next = { ...row, status: to, ...(to === "CONFIRMED" ? { confirmedAt: now } : {}), ...(to === "CANCELLED" ? { cancelledAt: now } : {}) };
      rows.set(id, next);
      return structuredClone(next);
    }),
    recordPaymentReference: vi.fn(),
  } as unknown as LeadPurchaseRepository & { findByPaymentReference: (r: string) => Promise<LeadPurchaseRecord | null> };

  const leads = { findById: vi.fn(async () => ({ id: LEAD, serviceRequestId: "sr-1", flowVersion: o.flow ?? "LEAD_V1", status: "PUBLISHED" })) } as unknown as LeadRepository;
  const serviceRequests = {
    findById: vi.fn(async () => ({ id: "sr-1", status: "PUBLISHED", title: "Fuga", description: "Fuga en el baño", location: { city: "Madrid" }, flowVersion: "LEAD_V1" })),
  } as unknown as ServiceRequestRepository;
  const bus = {
    publish: vi.fn(async (event: DomainEvent) => {
      if (o.publishFails) throw new Error("subscriber exploded");
      published.push(event);
    }),
  };
  const useCase = new ProcessLeadFeePaymentWebhookUseCase(
    purchases,
    leads,
    new ConfirmLeadPurchaseUseCase(purchases, leads, serviceRequests),
    new TransitionLeadPurchaseUseCase(purchases),
    new FakeExternalWebhookEventRepository(),
    o.withBus === false ? undefined : bus,
  );
  return { useCase, published, bus, rows };
}

let seq = 0;
function stripeEvent(type: string, over: Partial<NonNullable<StripePaymentWebhookEvent["paymentIntent"]>> = {}, id?: string): StripePaymentWebhookEvent {
  return {
    id: id ?? `evt_m145_${++seq}`,
    type,
    createdAt: new Date(),
    paymentIntent: { paymentIntentId: PI, lastPaymentErrorMessage: null, amountMinorUnits: 12100, currency: "eur", flow: "LEAD_V1", leadPurchaseId: PURCHASE, leadId: LEAD, ...over },
    chargeRefunded: null,
    dispute: null,
    chargeUpdated: null,
  };
}

describe("M145 — success is raised only by the verified, validated webhook confirmation", () => {
  let w: ReturnType<typeof world>;
  beforeEach(() => {
    w = world();
  });

  it("payment_intent.succeeded that confirms the purchase raises LeadPurchaseConfirmed exactly once, carrying only the purchase id", async () => {
    const result = await w.useCase.execute(stripeEvent("payment_intent.succeeded"));
    expect(result.outcome).toBe("confirmed");
    expect(w.published).toHaveLength(1);
    expect(w.published[0]).toBeInstanceOf(LeadPurchaseConfirmed);
    expect((w.published[0] as LeadPurchaseConfirmed).purchaseId).toBe(PURCHASE);
    expect(Object.keys(w.published[0]!).sort()).toEqual(["eventId", "occurredAt", "purchaseId"]);
    expect(JSON.stringify(w.published[0])).not.toContain(PI);
  });

  it("the event is raised AFTER the purchase is CONFIRMED in storage", async () => {
    let statusAtPublish: string | undefined;
    w.bus.publish.mockImplementationOnce(async () => {
      statusAtPublish = w.rows.get(PURCHASE)!.status;
    });
    await w.useCase.execute(stripeEvent("payment_intent.succeeded"));
    expect(statusAtPublish).toBe("CONFIRMED");
  });

  it("a redelivery with the SAME Stripe event id is a ledger duplicate: no second event", async () => {
    await w.useCase.execute(stripeEvent("payment_intent.succeeded", {}, "evt_same"));
    const again = await w.useCase.execute(stripeEvent("payment_intent.succeeded", {}, "evt_same"));
    expect(again.outcome).toBe("duplicate");
    expect(w.published).toHaveLength(1);
  });

  it("a new delivery observing the purchase already CONFIRMED re-raises the event (recipients' dedupe keys make it exactly-once) and still reports already-confirmed", async () => {
    await w.useCase.execute(stripeEvent("payment_intent.succeeded"));
    const again = await w.useCase.execute(stripeEvent("payment_intent.succeeded"));
    expect(again.outcome).toBe("already-confirmed");
    expect(w.published).toHaveLength(2);
    expect(w.published.every((e) => e instanceof LeadPurchaseConfirmed && e.purchaseId === PURCHASE)).toBe(true);
  });

  it("payment_intent.payment_failed raises NOTHING and leaves the purchase PENDING_PAYMENT", async () => {
    const result = await w.useCase.execute(stripeEvent("payment_intent.payment_failed"));
    expect(result.outcome).toBe("payment-failed-observed");
    expect(w.published).toEqual([]);
    expect(w.rows.get(PURCHASE)!.status).toBe("PENDING_PAYMENT");
  });

  it.each([
    ["amount mismatch", { amountMinorUnits: 1 }],
    ["currency mismatch", { currency: "usd" }],
    ["reference mismatch", { paymentIntentId: "pi_other" }],
  ])("a rejected succeeded event (%s) raises nothing", async (_label, patch) => {
    const result = await w.useCase.execute(stripeEvent("payment_intent.succeeded", patch));
    expect(["rejected", "unmatched"]).toContain(result.outcome);
    expect(w.published).toEqual([]);
    expect(w.rows.get(PURCHASE)!.status).toBe("PENDING_PAYMENT");
  });

  it.each(["FAILED", "CANCELLED", "REFUNDED", "REVOKED"] as LeadPurchaseStatus[])("a late success for a %s purchase is rejected and raises nothing", async (status) => {
    const terminal = world({ status });
    const result = await terminal.useCase.execute(stripeEvent("payment_intent.succeeded"));
    expect(result.outcome).toBe("rejected");
    expect(terminal.published).toEqual([]);
  });

  it("a non-LEAD_V1 lead is rejected (NOT_LEAD_V1) and raises nothing", async () => {
    const legacy = world({ flow: "LEGACY_QUOTE_PAYMENT" });
    const result = await legacy.useCase.execute(stripeEvent("payment_intent.succeeded"));
    expect(result).toMatchObject({ outcome: "rejected", rejection: "NOT_LEAD_V1" });
    expect(legacy.published).toEqual([]);
  });

  it("an event that is not a LEAD_V1 lead-fee event is ignored and raises nothing (legacy payments never enter this path)", async () => {
    const result = await w.useCase.execute(stripeEvent("payment_intent.succeeded", { flow: null }));
    expect(result.outcome).toBe("ignored");
    expect(w.published).toEqual([]);
  });
});

describe("M145 — cancellation", () => {
  it("a verified payment_intent.canceled on a PENDING_PAYMENT purchase raises LeadPurchaseCancelled (not Confirmed)", async () => {
    const w = world();
    const result = await w.useCase.execute(stripeEvent("payment_intent.canceled"));
    expect(result.outcome).toBe("cancelled");
    expect(w.published).toHaveLength(1);
    expect(w.published[0]).toBeInstanceOf(LeadPurchaseCancelled);
    expect(w.published.some((e) => e instanceof LeadPurchaseConfirmed)).toBe(false);
  });

  it("canceling an already CONFIRMED purchase is ignored and raises nothing", async () => {
    const w = world({ status: "CONFIRMED" });
    const result = await w.useCase.execute(stripeEvent("payment_intent.canceled"));
    expect(result.outcome).toBe("ignored");
    expect(w.published).toEqual([]);
  });
});

describe("M145 — notification is best-effort and never changes the webhook outcome", () => {
  it("a failing subscriber does not fail the webhook, change its outcome, or undo the confirmation", async () => {
    const w = world({ publishFails: true });
    const result = await w.useCase.execute(stripeEvent("payment_intent.succeeded"));
    expect(result.outcome).toBe("confirmed");
    expect(w.rows.get(PURCHASE)!.status).toBe("CONFIRMED");
  });

  it("without an event bus (every pre-M145 construction) behavior is unchanged", async () => {
    const w = world({ withBus: false });
    expect((await w.useCase.execute(stripeEvent("payment_intent.succeeded"))).outcome).toBe("confirmed");
  });
});
