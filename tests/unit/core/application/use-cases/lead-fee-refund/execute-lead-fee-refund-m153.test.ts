import { beforeEach, describe, expect, it, vi } from "vitest";

import { ExecuteLeadFeeRefundUseCase, type ExecuteLeadFeeRefundInput } from "@/application/use-cases/lead-fee-refund/execute-lead-fee-refund.use-case";
import { PaymentGatewayError } from "@/domain/errors/domain-error";
import { LeadPurchaseRefunded } from "@/domain/events/lead-purchase-refunded";
import type { AdminUserRecord } from "@/domain/repositories/admin-repository";
import type { LeadPurchaseRecord } from "@/domain/repositories/lead-purchase-repository";
import { LeadFeeRefundRejectedError, resolveLeadFeeRefundConfig, type LeadFeeRefundConfig } from "@/domain/services/lead-fee-refund";
import type { LeadPurchaseStatus } from "@/domain/services/lead-purchase";

import { FakeLeadFeePaymentGateway } from "../../../../../test-utils/fake-lead-fee-payment-gateway";
import { FakeLeadFeeRefundRepository } from "../../../../../test-utils/fake-lead-fee-refund-repository";
import { SNAPSHOT_DATA } from "../../../../../test-utils/lead-publication-fixtures";
import { pendingPurchaseFromPublication } from "../../../../../test-utils/lead-purchase-fixtures";

vi.mock("@/infrastructure/observability/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PURCHASE = "55555555-5555-4555-8555-555555555555";
const LEAD = "11111111-1111-4111-8111-111111111111";
const PRO = "33333333-3333-4333-8333-333333333333";
const ORIGINAL = "pi_original";
const EXTRA = "pi_extra";
const ENABLED = resolveLeadFeeRefundConfig({ LEAD_FEE_REFUND_REAL_REFUNDS_ENABLED: "true" });

function adminRecord(patch: Partial<AdminUserRecord> = {}): AdminUserRecord {
  return { id: ADMIN, name: null, email: null, phone: null, status: "ACTIVE", roles: ["ADMIN"], hasProfessionalProfile: false, lastLoginAt: null, createdAt: new Date(), ...patch };
}

function world(opts: { config?: LeadFeeRefundConfig; actor?: AdminUserRecord | null | Error; status?: LeadPurchaseStatus; mutate?: (p: LeadPurchaseRecord) => LeadPurchaseRecord } = {}) {
  let purchase: LeadPurchaseRecord = {
    ...pendingPurchaseFromPublication(PURCHASE, LEAD, PRO, { ...SNAPSHOT_DATA, publishedAt: new Date("2026-10-01T00:00:00Z"), price: "100.00" }),
    status: opts.status ?? "CONFIRMED",
    paymentReference: ORIGINAL,
    confirmedAt: new Date("2026-10-02T00:00:00Z"),
  };
  if (opts.mutate) purchase = opts.mutate(purchase);
  const total = Math.round(Number(purchase.financialSnapshot.totalAmount) * 100);
  const gateway = new FakeLeadFeePaymentGateway();
  gateway.plantPayment(ORIGINAL, { leadPurchaseId: PURCHASE, amountMinorUnits: total });
  const refunds = new FakeLeadFeeRefundRepository();
  const purchases = {
    findById: vi.fn(async (id: string) => (id === purchase.id ? structuredClone(purchase) : null)),
    findByPaymentReference: vi.fn(async (ref: string) => (ref === purchase.paymentReference ? structuredClone(purchase) : null)),
  };
  const admins = {
    getUserById: vi.fn(async () => {
      if (opts.actor instanceof Error) throw opts.actor;
      return opts.actor === undefined ? adminRecord() : opts.actor;
    }),
  };
  const transitioner = {
    execute: vi.fn(async (_id: string, target: LeadPurchaseStatus) => {
      purchase = { ...purchase, status: target };
    }),
  };
  const events = { publish: vi.fn(async () => undefined) };
  const useCase = new ExecuteLeadFeeRefundUseCase(purchases, refunds, gateway, admins, transitioner, () => opts.config ?? ENABLED, events);
  return { useCase, gateway, refunds, purchases, admins, transitioner, events, total, current: () => purchase };
}

const platform = (patch: Partial<ExecuteLeadFeeRefundInput> = {}): ExecuteLeadFeeRefundInput => ({
  actorUserId: ADMIN,
  leadPurchaseId: PURCHASE,
  reasonCode: "PLATFORM_ERROR",
  explanation: "  A MaestroYa defect made the paid lead unusable.  ",
  evidenceReference: "INC-1042",
  ...patch,
});
const duplicate = (patch: Partial<ExecuteLeadFeeRefundInput> = {}): ExecuteLeadFeeRefundInput =>
  platform({ reasonCode: "DUPLICATE_CHARGE", duplicatePaymentReference: EXTRA, ...patch });

async function rejection(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(LeadFeeRefundRejectedError);
  return (error as LeadFeeRefundRejectedError).reason;
}

describe("ExecuteLeadFeeRefundUseCase (Module 153)", () => {
  describe("PLATFORM_ERROR happy path", () => {
    it("refunds exactly the snapshot total once, moves CONFIRMED -> REFUNDED after provider confirmation and raises the id-only event", async () => {
      const w = world();
      const result = await w.useCase.execute(platform());
      expect(result).toMatchObject({ status: "SUCCEEDED", purchaseStatus: "REFUNDED", reasonCode: "PLATFORM_ERROR", attemptNumber: 1, newAttempt: true, purchaseTransitionPending: false, refundedPaymentReference: ORIGINAL });
      expect(w.gateway.refundRequests).toHaveLength(1);
      expect(w.gateway.refundRequests[0]).toMatchObject({ paymentReference: ORIGINAL, amountMinorUnits: w.total, currency: "EUR", idempotencyKey: `lead-fee-refund:${ORIGINAL}:1`, leadPurchaseId: PURCHASE });
      expect(w.gateway.refundRequests[0]!.refundRecordId).toBe(w.refunds.rows[0]!.id);
      expect(w.transitioner.execute).toHaveBeenCalledWith(PURCHASE, "REFUNDED");
      expect(w.events.publish).toHaveBeenCalledTimes(1);
      const event = (w.events.publish.mock.calls[0] as unknown[])[0] as LeadPurchaseRefunded;
      expect(event).toBeInstanceOf(LeadPurchaseRefunded);
      expect(Object.keys(event).filter((k) => !["id", "occurredAt", "eventId"].includes(k))).toEqual(["purchaseId"]);
      const row = w.refunds.rows[0]!;
      expect(row).toMatchObject({ status: "SUCCEEDED", amount: w.current().financialSnapshot.totalAmount, explanation: "A MaestroYa defect made the paid lead unusable.", evidenceReference: "INC-1042", actorUserId: ADMIN, providerRefundId: "re_fake_1" });
      expect(row.purchaseTransitionedAt).toBeInstanceOf(Date);
    });

    it("a repeated run after success sends nothing, changes nothing and raises no second event", async () => {
      const w = world();
      await w.useCase.execute(platform());
      const again = await w.useCase.execute(platform());
      expect(again).toMatchObject({ status: "SUCCEEDED", newAttempt: false });
      expect(w.gateway.refundRequests).toHaveLength(1);
      expect(w.refunds.rows).toHaveLength(1);
      expect(w.events.publish).toHaveBeenCalledTimes(1);
    });
  });

  describe("fail-closed gates (nothing is sent to the provider)", () => {
    it.each([
      ["disabled by default", resolveLeadFeeRefundConfig({}), "SWITCH_DISABLED"],
      ["explicitly false", resolveLeadFeeRefundConfig({ LEAD_FEE_REFUND_REAL_REFUNDS_ENABLED: "false" }), "SWITCH_DISABLED"],
      ["malformed", resolveLeadFeeRefundConfig({ LEAD_FEE_REFUND_REAL_REFUNDS_ENABLED: "yes" }), "CONFIG_INVALID"],
      ["automatic without master", resolveLeadFeeRefundConfig({ LEAD_FEE_REFUND_AUTOMATIC_TECHNICAL_ENABLED: "true" }), "CONFIG_INVALID"],
    ] as const)("switch %s", async (_label, config, expected) => {
      const w = world({ config });
      expect(await rejection(w.useCase.execute(platform()))).toBe(expected);
      expect(w.gateway.refundRequests).toHaveLength(0);
      expect(w.refunds.rows).toHaveLength(0);
      expect(w.admins.getUserById).not.toHaveBeenCalled();
    });

    it.each([
      ["missing user", null],
      ["no roles", adminRecord({ roles: [] })],
      ["a customer", adminRecord({ roles: ["CUSTOMER"] })],
      ["a professional", adminRecord({ roles: ["PROFESSIONAL"] })],
      ["suspended admin", adminRecord({ status: "SUSPENDED" })],
      ["banned super admin", adminRecord({ status: "BANNED", roles: ["SUPER_ADMIN"] })],
      ["repository failure", new Error("db down")],
    ])("rejects an unauthorized actor: %s", async (_label, actor) => {
      const w = world({ actor });
      expect(await rejection(w.useCase.execute(platform()))).toBe("ACTOR_NOT_AUTHORIZED");
      expect(w.gateway.refundRequests).toHaveLength(0);
      expect(w.refunds.rows).toHaveLength(0);
    });

    it.each(["ADMIN", "SUPER_ADMIN"])("accepts an ACTIVE %s", async (role) => {
      const w = world({ actor: adminRecord({ roles: [role] }) });
      expect((await w.useCase.execute(platform())).status).toBe("SUCCEEDED");
    });

    it.each([
      ["unsupported reason CLAIM_APPROVED", { reasonCode: "CLAIM_APPROVED" as never }],
      ["unsupported reason UNFULFILLABLE_PAYMENT", { reasonCode: "UNFULFILLABLE_PAYMENT" as never }],
      ["empty explanation", { explanation: "   " }],
      ["too long explanation", { explanation: "x".repeat(1001) }],
      ["email in explanation", { explanation: "write to ana@example.com" }],
      ["empty evidence reference", { evidenceReference: " " }],
      ["duplicate reference on a PLATFORM_ERROR", { duplicatePaymentReference: EXTRA }],
      ["blank actor", { actorUserId: " " }],
    ])("rejects invalid input: %s", async (_label, patch) => {
      const w = world();
      expect(await rejection(w.useCase.execute(platform(patch)))).toBe("INVALID_INPUT");
      expect(w.gateway.refundRequests).toHaveLength(0);
    });

    it("unknown purchase / not CONFIRMED / no payment reference / broken snapshot", async () => {
      expect(await rejection(world().useCase.execute(platform({ leadPurchaseId: "nope" })))).toBe("PURCHASE_NOT_FOUND");
      for (const status of ["PENDING_PAYMENT", "REFUNDED", "REVOKED", "FAILED", "CANCELLED"] as const) {
        const w = world({ status });
        expect(await rejection(w.useCase.execute(platform()))).toBe("PURCHASE_NOT_CONFIRMED");
        expect(w.gateway.refundRequests).toHaveLength(0);
      }
      expect(await rejection(world({ mutate: (p) => ({ ...p, paymentReference: null }) }).useCase.execute(platform()))).toBe("PAYMENT_REFERENCE_MISSING");
      const broken = world({ mutate: (p) => ({ ...p, financialSnapshot: { ...p.financialSnapshot, totalAmount: null } }) });
      expect(await rejection(broken.useCase.execute(platform()))).toBe("SNAPSHOT_INVALID");
      expect(broken.gateway.refundRequests).toHaveLength(0);
    });

    it.each([
      ["amount differs from the snapshot", { amountMinorUnits: 5000 }, "AMOUNT_MISMATCH"],
      ["received amount differs", { amountReceivedMinorUnits: 1 }, "AMOUNT_MISMATCH"],
      ["currency differs", { currency: "USD" }, "CURRENCY_MISMATCH"],
      ["payment not succeeded", { status: "PROCESSING" as const }, "PAYMENT_NOT_SUCCEEDED"],
      ["payment belongs to another purchase", { purchaseId: "someone-else" }, "PAYMENT_NOT_ASSOCIATED"],
      ["payment has no purchase metadata", { purchaseId: null }, "PAYMENT_NOT_ASSOCIATED"],
      ["open dispute", { disputed: true }, "PAYMENT_DISPUTED"],
      ["partially refunded (dashboard)", { amountRefundedMinorUnits: 500 }, "ALREADY_REFUNDED"],
      ["fully refunded (dashboard)", { amountRefundedMinorUnits: 99999, refunded: true }, "ALREADY_REFUNDED"],
    ])("provider state: %s", async (_label, override, expected) => {
      const w = world();
      w.gateway.factOverrides.set(ORIGINAL, { ...(w.gateway.factOverrides.get(ORIGINAL) ?? {}), ...override });
      expect(await rejection(w.useCase.execute(platform()))).toBe(expected);
      expect(w.gateway.refundRequests).toHaveLength(0);
      expect(w.refunds.rows).toHaveLength(0);
    });

    it("a refund that already exists at the provider (listing) blocks; an unrecognized one or an unreadable listing fails closed", async () => {
      const w = world();
      w.gateway.refundsByPayment.set(ORIGINAL, [{ reference: "re_ext", paymentReference: ORIGINAL, status: "SUCCEEDED", amountMinorUnits: 1, currency: "EUR", refundRecordId: null }]);
      expect(await rejection(w.useCase.execute(platform()))).toBe("ALREADY_REFUNDED");

      const unrec = world();
      unrec.gateway.refundsByPayment.set(ORIGINAL, [{ reference: "re_x", paymentReference: ORIGINAL, status: "UNRECOGNIZED", amountMinorUnits: 1, currency: "EUR", refundRecordId: null }]);
      expect(await rejection(unrec.useCase.execute(platform()))).toBe("PROVIDER_STATE_UNVERIFIABLE");

      const noList = world();
      noList.gateway.failList = new Error("boom");
      expect(await rejection(noList.useCase.execute(platform()))).toBe("PROVIDER_STATE_UNVERIFIABLE");

      const noFacts = world();
      noFacts.gateway.failFacts = new Error("boom");
      expect(await rejection(noFacts.useCase.execute(platform()))).toBe("PROVIDER_STATE_UNVERIFIABLE");
      for (const x of [w, unrec, noList, noFacts]) expect(x.gateway.refundRequests).toHaveLength(0);
    });
  });

  describe("provider outcomes", () => {
    it("a definitive rejection is FAILED (purchase untouched, no event); an explicit admin re-run makes a NEW attempt with a NEW key and keeps the history", async () => {
      const w = world();
      w.gateway.failRefundBeforeProvider = new PaymentGatewayError("INVALID_REQUEST", "rejected", false);
      const failed = await w.useCase.execute(platform());
      expect(failed).toMatchObject({ status: "FAILED", purchaseStatus: "CONFIRMED", attemptNumber: 1 });
      expect(w.refunds.rows[0]!.failureCategory).toBe("INVALID_REQUEST");
      expect(w.events.publish).not.toHaveBeenCalled();

      w.gateway.failRefundBeforeProvider = null;
      const retried = await w.useCase.execute(platform());
      expect(retried).toMatchObject({ status: "SUCCEEDED", attemptNumber: 2, purchaseStatus: "REFUNDED", newAttempt: true });
      expect(w.refunds.rows.map((r) => [r.attemptNumber, r.status, r.idempotencyKey])).toEqual([
        [1, "FAILED", `lead-fee-refund:${ORIGINAL}:1`],
        [2, "SUCCEEDED", `lead-fee-refund:${ORIGINAL}:2`],
      ]);
    });

    it("a timeout after the provider created the refund is UNKNOWN; the re-run reconciles by listing and NEVER sends a second request", async () => {
      const w = world();
      w.gateway.failRefundAfterProvider = new PaymentGatewayError("NETWORK", "timeout", true);
      const first = await w.useCase.execute(platform());
      expect(first).toMatchObject({ status: "UNKNOWN", purchaseStatus: "CONFIRMED" });
      expect(w.events.publish).not.toHaveBeenCalled();
      expect(w.transitioner.execute).not.toHaveBeenCalled();

      w.gateway.failRefundAfterProvider = null;
      const second = await w.useCase.execute(platform());
      expect(second).toMatchObject({ status: "SUCCEEDED", purchaseStatus: "REFUNDED", newAttempt: false, providerRefundId: "re_fake_1" });
      expect(w.gateway.refundRequests).toHaveLength(1);
      expect(w.events.publish).toHaveBeenCalledTimes(1);
    });

    it("a timeout where the provider never got the request stays UNKNOWN forever (no match = no failure), with no replay and no new attempt", async () => {
      const w = world();
      w.gateway.failRefundBeforeProvider = new PaymentGatewayError("NETWORK", "timeout", true);
      expect((await w.useCase.execute(platform())).status).toBe("UNKNOWN");
      w.gateway.failRefundBeforeProvider = null;
      for (let i = 0; i < 3; i += 1) expect((await w.useCase.execute(platform())).status).toBe("UNKNOWN");
      expect(w.gateway.refundRequests).toHaveLength(1);
      expect(w.refunds.rows).toHaveLength(1);
    });

    it("a local exception after the provider call (status write fails) leaves the attempt unresolved and is reconciled on re-run without replay", async () => {
      const w = world();
      w.refunds.failUpdate = new Error("db write failed");
      await expect(w.useCase.execute(platform())).rejects.toThrow("db write failed");
      expect(w.refunds.rows[0]!.status).toBe("REQUESTED");
      w.refunds.failUpdate = null;
      const again = await w.useCase.execute(platform());
      expect(again.status).toBe("SUCCEEDED");
      expect(w.gateway.refundRequests).toHaveLength(1);
    });

    it("an unreadable listing during reconciliation leaves the attempt unresolved", async () => {
      const w = world();
      w.gateway.failRefundAfterProvider = new PaymentGatewayError("TEMPORARY", "5xx", true);
      await w.useCase.execute(platform());
      w.gateway.failList = new Error("down");
      const res = await w.useCase.execute(platform());
      expect(res.status).toBe("UNKNOWN");
      expect(w.gateway.refundRequests).toHaveLength(1);
    });

    it("a pending refund keeps access/status unchanged until the provider confirms; then it completes", async () => {
      const w = world();
      w.gateway.newRefundStatus = "PENDING";
      const pending = await w.useCase.execute(platform());
      expect(pending).toMatchObject({ status: "PROVIDER_PENDING", purchaseStatus: "CONFIRMED" });
      expect(w.transitioner.execute).not.toHaveBeenCalled();
      expect(w.events.publish).not.toHaveBeenCalled();
      expect((await w.useCase.execute(platform())).status).toBe("PROVIDER_PENDING");

      w.gateway.setRefundStatus("re_fake_1", "SUCCEEDED");
      const done = await w.useCase.execute(platform());
      expect(done).toMatchObject({ status: "SUCCEEDED", purchaseStatus: "REFUNDED" });
      expect(w.gateway.refundRequests).toHaveLength(1);
      expect(w.events.publish).toHaveBeenCalledTimes(1);
    });

    it("a provider-reported failed/cancelled refund is FAILED; an unrecognized status stays unresolved", async () => {
      for (const [status, category] of [["FAILED", "PROVIDER_FAILED"], ["CANCELED", "PROVIDER_CANCELED"]] as const) {
        const w = world();
        w.gateway.newRefundStatus = status;
        const res = await w.useCase.execute(platform());
        expect(res.status).toBe("FAILED");
        expect(w.refunds.rows[0]!.failureCategory).toBe(category);
        expect(w.transitioner.execute).not.toHaveBeenCalled();
      }
      const w = world();
      w.gateway.newRefundStatus = "UNRECOGNIZED";
      expect((await w.useCase.execute(platform())).status).toBe("UNKNOWN");
      expect(w.transitioner.execute).not.toHaveBeenCalled();
    });

    it("a provider answer that does not match the attempt (amount) is never trusted", async () => {
      const w = world();
      const original = w.gateway.createRefund.bind(w.gateway);
      w.gateway.createRefund = async (request) => ({ ...(await original(request)), amountMinorUnits: request.amountMinorUnits - 1 });
      const res = await w.useCase.execute(platform());
      expect(res.status).toBe("UNKNOWN");
      expect(w.transitioner.execute).not.toHaveBeenCalled();
    });

    it("the purchase transition failing after a confirmed refund keeps the refund SUCCEEDED, reports it, and a re-run completes it without a second refund", async () => {
      const w = world();
      w.transitioner.execute.mockRejectedValueOnce(new Error("db"));
      const first = await w.useCase.execute(platform());
      expect(first).toMatchObject({ status: "SUCCEEDED", purchaseStatus: "CONFIRMED", purchaseTransitionPending: true });
      expect(w.events.publish).not.toHaveBeenCalled();
      const second = await w.useCase.execute(platform());
      expect(second).toMatchObject({ status: "SUCCEEDED", purchaseStatus: "REFUNDED", purchaseTransitionPending: false });
      expect(w.gateway.refundRequests).toHaveLength(1);
      expect(w.events.publish).toHaveBeenCalledTimes(1);
    });

    it("an event publish failure never reverses the refund", async () => {
      const w = world();
      w.events.publish.mockRejectedValueOnce(new Error("bus down"));
      const res = await w.useCase.execute(platform());
      expect(res).toMatchObject({ status: "SUCCEEDED", purchaseStatus: "REFUNDED" });
    });

    it("concurrent executions race on the one-active-attempt rule: exactly one provider request", async () => {
      const w = world();
      const settled = await Promise.allSettled([w.useCase.execute(platform()), w.useCase.execute(platform())]);
      expect(w.gateway.refundRequests).toHaveLength(1);
      expect(w.refunds.rows).toHaveLength(1);
      const rejected = settled.filter((s) => s.status === "rejected") as PromiseRejectedResult[];
      for (const r of rejected) expect((r.reason as LeadFeeRefundRejectedError).reason).toBe("ATTEMPT_IN_PROGRESS");
      expect(settled.some((s) => s.status === "fulfilled")).toBe(true);
    });
  });

  describe("DUPLICATE_CHARGE", () => {
    const withExtra = (w: ReturnType<typeof world>, patch: Parameters<FakeLeadFeePaymentGateway["plantPayment"]>[1] extends infer T ? Partial<T> : never = {}) =>
      w.gateway.plantPayment(EXTRA, { leadPurchaseId: PURCHASE, amountMinorUnits: w.total, ...patch });

    it("refunds the EXTRA payment in full; the purchase stays CONFIRMED, is never transitioned and no event is raised", async () => {
      const w = world();
      withExtra(w);
      const res = await w.useCase.execute(duplicate());
      expect(res).toMatchObject({ status: "SUCCEEDED", purchaseStatus: "CONFIRMED", reasonCode: "DUPLICATE_CHARGE", refundedPaymentReference: EXTRA });
      expect(w.gateway.refundRequests).toEqual([expect.objectContaining({ paymentReference: EXTRA, amountMinorUnits: w.total, idempotencyKey: `lead-fee-refund:${EXTRA}:1` })]);
      expect(w.transitioner.execute).not.toHaveBeenCalled();
      expect(w.events.publish).not.toHaveBeenCalled();
      expect(w.refunds.rows[0]!.purchaseTransitionedAt).toBeNull();
      expect(w.refunds.rows[0]!.purchasePaymentReference).toBe(ORIGINAL);
      // the original payment is never refunded
      expect(w.gateway.refundRequests.some((r) => r.paymentReference === ORIGINAL)).toBe(false);
    });

    it("requires the extra reference and refuses the purchase's own payment", async () => {
      const w = world();
      withExtra(w);
      expect(await rejection(w.useCase.execute(platform({ reasonCode: "DUPLICATE_CHARGE" })))).toBe("DUPLICATE_REFERENCE_REQUIRED");
      expect(await rejection(w.useCase.execute(duplicate({ duplicatePaymentReference: ORIGINAL })))).toBe("DUPLICATE_REFERENCE_SAME_AS_PURCHASE");
      expect(w.gateway.refundRequests).toHaveLength(0);
    });

    it("refuses an extra payment that is another purchase's own payment", async () => {
      const w = world();
      withExtra(w);
      w.purchases.findByPaymentReference.mockImplementation(async () => ({ ...w.current(), id: "other-purchase" }));
      expect(await rejection(w.useCase.execute(duplicate()))).toBe("DUPLICATE_REFERENCE_CONFLICT");
    });

    it.each([
      ["metadata names another purchase", { leadPurchaseId: "other" }, "PAYMENT_NOT_ASSOCIATED"],
      ["metadata names no purchase", { leadPurchaseId: null }, "PAYMENT_NOT_ASSOCIATED"],
      ["amount differs", { amountMinorUnits: 100 }, "AMOUNT_MISMATCH"],
      ["currency differs", { currency: "USD" }, "CURRENCY_MISMATCH"],
      ["extra payment not succeeded", { status: "PROCESSING" as const }, "PAYMENT_NOT_SUCCEEDED"],
    ])("extra payment: %s", async (_label, patch, expected) => {
      const w = world();
      withExtra(w, patch);
      expect(await rejection(w.useCase.execute(duplicate()))).toBe(expected);
      expect(w.gateway.refundRequests).toHaveLength(0);
    });

    it("extra payment already refunded / disputed, or unknown at the provider, fails closed", async () => {
      const refunded = world();
      withExtra(refunded);
      refunded.gateway.factOverrides.set(EXTRA, { ...refunded.gateway.factOverrides.get(EXTRA), amountRefundedMinorUnits: 100 });
      expect(await rejection(refunded.useCase.execute(duplicate()))).toBe("ALREADY_REFUNDED");

      const listed = world();
      withExtra(listed);
      listed.gateway.refundsByPayment.set(EXTRA, [{ reference: "re_ext", paymentReference: EXTRA, status: "PENDING", amountMinorUnits: 1, currency: "EUR", refundRecordId: null }]);
      expect(await rejection(listed.useCase.execute(duplicate()))).toBe("ALREADY_REFUNDED");

      const disputed = world();
      withExtra(disputed);
      disputed.gateway.factOverrides.set(EXTRA, { ...disputed.gateway.factOverrides.get(EXTRA), disputed: true });
      expect(await rejection(disputed.useCase.execute(duplicate()))).toBe("PAYMENT_DISPUTED");

      const missing = world();
      expect(await rejection(missing.useCase.execute(duplicate()))).toBe("PROVIDER_STATE_UNVERIFIABLE");
    });

    it("the ORIGINAL payment must be succeeded, unrefunded and undisputed", async () => {
      for (const [override, expected] of [
        [{ amountRefundedMinorUnits: 100 }, "ALREADY_REFUNDED"],
        [{ disputed: true }, "PAYMENT_DISPUTED"],
        [{ status: "PROCESSING" }, "PAYMENT_NOT_SUCCEEDED"],
      ] as const) {
        const w = world();
        withExtra(w);
        if ("status" in override) w.gateway.payments.set(ORIGINAL, { ...w.gateway.payments.get(ORIGINAL)!, status: "PROCESSING" });
        else w.gateway.factOverrides.set(ORIGINAL, { ...w.gateway.factOverrides.get(ORIGINAL), ...override });
        expect(await rejection(w.useCase.execute(duplicate()))).toBe(expected);
        expect(w.gateway.refundRequests).toHaveLength(0);
      }
    });

    it("an attempt on the same extra payment for a different purchase or reason is a conflict", async () => {
      const w = world();
      withExtra(w);
      await w.useCase.execute(duplicate());
      w.refunds.rows[0]!.leadPurchaseId = "another";
      expect(await rejection(w.useCase.execute(duplicate()))).toBe("DUPLICATE_REFERENCE_CONFLICT");
    });
  });

  beforeEach(() => vi.clearAllMocks());
});
