import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as TaxPolicyModule from "@/domain/services/lead-fee-tax-policy";
import type * as LeadPricingModule from "@/domain/services/lead-pricing";
import type * as JobValueModule from "@/domain/services/job-value-estimation";

import { InitiateLeadFeePaymentUseCase } from "@/application/use-cases/lead-fee-payment/initiate-lead-fee-payment.use-case";
import { PaymentGatewayError } from "@/domain/errors/domain-error";
import type { LeadPurchaseRecord, LeadPurchaseRepository } from "@/domain/repositories/lead-purchase-repository";
import type { LeadRepository } from "@/domain/repositories/lead-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import { LeadFeePaymentNotInitiableError, LeadFeePaymentUnavailableError } from "@/domain/services/lead-fee-payment";
import { LEAD_PURCHASE_STATUSES, type LeadPurchaseStatus } from "@/domain/services/lead-purchase";

import { SNAPSHOT_DATA } from "../../../../../test-utils/lead-publication-fixtures";
import { pendingPurchaseFromPublication } from "../../../../../test-utils/lead-purchase-fixtures";
import { FakeLeadFeePaymentGateway } from "../../../../../test-utils/fake-lead-fee-payment-gateway";
import {
  M139_SECRET_ADDRESS,
  M139_SECRET_EMAIL,
  M139_SECRET_NAME,
  M139_SECRET_PHONE,
  M139_SECRET_POSTAL_CODE,
  assertNoContactLeak,
} from "../../../../../test-utils/contact-leak-sentinels";

vi.mock("@/infrastructure/observability/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
// The tax and pricing engines must never run at payment time: spy on them (behaviour unchanged).
vi.mock("@/domain/services/lead-fee-tax-policy", async (importActual) => {
  const actual = await importActual<typeof TaxPolicyModule>();
  return { ...actual, computeLeadFeeTax: vi.fn(actual.computeLeadFeeTax) };
});
vi.mock("@/domain/services/lead-pricing", async (importActual) => {
  const actual = await importActual<typeof LeadPricingModule>();
  return { ...actual, calculateLeadPrice: vi.fn(actual.calculateLeadPrice) };
});
vi.mock("@/domain/services/job-value-estimation", async (importActual) => {
  const actual = await importActual<typeof JobValueModule>();
  return { ...actual, estimateJobValue: vi.fn(actual.estimateJobValue) };
});

import { computeLeadFeeTax } from "@/domain/services/lead-fee-tax-policy";
import { calculateLeadPrice } from "@/domain/services/lead-pricing";
import { estimateJobValue } from "@/domain/services/job-value-estimation";

const USER_A = "22222222-2222-4222-8222-222222222222";
const USER_B = "77777777-7777-4777-8777-777777777777";
const PRO_A = "33333333-3333-4333-8333-333333333333";
const PRO_B = "44444444-4444-4444-8444-444444444444";
const LEAD = "11111111-1111-4111-8111-111111111111";
const PURCHASE = "55555555-5555-4555-8555-555555555555";
const PUBLICATION = { ...SNAPSHOT_DATA, publishedAt: new Date("2026-10-01T00:00:00Z") };

function world(opts: { purchase?: LeadPurchaseRecord | null; flow?: "LEAD_V1" | "LEGACY_QUOTE_PAYMENT"; proStatus?: string; verification?: string; price?: string } = {}) {
  let purchase: LeadPurchaseRecord | null =
    opts.purchase === undefined ? pendingPurchaseFromPublication(PURCHASE, LEAD, PRO_A, { ...PUBLICATION, price: opts.price ?? "100.00" }) : opts.purchase;
  const snapshotBefore = purchase ? JSON.stringify(purchase.financialSnapshot) : "";
  const writes: string[] = [];

  const purchases = {
    findById: vi.fn(async (id: string) => (purchase && purchase.id === id ? structuredClone(purchase) : null)),
    recordPaymentReference: vi.fn(async (id: string, reference: string) => {
      if (!purchase || purchase.id !== id || purchase.status !== "PENDING_PAYMENT" || purchase.paymentReference !== null) return null;
      purchase = { ...purchase, paymentReference: reference };
      writes.push("paymentReference");
      return structuredClone(purchase);
    }),
    transition: vi.fn(),
    initiate: vi.fn(),
    create: vi.fn(),
    findActiveByLeadAndProfessional: vi.fn(),
    findConfirmedByLeadAndProfessional: vi.fn(),
  } as unknown as LeadPurchaseRepository;
  const professionals = {
    findByUserId: vi.fn(async (userId: string) =>
      userId === USER_A
        ? { id: PRO_A, status: opts.proStatus ?? "ACTIVE", verificationStatus: opts.verification ?? "VERIFIED" }
        : userId === USER_B
          ? { id: PRO_B, status: "ACTIVE", verificationStatus: "VERIFIED" }
          : null,
    ),
  } as unknown as ProfessionalRepository;
  const leads = { findById: vi.fn(async () => ({ id: LEAD, flowVersion: opts.flow ?? "LEAD_V1" })) } as unknown as LeadRepository;
  const gateway = new FakeLeadFeePaymentGateway();
  const useCase = new InitiateLeadFeePaymentUseCase(professionals, purchases, leads, gateway);
  return {
    useCase,
    gateway,
    purchases,
    writes,
    current: () => purchase,
    setStatus: (status: LeadPurchaseStatus) => {
      if (purchase) purchase = { ...purchase, status };
    },
    snapshotUnchanged: () => JSON.stringify(purchase?.financialSnapshot) === snapshotBefore,
  };
}

const rejection = async (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e);

beforeEach(() => {
  vi.mocked(computeLeadFeeTax).mockClear();
  vi.mocked(calculateLeadPrice).mockClear();
  vi.mocked(estimateJobValue).mockClear();
});

describe("M140 — happy path", () => {
  it("1/2/3. creates a payment for the persisted total (121.00 EUR -> 12100 minor units), currency from the snapshot", async () => {
    const w = world();
    vi.mocked(computeLeadFeeTax).mockClear(); // fixture creation computes tax; the use case must not
    const result = await w.useCase.execute(USER_A, PURCHASE);

    expect(w.gateway.created).toEqual([
      {
        leadPurchaseId: PURCHASE,
        leadId: LEAD,
        amountMinorUnits: 12100,
        currency: "EUR",
        idempotencyKey: `lead-fee-payment-intent:${PURCHASE}`,
      },
    ]);
    expect(result).toEqual({
      purchaseId: PURCHASE,
      purchaseStatus: "PENDING_PAYMENT",
      clientSecret: expect.stringContaining("_secret_fake"),
      totalAmount: "121.00",
      currency: "EUR",
      paymentStatus: "REQUIRES_PAYMENT_METHOD",
    });
  });

  it("the provider never receives the net fee (10000)", async () => {
    const w = world();
    await w.useCase.execute(USER_A, PURCHASE);
    expect(w.gateway.created[0]?.amountMinorUnits).not.toBe(10000);
  });

  it("4. a client-supplied amount / currency / professional cannot influence the payment", async () => {
    const w = world();
    const execute = w.useCase.execute.bind(w.useCase) as (...args: unknown[]) => Promise<unknown>;
    await execute(USER_A, PURCHASE, { amount: 1, currency: "USD", professionalProfileId: PRO_B });
    expect(w.gateway.created[0]).toMatchObject({ amountMinorUnits: 12100, currency: "EUR" });
    expect(w.useCase.execute.length).toBe(2); // (userId, purchaseId) only
  });

  it("5/6. never calls the pricing, job-value or tax engines", async () => {
    const w = world();
    vi.mocked(computeLeadFeeTax).mockClear();
    await w.useCase.execute(USER_A, PURCHASE);
    expect(calculateLeadPrice).not.toHaveBeenCalled();
    expect(estimateJobValue).not.toHaveBeenCalled();
    expect(computeLeadFeeTax).not.toHaveBeenCalled();
  });

  it("uses the stored snapshot even for a rounded IVA (18.05 -> 2184)", async () => {
    const w = world({ price: "18.05" });
    const result = await w.useCase.execute(USER_A, PURCHASE);
    expect(w.gateway.created[0]?.amountMinorUnits).toBe(2184);
    expect(result.totalAmount).toBe("21.84");
  });
});

describe("M140 — eligibility", () => {
  it.each(LEAD_PURCHASE_STATUSES.filter((s) => s !== "PENDING_PAYMENT"))("7-11. %s purchase is rejected and no provider call is made", async (status) => {
    const w = world();
    w.setStatus(status);
    const error = await rejection(w.useCase.execute(USER_A, PURCHASE));
    expect(error).toBeInstanceOf(LeadFeePaymentNotInitiableError);
    expect((error as LeadFeePaymentNotInitiableError).reason).toBe("STATUS");
    expect(w.gateway.created).toHaveLength(0);
  });

  it("12. a legacy purchase (no tax snapshot) is rejected", async () => {
    const base = pendingPurchaseFromPublication(PURCHASE, LEAD, PRO_A, PUBLICATION);
    const legacy = { ...base, financialSnapshot: { ...base.financialSnapshot, taxAmount: null, totalAmount: null, taxPolicyVersion: null } };
    const w = world({ purchase: legacy });
    expect(await rejection(w.useCase.execute(USER_A, PURCHASE))).toMatchObject({ reason: "LEGACY" });
    expect(w.gateway.created).toHaveLength(0);
  });

  it("12b. a purchase whose lead is not LEAD_V1 is rejected", async () => {
    const w = world({ flow: "LEGACY_QUOTE_PAYMENT" });
    expect(await rejection(w.useCase.execute(USER_A, PURCHASE))).toMatchObject({ reason: "LEGACY" });
    expect(w.gateway.created).toHaveLength(0);
  });

  it("13. another professional's purchase is rejected with the same generic error as a missing one", async () => {
    const w = world();
    const other = await rejection(w.useCase.execute(USER_B, PURCHASE));
    const missing = await rejection(world({ purchase: null }).useCase.execute(USER_A, PURCHASE));
    expect(other).toBeInstanceOf(LeadFeePaymentNotInitiableError);
    expect((other as Error).message).toBe((missing as Error).message);
    expect(w.gateway.created).toHaveLength(0);
  });

  it("14. a missing purchase is rejected", async () => {
    const w = world({ purchase: null });
    expect(await rejection(w.useCase.execute(USER_A, PURCHASE))).toMatchObject({ reason: "NOT_FOUND" });
  });

  it("rejects unknown sessions, ineligible professionals and malformed ids", async () => {
    const w = world();
    expect(await rejection(w.useCase.execute("nobody", PURCHASE))).toMatchObject({ reason: "NOT_ELIGIBLE" });
    expect(await rejection(world({ proStatus: "SUSPENDED" }).useCase.execute(USER_A, PURCHASE))).toMatchObject({ reason: "NOT_ELIGIBLE" });
    expect(await rejection(world({ verification: "PENDING" }).useCase.execute(USER_A, PURCHASE))).toMatchObject({ reason: "NOT_ELIGIBLE" });
    expect(await rejection(w.useCase.execute(USER_A, "not-a-uuid"))).toMatchObject({ reason: "INPUT" });
    expect(await rejection(w.useCase.execute("", PURCHASE))).toMatchObject({ reason: "INPUT" });
    expect(w.gateway.created).toHaveLength(0);
  });

  it("15. an invalid / malformed / inconsistent snapshot is rejected, not repaired", async () => {
    const base = pendingPurchaseFromPublication(PURCHASE, LEAD, PRO_A, PUBLICATION);
    for (const patch of [{ totalAmount: "999.99" }, { totalAmount: "abc" }, { currency: "USD" }, { totalAmount: "0.00", feeAmount: "0.00", taxAmount: "0.00" }]) {
      const w = world({ purchase: { ...base, financialSnapshot: { ...base.financialSnapshot, ...patch } } });
      expect(await rejection(w.useCase.execute(USER_A, PURCHASE))).toBeInstanceOf(LeadFeePaymentNotInitiableError);
      expect(w.gateway.created).toHaveLength(0);
      expect(w.writes).toEqual([]);
    }
  });
});

describe("M140 — provider failure", () => {
  it("16/17. provider failure: safe error, purchase stays PENDING_PAYMENT, snapshot untouched, nothing persisted", async () => {
    const w = world();
    w.gateway.failCreate = new PaymentGatewayError("NETWORK", "connect ECONNREFUSED sk_live_SECRET", true);
    const error = await rejection(w.useCase.execute(USER_A, PURCHASE));
    expect(error).toBeInstanceOf(LeadFeePaymentUnavailableError);
    expect(String((error as Error).message)).not.toMatch(/sk_|ECONNREFUSED|secret/i);
    expect(w.current()?.status).toBe("PENDING_PAYMENT");
    expect(w.current()?.confirmedAt).toBeNull();
    expect(w.current()?.paymentReference).toBeNull();
    expect(w.snapshotUnchanged()).toBe(true);
    expect(w.writes).toEqual([]);
    expect(w.purchases.transition).not.toHaveBeenCalled();
  });

  it("an unexpected (non-gateway) provider error is also a safe error", async () => {
    const w = world();
    w.gateway.failCreate = new Error("boom");
    expect(await rejection(w.useCase.execute(USER_A, PURCHASE))).toBeInstanceOf(LeadFeePaymentUnavailableError);
  });

  it("a provider answer with a different amount is refused and discarded", async () => {
    const w = world();
    const create = w.gateway.createPayment.bind(w.gateway);
    w.gateway.createPayment = async (r) => ({ ...(await create(r)), amountMinorUnits: 10000 });
    expect(await rejection(w.useCase.execute(USER_A, PURCHASE))).toMatchObject({ reason: "PROVIDER_MISMATCH" });
    expect(w.gateway.canceled).toEqual(["pi_fake_1"]);
    expect(w.writes).toEqual([]);
  });
});

describe("M140 — idempotency", () => {
  it("18. a repeated initiation reuses the same provider payment (same reference, same client secret), no second create", async () => {
    const w = world();
    const first = await w.useCase.execute(USER_A, PURCHASE);
    const second = await w.useCase.execute(USER_A, PURCHASE);
    expect(second).toEqual(first);
    expect(w.gateway.created).toHaveLength(1);
    expect(w.current()?.paymentReference).toBe("pi_fake_1");
    expect(w.writes).toEqual(["paymentReference"]);
  });

  it("concurrent initiations converge on one provider payment and one persisted reference", async () => {
    const w = world();
    const results = await Promise.all([w.useCase.execute(USER_A, PURCHASE), w.useCase.execute(USER_A, PURCHASE), w.useCase.execute(USER_A, PURCHASE)]);
    expect(new Set(w.gateway.created.map((c) => c.idempotencyKey)).size).toBe(1);
    expect(new Set(results.map((r) => r.clientSecret)).size).toBe(1);
    expect(new Set(results.map((r) => r.totalAmount))).toEqual(new Set(["121.00"]));
    expect(w.current()?.paymentReference).toBe("pi_fake_1");
    expect(w.gateway.canceled).toEqual([]);
  });

  it("if a concurrent request persisted a DIFFERENT reference first, the surplus attempt is cancelled and the stored one is used", async () => {
    const w = world();
    w.gateway.ignoreIdempotency = true; // e.g. the provider's key window expired
    w.gateway.afterCreate = async () => {
      if (w.current()?.paymentReference === null) await w.purchases.recordPaymentReference(PURCHASE, "pi_winner");
    };
    w.gateway.payments.set("pi_winner", { reference: "pi_winner", clientSecret: "pi_winner_secret", status: "REQUIRES_PAYMENT_METHOD", amountMinorUnits: 12100, currency: "EUR" });
    const result = await w.useCase.execute(USER_A, PURCHASE);
    expect(result.clientSecret).toBe("pi_winner_secret");
    expect(w.gateway.canceled).toEqual(["pi_fake_1"]);
    expect(w.current()?.paymentReference).toBe("pi_winner");
  });

  it("a purchase that becomes terminal during the provider call: the new attempt is cancelled, nothing is persisted or returned", async () => {
    const w = world();
    w.gateway.afterCreate = async () => w.setStatus("CANCELLED");
    expect(await rejection(w.useCase.execute(USER_A, PURCHASE))).toMatchObject({ reason: "STATUS" });
    expect(w.gateway.canceled).toEqual(["pi_fake_1"]);
    expect(w.current()?.paymentReference).toBeNull();
    expect(w.current()?.status).toBe("CANCELLED");
  });

  it("a stored reference whose provider payment was canceled is not reused, and the provider mismatch case is refused", async () => {
    const w = world();
    await w.useCase.execute(USER_A, PURCHASE);
    w.gateway.payments.set("pi_fake_1", { ...w.gateway.payments.get("pi_fake_1")!, status: "CANCELED" });
    expect(await rejection(w.useCase.execute(USER_A, PURCHASE))).toMatchObject({ reason: "PROVIDER_CANCELED" });
    w.gateway.payments.set("pi_fake_1", { ...w.gateway.payments.get("pi_fake_1")!, status: "REQUIRES_PAYMENT_METHOD", amountMinorUnits: 1 });
    expect(await rejection(w.useCase.execute(USER_A, PURCHASE))).toMatchObject({ reason: "PROVIDER_MISMATCH" });
    expect(w.gateway.created).toHaveLength(1);
  });

  it("a provider failure while re-reading the stored attempt is a safe error", async () => {
    const w = world();
    await w.useCase.execute(USER_A, PURCHASE);
    w.gateway.failRetrieve = new PaymentGatewayError("TEMPORARY", "down", true);
    expect(await rejection(w.useCase.execute(USER_A, PURCHASE))).toBeInstanceOf(LeadFeePaymentUnavailableError);
  });
});

describe("M140 — lifecycle & contact boundary", () => {
  it("20. initiation never confirms the purchase, never unlocks contact, never changes status or snapshot", async () => {
    const w = world();
    await w.useCase.execute(USER_A, PURCHASE);
    expect(w.current()?.status).toBe("PENDING_PAYMENT");
    expect(w.current()?.confirmedAt).toBeNull();
    expect(w.purchases.transition).not.toHaveBeenCalled();
    expect(w.snapshotUnchanged()).toBe(true);
    expect(w.writes).toEqual(["paymentReference"]); // the ONLY write
  });

  it("19. the response carries no contact / customer data (M139 sentinels) and only whitelisted keys", async () => {
    const w = world();
    const result = await w.useCase.execute(USER_A, PURCHASE);
    expect(() => assertNoContactLeak(JSON.parse(JSON.stringify(result)), [M139_SECRET_EMAIL, M139_SECRET_PHONE, M139_SECRET_ADDRESS, M139_SECRET_POSTAL_CODE, M139_SECRET_NAME])).not.toThrow();
    expect(Object.keys(result).sort()).toEqual(["clientSecret", "currency", "paymentStatus", "purchaseId", "purchaseStatus", "totalAmount"]);
  });
});
