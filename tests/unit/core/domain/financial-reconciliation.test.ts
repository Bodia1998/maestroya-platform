import { describe, expect, it } from "vitest";

import { reconcilePayment } from "@/domain/services/financial-reconciliation";
import type { CommissionRecord } from "@/domain/repositories/commission-repository";
import type { FinancialTransactionRecord } from "@/domain/repositories/financial-ledger-repository";

/**
 * Module 69 — Financial Ledger & Payout Readiness Audit: unit tests for the
 * pure reconciliation function. Mirrors payment-release-decision.test.ts's
 * own "pure function, no I/O" testing style — every input is hand-built,
 * nothing touches a repository.
 */

function makeCommission(overrides: Partial<CommissionRecord> = {}): CommissionRecord {
  return {
    id: "commission-1",
    paymentId: "payment-1",
    professionalProfileId: "professional-1",
    companyProfileId: null,
    rateBps: 1000,
    amount: 150,
    status: "PENDING",
    settledAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function makeLedgerEntry(overrides: Partial<FinancialTransactionRecord> = {}): FinancialTransactionRecord {
  return {
    id: `tx-${Math.random()}`,
    paymentId: "payment-1",
    payoutId: null,
    refundId: null,
    commissionId: "commission-1",
    type: "COMMISSION",
    status: "COMPLETED",
    amount: 150,
    currency: "EUR",
    description: null,
    idempotencyKey: null,
    createdAt: new Date(),
    ...overrides,
  };
}

const BASE_PAYMENT = { id: "payment-1", amount: 1500, currency: "EUR", status: "CAPTURED" as const };

describe("reconcilePayment", () => {
  it("reports a fully consistent chain as consistent, with the correct payable amount", () => {
    const report = reconcilePayment({
      payment: BASE_PAYMENT,
      commission: makeCommission({ amount: 150 }),
      ledgerEntries: [
        makeLedgerEntry({ type: "LABOR_CHARGE", amount: 1000 }),
        makeLedgerEntry({ type: "MATERIALS_CHARGE", amount: 500 }),
        makeLedgerEntry({ type: "COMMISSION", amount: 150 }),
        makeLedgerEntry({ type: "PROFESSIONAL_NET_EARNING", amount: 1350 }),
        makeLedgerEntry({ type: "PLATFORM_REVENUE", amount: 150 }),
      ],
      appliedRefundAdjustmentsTotal: 0,
      releaseStatus: "RELEASE_APPROVED",
    });

    expect(report.consistent).toBe(true);
    expect(report.issues).toHaveLength(0);
    expect(report.professionalNetEarning).toBe(1350);
    expect(report.amountPayableToProfessional).toBe(1350);
  });

  it("flags a PROFESSIONAL_NET_EARNING entry with no Commission row", () => {
    const report = reconcilePayment({
      payment: BASE_PAYMENT,
      commission: null,
      ledgerEntries: [makeLedgerEntry({ type: "PROFESSIONAL_NET_EARNING", amount: 1350 })],
      appliedRefundAdjustmentsTotal: 0,
      releaseStatus: "RELEASE_APPROVED",
    });

    expect(report.consistent).toBe(false);
    expect(report.issues.map((i) => i.code)).toContain("MISSING_COMMISSION_FOR_RECOGNIZED_EARNING");
  });

  it("flags a Commission with no PROFESSIONAL_NET_EARNING ledger entry", () => {
    const report = reconcilePayment({
      payment: BASE_PAYMENT,
      commission: makeCommission(),
      ledgerEntries: [],
      appliedRefundAdjustmentsTotal: 0,
      releaseStatus: "RELEASE_APPROVED",
    });

    expect(report.consistent).toBe(false);
    expect(report.issues.map((i) => i.code)).toContain("MISSING_NET_EARNING_LEDGER_ENTRY");
  });

  it("flags a Commission.amount that disagrees with the COMMISSION ledger entry", () => {
    const report = reconcilePayment({
      payment: BASE_PAYMENT,
      commission: makeCommission({ amount: 150 }),
      ledgerEntries: [
        makeLedgerEntry({ type: "LABOR_CHARGE", amount: 1000 }),
        makeLedgerEntry({ type: "MATERIALS_CHARGE", amount: 500 }),
        makeLedgerEntry({ type: "COMMISSION", amount: 200 }),
        makeLedgerEntry({ type: "PROFESSIONAL_NET_EARNING", amount: 1350 }),
      ],
      appliedRefundAdjustmentsTotal: 0,
      releaseStatus: "RELEASE_APPROVED",
    });

    expect(report.consistent).toBe(false);
    expect(report.issues.map((i) => i.code)).toContain("COMMISSION_LEDGER_AMOUNT_MISMATCH");
  });

  it("flags earnings recognized without RELEASE_APPROVED — Invariant 3", () => {
    const report = reconcilePayment({
      payment: BASE_PAYMENT,
      commission: makeCommission(),
      ledgerEntries: [makeLedgerEntry({ type: "PROFESSIONAL_NET_EARNING", amount: 1350 })],
      appliedRefundAdjustmentsTotal: 0,
      releaseStatus: "RELEASE_HELD",
    });

    expect(report.consistent).toBe(false);
    expect(report.issues.map((i) => i.code)).toContain("EARNING_RECOGNIZED_WITHOUT_RELEASE_APPROVED");
  });

  it("flags refunds that exceed the captured amount — Invariant 8", () => {
    const report = reconcilePayment({
      payment: BASE_PAYMENT,
      commission: null,
      ledgerEntries: [],
      appliedRefundAdjustmentsTotal: 2000,
      releaseStatus: null,
    });

    expect(report.consistent).toBe(false);
    expect(report.issues.map((i) => i.code)).toContain("REFUND_EXCEEDS_CAPTURED_AMOUNT");
  });

  it("flags a ledger entry in a different currency than the payment — Invariant 9", () => {
    const report = reconcilePayment({
      payment: BASE_PAYMENT,
      commission: null,
      ledgerEntries: [makeLedgerEntry({ type: "COMMISSION", currency: "USD" })],
      appliedRefundAdjustmentsTotal: 0,
      releaseStatus: null,
    });

    expect(report.consistent).toBe(false);
    expect(report.issues.map((i) => i.code)).toContain("CURRENCY_MISMATCH");
  });

  it("nets a professional-payout-reduction adjustment into amountPayableToProfessional", () => {
    const report = reconcilePayment({
      payment: BASE_PAYMENT,
      commission: makeCommission({ amount: 150 }),
      ledgerEntries: [
        makeLedgerEntry({ type: "LABOR_CHARGE", amount: 1000 }),
        makeLedgerEntry({ type: "MATERIALS_CHARGE", amount: 500 }),
        makeLedgerEntry({ type: "COMMISSION", amount: 150 }),
        makeLedgerEntry({ type: "PROFESSIONAL_NET_EARNING", amount: 1350 }),
        makeLedgerEntry({ type: "DISPUTE_ADJUSTMENT", amount: -300 }),
      ],
      appliedRefundAdjustmentsTotal: 0,
      releaseStatus: "RELEASE_APPROVED",
    });

    expect(report.amountPayableToProfessional).toBe(1050);
  });

  it("reports no payable amount when nothing has been recognized yet", () => {
    const report = reconcilePayment({
      payment: BASE_PAYMENT,
      commission: null,
      ledgerEntries: [],
      appliedRefundAdjustmentsTotal: 0,
      releaseStatus: null,
    });

    expect(report.amountPayableToProfessional).toBeNull();
    expect(report.consistent).toBe(true);
  });
});
