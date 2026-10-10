import { beforeEach, describe, expect, it, vi } from "vitest";

import { GetProfessionalBillingReadinessUseCase } from "@/application/use-cases/billing-identity/get-professional-billing-readiness.use-case";
import { IssueLeadFeeInvoiceUseCase } from "@/application/use-cases/lead-fee-invoice/issue-lead-fee-invoice.use-case";
import type { LeadFeeRevenueLedgerRepository } from "@/domain/repositories/lead-fee-revenue-ledger-repository";
import type { LeadPurchaseRecord } from "@/domain/repositories/lead-purchase-repository";
import { LeadFeeInvoiceNotIssuableError, type LeadFeeInvoiceIssuanceConfig, type LeadFeeInvoiceRejectionReason } from "@/domain/services/lead-fee-invoice";
import type { LeadFeeRevenueLedgerEntryRecord } from "@/domain/services/lead-fee-revenue-ledger";
import { assertValidBillingIdentityDetails } from "@/domain/services/professional-billing-identity";

import { FakeLeadFeeInvoiceRepository } from "../../../../../test-utils/fake-lead-fee-invoice-repository";
import { FakeProfessionalBillingIdentityRepository, VALID_BILLING_INPUT } from "../../../../../test-utils/fake-professional-billing-identity-repository";
import { ISSUED_AT, PROFESSIONAL_ID, PURCHASE_ID, VALID_CONFIG, confirmedPurchase, ledgerEntryFor } from "../../../../../test-utils/lead-fee-invoice-fixtures";

/**
 * Module 150 — IssueLeadFeeInvoiceUseCase over the REAL M149 builder / M146 readiness use case and in-memory
 * repositories. Database-level behaviour (constraints, locks, transactions) is NOT proven here — see
 * tests/integration-db/lead-fee-invoice.
 */
const ADMIN = "55555555-5555-4555-8555-555555555555";

function world(over: { purchase?: LeadPurchaseRecord | null; entry?: LeadFeeRevenueLedgerEntryRecord | null; config?: LeadFeeInvoiceIssuanceConfig; verified?: boolean | "none" } = {}) {
  const purchase = over.purchase === undefined ? confirmedPurchase() : over.purchase;
  const entry = over.entry === undefined ? ledgerEntryFor(confirmedPurchase()) : over.entry;
  const ledger = { findByLeadPurchaseId: vi.fn(async () => entry) } as unknown as LeadFeeRevenueLedgerRepository & { findByLeadPurchaseId: ReturnType<typeof vi.fn> };
  const purchases = { findById: vi.fn(async () => purchase) };
  const identities = new FakeProfessionalBillingIdentityRepository();
  const invoices = new FakeLeadFeeInvoiceRepository();
  const config = { current: over.config ?? VALID_CONFIG };
  const useCase = new IssueLeadFeeInvoiceUseCase(
    ledger,
    purchases,
    new GetProfessionalBillingReadinessUseCase(identities),
    invoices,
    () => config.current,
    () => ISSUED_AT,
  );
  const ready = async (patch: Record<string, unknown> = {}) => {
    const { record } = await identities.saveDetails(PROFESSIONAL_ID, assertValidBillingIdentityDetails({ ...VALID_BILLING_INPUT, ...patch }));
    return identities.markVerified(record.id, record.revision, { adminUserId: ADMIN, now: new Date("2026-10-05T09:00:00Z") });
  };
  return { useCase, ledger, purchases, identities, invoices, config, ready };
}

async function reasonOf(promise: Promise<unknown>): Promise<LeadFeeInvoiceRejectionReason> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(LeadFeeInvoiceNotIssuableError);
    return (error as LeadFeeInvoiceNotIssuableError).reason;
  }
  throw new Error("expected LeadFeeInvoiceNotIssuableError");
}

describe("M150 — issuing the invoice for a valid confirmed ledger entry", () => {
  let w: ReturnType<typeof world>;
  beforeEach(async () => {
    w = world();
    await w.ready();
  });

  it("creates one invoice from the ledger amounts, the verified billing snapshot and the configured issuer", async () => {
    const { created, invoice } = await w.useCase.execute(PURCHASE_ID);
    expect(created).toBe(true);
    expect(invoice).toMatchObject({
      invoiceNumber: "LFI-2026-000001",
      leadPurchaseId: PURCHASE_ID,
      netFeeAmount: "100.00",
      taxAmount: "21.00",
      totalAmount: "121.00",
      taxRateBps: 2100,
      currency: "EUR",
      recipientLegalName: "Fontanería Mediterránea S.L.",
      recipientTaxId: "B12345674",
      issuerLegalName: "Issuer Test S.L.",
      policyApprovalReference: "TEST-APPROVAL-REF-1",
    });
    expect(w.invoices.rows.size).toBe(1);
  });

  it("is keyed on the persisted ledger entry (looked up by purchase id), never on client-supplied amounts", async () => {
    await w.useCase.execute(PURCHASE_ID);
    expect(w.ledger.findByLeadPurchaseId).toHaveBeenCalledWith(PURCHASE_ID);
    expect(w.purchases.findById).toHaveBeenCalledWith(PURCHASE_ID);
    expect(w.useCase.execute.length).toBe(1); // a single argument: no amount, tax, currency or recipient can be supplied
  });

  it("duplicate issuance returns the SAME invoice, creates nothing and consumes no number", async () => {
    const first = await w.useCase.execute(PURCHASE_ID);
    const second = await w.useCase.execute(PURCHASE_ID);
    expect(second.created).toBe(false);
    expect(second.invoice).toEqual(first.invoice);
    expect(w.invoices.rows.size).toBe(1);
    expect(w.invoices.counters.get(2026)).toBe(1);
    expect(w.invoices.issueCalls).toBe(1); // the replay never reached the writer
  });

  it("concurrent attempts yield exactly one created invoice and one number (use-case level; the DB race is proven in integration)", async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => w.useCase.execute(PURCHASE_ID)));
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(new Set(results.map((r) => r.invoice.id)).size).toBe(1);
    expect(w.invoices.rows.size).toBe(1);
    expect(w.invoices.counters.get(2026)).toBe(1);
  });

  it("the issued invoice is a stable snapshot: later billing-identity changes do not alter it, and a replay still returns it", async () => {
    const { invoice } = await w.useCase.execute(PURCHASE_ID);
    const before = JSON.stringify(invoice);
    await w.ready({ legalName: "Otro Nombre S.L.", taxId: "B99999999", addressLine1: "Otra Calle 1", postalCode: "28001" });
    await w.identities.saveDetails(PROFESSIONAL_ID, assertValidBillingIdentityDetails({ ...VALID_BILLING_INPUT, city: "Valencia" })); // back to UNVERIFIED

    const replay = await w.useCase.execute(PURCHASE_ID);
    expect(replay.created).toBe(false);
    expect(JSON.stringify(replay.invoice)).toBe(before);
    expect(replay.invoice.recipientLegalName).toBe("Fontanería Mediterránea S.L.");
    expect(replay.invoice.recipientTaxId).toBe("B12345674");
  });

  it("a replay does not re-evaluate today's configuration or purchase state", async () => {
    await w.useCase.execute(PURCHASE_ID);
    w.config.current = { issuer: null, policyApprovalReference: null };
    expect((await w.useCase.execute(PURCHASE_ID)).created).toBe(false);
  });
});

describe("M150 — rejections write nothing", () => {
  it("rejects when no ledger entry exists for the purchase (nothing is invoiced from a purchase alone)", async () => {
    const w = world({ entry: null });
    await w.ready();
    expect(await reasonOf(w.useCase.execute(PURCHASE_ID))).toBe("LEDGER_ENTRY_MISSING");
    expect(w.invoices.rows.size).toBe(0);
    expect(w.invoices.issueCalls).toBe(0);
    expect(w.purchases.findById).not.toHaveBeenCalled();
  });

  it.each(["not-a-uuid", "", "1; DROP TABLE x", 42 as never, null as never])("rejects malformed input %j before any lookup", async (value) => {
    const w = world();
    expect(await reasonOf(w.useCase.execute(value))).toBe("INPUT");
    expect(w.ledger.findByLeadPurchaseId).not.toHaveBeenCalled();
  });

  it.each(["PENDING_PAYMENT", "FAILED", "CANCELLED", "REFUNDED", "REVOKED"] as const)("rejects an ineligible %s purchase even if an entry exists", async (status) => {
    const w = world({ purchase: { ...confirmedPurchase(), status } });
    await w.ready();
    expect(await reasonOf(w.useCase.execute(PURCHASE_ID))).toBe("PURCHASE_NOT_CONFIRMED");
    expect(w.invoices.rows.size).toBe(0);
  });

  it("rejects when the purchase row cannot be found", async () => {
    const w = world({ purchase: null });
    await w.ready();
    expect(await reasonOf(w.useCase.execute(PURCHASE_ID))).toBe("PURCHASE_NOT_FOUND");
  });

  it("rejects a professional with NO billing identity (MISSING)", async () => {
    const w = world();
    expect(await reasonOf(w.useCase.execute(PURCHASE_ID))).toBe("BILLING_IDENTITY_NOT_READY");
    expect(w.invoices.rows.size).toBe(0);
  });

  it("rejects an UNVERIFIED (pending review) identity", async () => {
    const w = world();
    await w.identities.saveDetails(PROFESSIONAL_ID, assertValidBillingIdentityDetails(VALID_BILLING_INPUT));
    expect(await reasonOf(w.useCase.execute(PURCHASE_ID))).toBe("BILLING_IDENTITY_NOT_READY");
  });

  it("rejects an administrator-REJECTED identity", async () => {
    const w = world();
    const { record } = await w.identities.saveDetails(PROFESSIONAL_ID, assertValidBillingIdentityDetails(VALID_BILLING_INPUT));
    await w.identities.markRejected(record.id, record.revision, { adminUserId: ADMIN, now: new Date(), reason: "TAX_ID_MISMATCH", note: null });
    expect(await reasonOf(w.useCase.execute(PURCHASE_ID))).toBe("BILLING_IDENTITY_NOT_READY");
  });

  it("rejects an identity edited after verification (back to UNVERIFIED)", async () => {
    const w = world();
    await w.ready();
    await w.identities.saveDetails(PROFESSIONAL_ID, assertValidBillingIdentityDetails({ ...VALID_BILLING_INPUT, city: "Valencia" }));
    expect(await reasonOf(w.useCase.execute(PURCHASE_ID))).toBe("BILLING_IDENTITY_NOT_READY");
  });

  it("uses the professional recorded on the LEDGER ENTRY: another professional's verified identity does not qualify", async () => {
    const w = world();
    const other = "66666666-6666-4666-8666-666666666666";
    const { record } = await w.identities.saveDetails(other, assertValidBillingIdentityDetails(VALID_BILLING_INPUT));
    await w.identities.markVerified(record.id, record.revision, { adminUserId: ADMIN, now: new Date() });
    expect(await reasonOf(w.useCase.execute(PURCHASE_ID))).toBe("BILLING_IDENTITY_NOT_READY");
  });

  it("rejects missing / unsupported tax information", async () => {
    const purchase = confirmedPurchase();
    const unknownPolicy = world({ entry: ledgerEntryFor(purchase, { taxPolicyVersion: "lead-fee-tax-policy-v9" }) });
    await unknownPolicy.ready();
    expect(await reasonOf(unknownPolicy.useCase.execute(PURCHASE_ID))).toBe("UNSUPPORTED_TAX_POLICY");

    const foreign = world();
    await foreign.ready({ taxCountry: "DE", country: "DE", postalCode: "10115" });
    expect(await reasonOf(foreign.useCase.execute(PURCHASE_ID))).toBe("UNSUPPORTED_RECIPIENT_COUNTRY");

    const canarias = world();
    await canarias.ready({ postalCode: "35001" });
    expect(await reasonOf(canarias.useCase.execute(PURCHASE_ID))).toBe("UNSUPPORTED_TAX_TERRITORY");
  });

  it("is closed until the policy is approved and the issuer is configured", async () => {
    const unapproved = world({ config: { ...VALID_CONFIG, policyApprovalReference: null } });
    await unapproved.ready();
    expect(await reasonOf(unapproved.useCase.execute(PURCHASE_ID))).toBe("POLICY_NOT_APPROVED");
    const noIssuer = world({ config: { ...VALID_CONFIG, issuer: null } });
    await noIssuer.ready();
    expect(await reasonOf(noIssuer.useCase.execute(PURCHASE_ID))).toBe("ISSUER_NOT_CONFIGURED");
    expect(unapproved.invoices.rows.size + noIssuer.invoices.rows.size).toBe(0);
  });

  it("rejects when the identity changed between the readiness read and the write (writer-side re-check)", async () => {
    const w = world();
    await w.ready();
    w.invoices.currentIdentityRevision = 99;
    expect(await reasonOf(w.useCase.execute(PURCHASE_ID))).toBe("BILLING_IDENTITY_CHANGED");
    expect(w.invoices.rows.size).toBe(0);
  });
});

describe("M150 — failure and rollback semantics", () => {
  it("a writer failure after number allocation propagates, leaves no invoice and burns no number; a retry gets number 1", async () => {
    const w = world();
    await w.ready();
    w.invoices.failAfterAllocation = new Error("db down");
    await expect(w.useCase.execute(PURCHASE_ID)).rejects.toThrow("db down");
    expect(w.invoices.rows.size).toBe(0);
    expect(w.invoices.counters.size).toBe(0);

    w.invoices.failAfterAllocation = null;
    const { invoice } = await w.useCase.execute(PURCHASE_ID);
    expect(invoice.invoiceNumber).toBe("LFI-2026-000001");
  });

  it("an error from the billing readiness read propagates (never converted into an invoice)", async () => {
    const w = world();
    vi.spyOn(w.identities, "findByProfessionalProfileId").mockRejectedValue(new Error("billing read failed"));
    await expect(w.useCase.execute(PURCHASE_ID)).rejects.toThrow("billing read failed");
    expect(w.invoices.rows.size).toBe(0);
  });

  it("an error from the ledger lookup propagates and writes nothing", async () => {
    const w = world();
    await w.ready();
    w.ledger.findByLeadPurchaseId.mockRejectedValue(new Error("ledger read failed"));
    await expect(w.useCase.execute(PURCHASE_ID)).rejects.toThrow("ledger read failed");
    expect(w.invoices.issueCalls).toBe(0);
  });
});
