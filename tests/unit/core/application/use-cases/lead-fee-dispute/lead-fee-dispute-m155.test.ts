import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LeadFeeDisputeGateway } from "@/application/ports/lead-fee-dispute-gateway";
import type { StripePaymentWebhookEvent } from "@/application/ports/stripe-payment-webhook-verifier";
import { ProcessLeadFeeDisputeWebhookUseCase } from "@/application/use-cases/lead-fee-dispute/process-lead-fee-dispute-webhook.use-case";
import { RevokeLeadPurchaseUseCase } from "@/application/use-cases/lead-fee-dispute/revoke-lead-purchase.use-case";
import { SubmitLeadFeeDisputeEvidenceUseCase } from "@/application/use-cases/lead-fee-dispute/submit-lead-fee-dispute-evidence.use-case";
import { PaymentGatewayError } from "@/domain/errors/domain-error";
import {
  LeadFeeDisputeAssociationConflictError,
  type ApplyLeadFeeDisputeEventCommand,
  type LeadFeeDisputeRecord,
  type LeadFeeDisputeRepository,
  type LeadPurchaseRevocationRepository,
} from "@/domain/repositories/lead-fee-dispute-repository";
import type { LeadPurchaseRecord } from "@/domain/repositories/lead-purchase-repository";
import type { LeadRepository } from "@/domain/repositories/lead-repository";
import { LeadFeeDisputeRejectedError } from "@/domain/services/lead-fee-dispute";
import type { LeadPurchaseStatus } from "@/domain/services/lead-purchase";

import { FakeExternalWebhookEventRepository } from "../payments/fakes";
import { SNAPSHOT_DATA } from "../../../../../test-utils/lead-publication-fixtures";
import { pendingPurchaseFromPublication } from "../../../../../test-utils/lead-purchase-fixtures";

vi.mock("@/infrastructure/observability/logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const LEAD = "11111111-1111-4111-8111-111111111111";
const PRO = "33333333-3333-4333-8333-333333333333";
const PURCHASE = "55555555-5555-4555-8555-555555555555";
const ADMIN = "77777777-7777-4777-8777-777777777777";
const DISPUTE_ID = "88888888-8888-4888-8888-888888888888";
const PI = "pi_lead_fee_1";
const PUBLICATION = { ...SNAPSHOT_DATA, publishedAt: new Date("2026-10-01T00:00:00Z"), price: "100.00" };

function purchase(status: LeadPurchaseStatus = "CONFIRMED"): LeadPurchaseRecord {
  return { ...pendingPurchaseFromPublication(PURCHASE, LEAD, PRO, PUBLICATION), status, paymentReference: PI };
}

function event(o: { id?: string; type?: string; status?: string; amount?: number | null; pi?: string | null; currency?: string; charge?: string } = {}): StripePaymentWebhookEvent {
  return {
    id: o.id ?? "evt_1",
    type: o.type ?? "charge.dispute.created",
    createdAt: new Date("2026-10-05T10:00:00Z"),
    paymentIntent: null,
    chargeRefunded: null,
    chargeUpdated: null,
    dispute: {
      disputeId: "dp_1",
      chargeId: o.charge ?? "ch_1",
      paymentIntentId: o.pi === undefined ? PI : o.pi,
      amount: 121,
      amountMinorUnits: o.amount === undefined ? 12100 : o.amount,
      currency: o.currency ?? "eur",
      reason: "fraudulent",
      status: o.status ?? "needs_response",
      evidenceDueBy: null,
    },
  };
}

function webhookWorld(o: { status?: LeadPurchaseStatus; flow?: string; applyError?: Error; applyResult?: Partial<Awaited<ReturnType<LeadFeeDisputeRepository["applyEvent"]>>> } = {}) {
  const p = purchase(o.status);
  const applied: ApplyLeadFeeDisputeEventCommand[] = [];
  const disputes = {
    applyEvent: vi.fn(async (cmd: ApplyLeadFeeDisputeEventCommand) => {
      if (o.applyError) throw o.applyError;
      applied.push(cmd);
      return { dispute: { id: DISPUTE_ID, status: cmd.status } as LeadFeeDisputeRecord, created: true, statusChanged: false, purchaseStatusBefore: "CONFIRMED", purchaseStatusAfter: "DISPUTED", effect: "SUSPEND", ...o.applyResult } as never;
    }),
  };
  const purchases = { findByPaymentReference: vi.fn(async (ref: string) => (ref === PI ? p : null)) };
  const leads = { findById: vi.fn(async () => ({ id: LEAD, flowVersion: o.flow ?? "LEAD_V1" })) } as unknown as LeadRepository;
  const events = new FakeExternalWebhookEventRepository();
  const useCase = new ProcessLeadFeeDisputeWebhookUseCase(purchases, leads, disputes, events, () => new Date("2026-10-05T10:00:01Z"));
  return { useCase, disputes, purchases, events, applied };
}

describe("M155 — dispute webhook: ownership (legacy isolation)", () => {
  it("owns only dispute events whose PaymentIntent is a persisted lead-fee payment reference", async () => {
    const w = webhookWorld();
    expect(await w.useCase.ownsEvent(event())).toBe(true);
    expect(await w.useCase.ownsEvent(event({ pi: "pi_legacy_quote" }))).toBe(false);
    expect(await w.useCase.ownsEvent(event({ pi: null }))).toBe(false);
    expect(await w.useCase.ownsEvent(event({ type: "payment_intent.succeeded" }))).toBe(false);
    expect(await w.useCase.ownsEvent({ ...event(), dispute: null })).toBe(false);
  });

  it("a failed ownership lookup propagates (never silently falls through to the legacy handler)", async () => {
    const w = webhookWorld();
    w.purchases.findByPaymentReference.mockRejectedValueOnce(new Error("db down"));
    await expect(w.useCase.ownsEvent(event())).rejects.toThrow("db down");
  });
});

describe("M155 — dispute webhook: processing", () => {
  let w: ReturnType<typeof webhookWorld>;
  beforeEach(() => {
    w = webhookWorld();
  });

  it("records a new dispute with the validated facts (exact minor units, provider ids) and reports the purchase effect", async () => {
    const r = await w.useCase.execute(event());
    expect(r).toEqual({ outcome: "recorded", purchaseEffect: "SUSPEND" });
    expect(w.applied).toHaveLength(1);
    expect(w.applied[0]).toMatchObject({
      leadPurchaseId: PURCHASE,
      providerEventId: "evt_1",
      status: "NEEDS_RESPONSE",
      dispute: { providerDisputeId: "dp_1", paymentReference: PI, providerChargeId: "ch_1", amountMinorUnits: 12100, currency: "eur" },
    });
  });

  it.each([
    ["charge.dispute.updated", "under_review", "UNDER_REVIEW"],
    ["charge.dispute.closed", "won", "WON"],
    ["charge.dispute.closed", "lost", "LOST"],
    ["charge.dispute.closed", "warning_closed", "WARNING_CLOSED"],
  ])("maps %s/%s to %s", async (type, status, expected) => {
    await w.useCase.execute(event({ type, status }));
    expect(w.applied[0]!.status).toBe(expected);
  });

  it("reports status-updated and replay from the repository result", async () => {
    const updated = webhookWorld({ applyResult: { created: false, statusChanged: true, effect: "REVOKE" } });
    expect(await updated.useCase.execute(event({ type: "charge.dispute.closed", status: "lost" }))).toEqual({ outcome: "status-updated", purchaseEffect: "REVOKE" });
    const replay = webhookWorld({ applyResult: { created: false, statusChanged: false, effect: "NONE" } });
    expect(await replay.useCase.execute(event())).toEqual({ outcome: "replay", purchaseEffect: "NONE" });
  });

  it("a duplicate event id is a no-op that never reaches the repository", async () => {
    await w.useCase.execute(event());
    const again = await w.useCase.execute(event());
    expect(again).toEqual({ outcome: "duplicate" });
    expect(w.disputes.applyEvent).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["unknown status", { status: "charge_refunded" }, "STATUS_UNRECOGNIZED"],
    ["final status on an open event", { status: "lost" }, "STATUS_UNRECOGNIZED"],
    ["currency mismatch", { currency: "usd" }, "CURRENCY_MISMATCH"],
    ["missing amount", { amount: null }, "AMOUNT_INVALID"],
    ["zero amount", { amount: 0 }, "AMOUNT_INVALID"],
    ["amount above the payment", { amount: 12101 }, "AMOUNT_EXCEEDS_PAYMENT"],
  ])("rejects %s without touching state", async (_n, o, rejection) => {
    const r = await w.useCase.execute(event(o));
    expect(r).toEqual({ outcome: "rejected", rejection });
    expect(w.disputes.applyEvent).not.toHaveBeenCalled();
    expect([...w.events.events.values()][0]!.status).toBe("PROCESSED");
  });

  it("a legacy-flow lead is rejected (LEAD_V1 isolation)", async () => {
    const legacy = webhookWorld({ flow: "LEGACY_QUOTE_PAYMENT" });
    expect(await legacy.useCase.execute(event())).toEqual({ outcome: "rejected", rejection: "NOT_LEAD_V1" });
    expect(legacy.disputes.applyEvent).not.toHaveBeenCalled();
  });

  it("an unmatched payment reference changes nothing", async () => {
    expect(await w.useCase.execute(event({ pi: "pi_unknown" }))).toEqual({ outcome: "unmatched" });
    expect(w.disputes.applyEvent).not.toHaveBeenCalled();
  });

  it("an association conflict and a repository-level definitive rejection become 'rejected'", async () => {
    const conflict = webhookWorld({ applyError: new LeadFeeDisputeAssociationConflictError() });
    expect(await conflict.useCase.execute(event())).toEqual({ outcome: "rejected", rejection: "ASSOCIATION_CONFLICT" });
    const rejected = webhookWorld({ applyError: new LeadFeeDisputeRejectedError("AMOUNT_INVALID") });
    expect(await rejected.useCase.execute(event())).toEqual({ outcome: "rejected", rejection: "AMOUNT_INVALID" });
  });

  it("an unexpected failure (incl. a failing audit insert rolled back by the repository) marks the claim FAILED, rethrows, and the redelivery re-processes", async () => {
    const failing = webhookWorld({ applyError: new Error("audit insert failed") });
    await expect(failing.useCase.execute(event())).rejects.toThrow("audit insert failed");
    expect([...failing.events.events.values()][0]!.status).toBe("FAILED");
    failing.disputes.applyEvent.mockReset();
    failing.disputes.applyEvent.mockResolvedValue({ dispute: { id: DISPUTE_ID }, created: true, statusChanged: false, purchaseStatusBefore: "CONFIRMED", purchaseStatusAfter: "DISPUTED", effect: "SUSPEND" } as never);
    expect((await failing.useCase.execute(event())).outcome).toBe("recorded");
  });

  it("never reads anything but the verified event + the persisted purchase (no refund / ledger / invoice collaborator exists)", () => {
    // The constructor takes exactly: correlation reader, lead reader, dispute repository, webhook claims, clock.
    expect(ProcessLeadFeeDisputeWebhookUseCase.length).toBeLessThanOrEqual(5);
  });
});

// ------------------------------------------------------------------------------------------------ revoke

function revokeWorld(o: { status?: LeadPurchaseStatus | null; actor?: { status: string; roles: string[] } | null; actorError?: boolean } = {}) {
  const revokeConfirmed = vi.fn(async (cmd: { now: Date }) => ({ purchaseStatusBefore: "CONFIRMED", purchaseStatusAfter: "REVOKED", revoked: true, revocationId: "rev-1", ...{ now: cmd.now } }) as never);
  const revocations: LeadPurchaseRevocationRepository = { revokeConfirmed } as never;
  const purchases = { findById: vi.fn(async () => (o.status === null ? null : purchase(o.status ?? "CONFIRMED"))) };
  const admins = {
    getUserById: vi.fn(async () => {
      if (o.actorError) throw new Error("lookup failed");
      return o.actor === undefined ? { id: ADMIN, status: "ACTIVE", roles: ["ADMIN"] } : o.actor;
    }),
  } as never;
  return { useCase: new RevokeLeadPurchaseUseCase(purchases, revocations, admins, () => new Date("2026-10-06T00:00:00Z")), revokeConfirmed, purchases };
}
const REVOKE_INPUT = { actorUserId: ADMIN, leadPurchaseId: PURCHASE, explanation: "Confirmed abuse of the platform by the professional", evidenceReference: "CASE-1234" };

describe("M155 — administrative revocation (without refund)", () => {
  it("revokes a CONFIRMED purchase through the repository, once, with the validated inputs", async () => {
    const w = revokeWorld();
    expect(await w.useCase.execute(REVOKE_INPUT)).toEqual({ leadPurchaseId: PURCHASE, status: "REVOKED", revoked: true });
    expect(w.revokeConfirmed).toHaveBeenCalledWith({ leadPurchaseId: PURCHASE, actorUserId: ADMIN, explanation: REVOKE_INPUT.explanation, evidenceReference: "CASE-1234", now: new Date("2026-10-06T00:00:00Z") });
  });

  it.each(["PENDING_PAYMENT", "FAILED", "CANCELLED", "REFUNDED", "DISPUTED"] as const)("rejects a %s purchase", async (status) => {
    const w = revokeWorld({ status });
    await expect(w.useCase.execute(REVOKE_INPUT)).rejects.toMatchObject({ reason: "PURCHASE_NOT_CONFIRMED" });
    expect(w.revokeConfirmed).not.toHaveBeenCalled();
  });

  it("an already REVOKED purchase is delegated (idempotent no-op decided under the row lock)", async () => {
    const w = revokeWorld({ status: "REVOKED" });
    w.revokeConfirmed.mockResolvedValueOnce({ purchaseStatusBefore: "REVOKED", purchaseStatusAfter: "REVOKED", revoked: false, revocationId: null } as never);
    expect(await w.useCase.execute(REVOKE_INPUT)).toEqual({ leadPurchaseId: PURCHASE, status: "REVOKED", revoked: false });
  });

  it("unknown purchase, bad input and unauthorized actors are rejected before any write", async () => {
    await expect(revokeWorld({ status: null }).useCase.execute(REVOKE_INPUT)).rejects.toMatchObject({ reason: "PURCHASE_NOT_FOUND" });
    for (const bad of [{ explanation: "" }, { explanation: "x".repeat(1001) }, { evidenceReference: "" }, { leadPurchaseId: "nope" }, { actorUserId: "" }, { explanation: "mail me at a@b.com" }]) {
      const w = revokeWorld();
      await expect(w.useCase.execute({ ...REVOKE_INPUT, ...bad })).rejects.toMatchObject({ reason: "INVALID_INPUT" });
      expect(w.revokeConfirmed).not.toHaveBeenCalled();
    }
    for (const world of [
      revokeWorld({ actor: null }),
      revokeWorld({ actor: { status: "SUSPENDED", roles: ["ADMIN"] } }),
      revokeWorld({ actor: { status: "ACTIVE", roles: ["PROFESSIONAL"] } }),
      revokeWorld({ actor: { status: "ACTIVE", roles: [] } }),
      revokeWorld({ actorError: true }),
    ]) {
      await expect(world.useCase.execute(REVOKE_INPUT)).rejects.toMatchObject({ reason: "ACTOR_NOT_AUTHORIZED" });
      expect(world.revokeConfirmed).not.toHaveBeenCalled();
    }
    expect((await revokeWorld({ actor: { status: "ACTIVE", roles: ["SUPER_ADMIN"] } }).useCase.execute(REVOKE_INPUT)).revoked).toBe(true);
  });
});

// ------------------------------------------------------------------------------------------------ evidence

function disputeRecord(o: Partial<LeadFeeDisputeRecord> = {}): LeadFeeDisputeRecord {
  return {
    id: DISPUTE_ID, providerDisputeId: "dp_1", leadPurchaseId: PURCHASE, paymentReference: PI, providerChargeId: "ch_1", status: "NEEDS_RESPONSE",
    amount: "121.00", currency: "EUR", reason: "fraudulent", evidenceDueBy: null, openedAt: new Date(), closedAt: null, lastProviderEventId: "evt_1",
    lastProviderEventAt: new Date(), evidenceStatus: "NOT_SUBMITTED", evidenceReference: null, evidenceText: null, evidenceActorUserId: null,
    evidenceRequestedAt: null, evidenceSubmittedAt: null, createdAt: new Date(), updatedAt: new Date(), ...o,
  };
}

function evidenceWorld(o: { record?: Partial<LeadFeeDisputeRecord> | null; provider?: Partial<Awaited<ReturnType<LeadFeeDisputeGateway["retrieveDispute"]>>>; enabled?: boolean | "invalid"; submitError?: Error; retrieveError?: boolean } = {}) {
  let record = o.record === null ? null : disputeRecord(o.record);
  const disputes = {
    findById: vi.fn(async () => record),
    claimEvidenceSubmission: vi.fn(async (i: { evidenceText: string; evidenceReference: string; actorUserId: string }) => {
      record = { ...record!, evidenceStatus: "SUBMISSION_PENDING", evidenceText: i.evidenceText, evidenceReference: i.evidenceReference, evidenceActorUserId: i.actorUserId };
      return record;
    }),
    markEvidenceSubmitted: vi.fn(async (): Promise<LeadFeeDisputeRecord> => (record = { ...record!, evidenceStatus: "SUBMITTED" })),
    releaseEvidenceClaim: vi.fn(async () => (record = { ...record!, evidenceStatus: "NOT_SUBMITTED" })),
  };
  const gateway: LeadFeeDisputeGateway = {
    retrieveDispute: vi.fn(async () => {
      if (o.retrieveError) throw new Error("stripe down");
      return { providerDisputeId: "dp_1", paymentReference: PI, rawStatus: "needs_response", amountMinorUnits: 12100, currency: "eur", evidenceDueBy: null, pastDue: false, evidenceSubmissionCount: 0, ...o.provider };
    }),
    submitEvidence: vi.fn(async () => {
      if (o.submitError) throw o.submitError;
    }),
  } as never;
  const admins = { getUserById: vi.fn(async () => ({ id: ADMIN, status: "ACTIVE", roles: ["ADMIN"] })) } as never;
  const getConfig = () => (o.enabled === "invalid" ? ({ status: "INVALID" } as const) : ({ status: "VALID", submissionEnabled: o.enabled ?? true } as const));
  return { useCase: new SubmitLeadFeeDisputeEvidenceUseCase(disputes as never, gateway, admins, getConfig), disputes, gateway, get record() { return record; } };
}
const EVIDENCE_INPUT = { actorUserId: ADMIN, disputeId: DISPUTE_ID, evidenceText: "Service delivered; contact released after verified payment.", evidenceReference: "CASE-9" };

describe("M155 — evidence submission (switch-guarded, claim-before-call, fail closed)", () => {
  it("is blocked, with no provider call, when the switch is off or invalid", async () => {
    const off = evidenceWorld({ enabled: false });
    await expect(off.useCase.execute(EVIDENCE_INPUT)).rejects.toMatchObject({ reason: "SWITCH_DISABLED" });
    const bad = evidenceWorld({ enabled: "invalid" });
    await expect(bad.useCase.execute(EVIDENCE_INPUT)).rejects.toMatchObject({ reason: "CONFIG_INVALID" });
    for (const w of [off, bad]) {
      expect(w.gateway.retrieveDispute).not.toHaveBeenCalled();
      expect(w.gateway.submitEvidence).not.toHaveBeenCalled();
      expect(w.disputes.claimEvidenceSubmission).not.toHaveBeenCalled();
    }
  });

  it("claims BEFORE the provider call, sends the claimed text with the deterministic key, then marks SUBMITTED", async () => {
    const w = evidenceWorld();
    const order: string[] = [];
    w.disputes.claimEvidenceSubmission.mockImplementationOnce(async (i) => (order.push("claim"), { ...disputeRecord(), evidenceStatus: "SUBMISSION_PENDING", evidenceText: i.evidenceText } as never));
    (w.gateway.submitEvidence as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => void order.push("provider"));
    w.disputes.markEvidenceSubmitted.mockImplementationOnce(async () => (order.push("mark"), disputeRecord({ evidenceStatus: "SUBMITTED" })));
    expect(await w.useCase.execute(EVIDENCE_INPUT)).toEqual({ disputeId: DISPUTE_ID, evidenceStatus: "SUBMITTED" });
    expect(order).toEqual(["claim", "provider", "mark"]);
    expect(w.gateway.submitEvidence).toHaveBeenCalledWith({ providerDisputeId: "dp_1", evidenceText: EVIDENCE_INPUT.evidenceText, leadFeeDisputeId: DISPUTE_ID, idempotencyKey: `lead-fee-dispute-evidence:${DISPUTE_ID}` });
  });

  it("refuses non-open disputes, past-due, wrong payment, non-response statuses and a failing provider read", async () => {
    await expect(evidenceWorld({ record: { status: "UNDER_REVIEW" } }).useCase.execute(EVIDENCE_INPUT)).rejects.toMatchObject({ reason: "EVIDENCE_NOT_ALLOWED" });
    await expect(evidenceWorld({ record: { status: "LOST" } }).useCase.execute(EVIDENCE_INPUT)).rejects.toMatchObject({ reason: "EVIDENCE_NOT_ALLOWED" });
    await expect(evidenceWorld({ record: null }).useCase.execute(EVIDENCE_INPUT)).rejects.toMatchObject({ reason: "DISPUTE_NOT_FOUND" });
    await expect(evidenceWorld({ provider: { pastDue: true } }).useCase.execute(EVIDENCE_INPUT)).rejects.toMatchObject({ reason: "EVIDENCE_NOT_ALLOWED" });
    await expect(evidenceWorld({ provider: { rawStatus: "under_review" } }).useCase.execute(EVIDENCE_INPUT)).rejects.toMatchObject({ reason: "EVIDENCE_NOT_ALLOWED" });
    await expect(evidenceWorld({ provider: { paymentReference: "pi_other" } }).useCase.execute(EVIDENCE_INPUT)).rejects.toMatchObject({ reason: "PROVIDER_MISMATCH" });
    const down = evidenceWorld({ retrieveError: true });
    await expect(down.useCase.execute(EVIDENCE_INPUT)).rejects.toMatchObject({ reason: "PROVIDER_UNAVAILABLE" });
    expect(down.disputes.claimEvidenceSubmission).not.toHaveBeenCalled();
  });

  it("an already SUBMITTED dispute is an idempotent no-op", async () => {
    const w = evidenceWorld({ record: { evidenceStatus: "SUBMITTED" } });
    expect(await w.useCase.execute(EVIDENCE_INPUT)).toEqual({ disputeId: DISPUTE_ID, evidenceStatus: "SUBMITTED" });
    expect(w.gateway.submitEvidence).not.toHaveBeenCalled();
  });

  it("a DEFINITIVE provider rejection releases the claim for a controlled retry", async () => {
    const w = evidenceWorld({ submitError: new PaymentGatewayError("INVALID_REQUEST", "bad", false) });
    await expect(w.useCase.execute(EVIDENCE_INPUT)).rejects.toMatchObject({ reason: "PROVIDER_MISMATCH" });
    expect(w.disputes.releaseEvidenceClaim).toHaveBeenCalledTimes(1);
    expect(w.disputes.markEvidenceSubmitted).not.toHaveBeenCalled();
  });

  it("an UNKNOWN outcome leaves the claim PENDING; the re-run reads the provider and never re-sends if it was received", async () => {
    const w = evidenceWorld({ submitError: new PaymentGatewayError("NETWORK", "timeout", true) });
    expect(await w.useCase.execute(EVIDENCE_INPUT)).toEqual({ disputeId: DISPUTE_ID, evidenceStatus: "SUBMISSION_PENDING" });
    expect(w.disputes.releaseEvidenceClaim).not.toHaveBeenCalled();
    expect(w.disputes.markEvidenceSubmitted).not.toHaveBeenCalled();

    const rerun = evidenceWorld({ record: { evidenceStatus: "SUBMISSION_PENDING", evidenceText: "x", evidenceActorUserId: ADMIN }, provider: { evidenceSubmissionCount: 1 } });
    expect(await rerun.useCase.execute(EVIDENCE_INPUT)).toEqual({ disputeId: DISPUTE_ID, evidenceStatus: "SUBMITTED" });
    expect(rerun.gateway.submitEvidence).not.toHaveBeenCalled();

    const replay = evidenceWorld({ record: { evidenceStatus: "SUBMISSION_PENDING", evidenceText: "the claimed text", evidenceActorUserId: ADMIN } });
    await replay.useCase.execute({ ...EVIDENCE_INPUT, evidenceText: "a different retry text" });
    expect(replay.gateway.submitEvidence).toHaveBeenCalledWith(expect.objectContaining({ evidenceText: "the claimed text" }));
    expect(replay.disputes.claimEvidenceSubmission).not.toHaveBeenCalled();
  });

  it("requires an authorized admin and valid input before anything else", async () => {
    const w = evidenceWorld();
    (w.useCase as unknown as { admins: { getUserById: ReturnType<typeof vi.fn> } }).admins.getUserById.mockResolvedValueOnce({ id: ADMIN, status: "ACTIVE", roles: ["CUSTOMER"] });
    await expect(w.useCase.execute(EVIDENCE_INPUT)).rejects.toMatchObject({ reason: "ACTOR_NOT_AUTHORIZED" });
    await expect(evidenceWorld().useCase.execute({ ...EVIDENCE_INPUT, evidenceText: "" })).rejects.toMatchObject({ reason: "INVALID_INPUT" });
    await expect(evidenceWorld().useCase.execute({ ...EVIDENCE_INPUT, disputeId: "x" })).rejects.toMatchObject({ reason: "INVALID_INPUT" });
  });
});
