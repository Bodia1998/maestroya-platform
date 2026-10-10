import type { LeadPurchaseRecord } from "@/domain/repositories/lead-purchase-repository";
import type { LeadFeeInvoiceIssuanceConfig } from "@/domain/services/lead-fee-invoice";
import { buildLeadFeeRevenueLedgerEntry, type LeadFeeRevenueLedgerEntryRecord } from "@/domain/services/lead-fee-revenue-ledger";
import type { BillingIdentityDetails, BillingIdentitySnapshot } from "@/domain/services/professional-billing-identity";

import { SNAPSHOT_DATA } from "./lead-publication-fixtures";
import { pendingPurchaseFromPublication } from "./lead-purchase-fixtures";

/** Module 150 test fixtures (tests only; production never imports these). */
export const PURCHASE_ID = "11111111-1111-4111-8111-111111111111";
export const LEAD_ID = "22222222-2222-4222-8222-222222222222";
export const PROFESSIONAL_ID = "33333333-3333-4333-8333-333333333333";
export const ENTRY_ID = "44444444-4444-4444-8444-444444444444";

export const CONFIRMED_AT = new Date("2026-10-09T10:00:01.000Z");
export const ISSUED_AT = new Date("2026-10-10T08:30:00.000Z");
const PUBLICATION = { ...SNAPSHOT_DATA, publishedAt: new Date("2026-10-01T00:00:00Z"), price: "100.00" };

export function confirmedPurchase(price = "100.00", over: Partial<LeadPurchaseRecord> = {}): LeadPurchaseRecord {
  return {
    ...pendingPurchaseFromPublication(PURCHASE_ID, LEAD_ID, PROFESSIONAL_ID, { ...PUBLICATION, price }),
    status: "CONFIRMED",
    paymentReference: "pi_m150_1",
    confirmedAt: CONFIRMED_AT,
    ...over,
  };
}

/** The M149 entry exactly as the real ledger builder produces it from the purchase snapshot. */
export function ledgerEntryFor(purchase: LeadPurchaseRecord, over: Partial<LeadFeeRevenueLedgerEntryRecord> = {}): LeadFeeRevenueLedgerEntryRecord {
  return {
    ...buildLeadFeeRevenueLedgerEntry(purchase, { providerEventId: "evt_m150_1", providerEventCreatedAt: CONFIRMED_AT }),
    id: ENTRY_ID,
    recordedAt: CONFIRMED_AT,
    ...over,
  };
}

export const BILLING_DETAILS: BillingIdentityDetails = {
  entityType: "COMPANY",
  legalName: "Fontanería Mediterránea S.L.",
  taxId: "B12345674",
  taxCountry: "ES",
  addressLine1: "Carrer Major 12",
  addressLine2: null,
  city: "Gandia",
  region: "Valencia",
  postalCode: "46700",
  country: "ES",
};

export function billingSnapshot(over: Partial<BillingIdentitySnapshot> = {}): BillingIdentitySnapshot {
  return Object.freeze({
    professionalProfileId: PROFESSIONAL_ID,
    revision: 3,
    verifiedAt: new Date("2026-10-05T09:00:00.000Z"),
    ...BILLING_DETAILS,
    ...over,
  });
}

export const VALID_CONFIG: LeadFeeInvoiceIssuanceConfig = {
  issuer: { legalName: "Issuer Test S.L.", taxId: "B87654321", address: "Calle Falsa 123, 28001 Madrid, ES" },
  policyApprovalReference: "TEST-APPROVAL-REF-1",
};
