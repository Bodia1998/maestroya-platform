import { describe, expect, it } from "vitest";

import { checkProviderConsistency, type LocalProviderReference, type ProviderState } from "@/domain/services/reconciliation/provider-checks";

function makeLocal(overrides: Partial<LocalProviderReference> = {}): LocalProviderReference {
  return {
    entityType: "PAYMENT",
    entityId: "payment-1",
    jobId: "job-1",
    externalReference: "pi_test_1",
    localAmount: 1000,
    localCurrency: "EUR",
    localSettled: true,
    ...overrides,
  };
}

function makeProvider(overrides: Partial<ProviderState> = {}): ProviderState {
  return { found: true, settled: true, amount: 1000, currency: "EUR", ...overrides };
}

describe("checkProviderConsistency", () => {
  it("reports nothing when local and provider state agree", () => {
    expect(checkProviderConsistency(makeLocal(), makeProvider())).toEqual([]);
  });

  it("flags PROVIDER_STATE_UNKNOWN when the provider state could not be retrieved", () => {
    const findings = checkProviderConsistency(makeLocal(), null);
    expect(findings).toEqual([expect.objectContaining({ category: "PROVIDER_STATE_UNKNOWN" })]);
  });

  it("flags PROVIDER_LOCAL_STATE_MISMATCH when the provider reports the object does not exist", () => {
    const findings = checkProviderConsistency(makeLocal(), makeProvider({ found: false }));
    expect(findings.some((f) => f.category === "PROVIDER_LOCAL_STATE_MISMATCH")).toBe(true);
  });

  it("flags PROVIDER_LOCAL_STATE_MISMATCH when local is settled but the provider is not", () => {
    const findings = checkProviderConsistency(makeLocal({ localSettled: true }), makeProvider({ settled: false }));
    expect(findings.some((f) => f.category === "PROVIDER_LOCAL_STATE_MISMATCH")).toBe(true);
  });

  it("does not flag a settlement mismatch when local is not yet settled", () => {
    const findings = checkProviderConsistency(makeLocal({ localSettled: false }), makeProvider({ settled: false }));
    expect(findings.some((f) => f.category === "PROVIDER_LOCAL_STATE_MISMATCH")).toBe(false);
  });

  it("flags PROVIDER_AMOUNT_MISMATCH when the provider amount differs from local", () => {
    const findings = checkProviderConsistency(makeLocal({ localAmount: 1000 }), makeProvider({ amount: 900 }));
    expect(findings.some((f) => f.category === "PROVIDER_AMOUNT_MISMATCH")).toBe(true);
  });

  it("flags PROVIDER_AMOUNT_MISMATCH when the provider currency differs from local", () => {
    const findings = checkProviderConsistency(makeLocal({ localCurrency: "EUR" }), makeProvider({ currency: "USD" }));
    expect(findings.some((f) => f.category === "PROVIDER_AMOUNT_MISMATCH")).toBe(true);
  });

  it("sets entityType/refundId correctly for a REFUND local reference", () => {
    const findings = checkProviderConsistency(
      makeLocal({ entityType: "REFUND", entityId: "refund-1" }),
      makeProvider({ amount: 1 }),
    );
    expect(findings[0]).toMatchObject({ entityType: "REFUND", refundId: "refund-1", paymentId: null, payoutId: null });
  });
});
