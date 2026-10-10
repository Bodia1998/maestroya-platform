import { buildLeadFeeInvoiceDraft, type LeadFeeInvoiceRecord } from "@/domain/services/lead-fee-invoice";
import type { LeadFeeCreditNoteIssuanceConfig } from "@/domain/services/lead-fee-credit-note";

import { ISSUED_AT, VALID_CONFIG, billingSnapshot, confirmedPurchase, ledgerEntryFor } from "./lead-fee-invoice-fixtures";

/** Module 151 test fixtures (tests only; production never imports these). */
export const INVOICE_ID = "55555555-5555-4555-8555-555555555555";
export const CREDIT_ISSUED_AT = new Date("2026-10-12T09:00:00.000Z");

/** A real M150 invoice record: built by the real M150 draft builder from the M149/M146 fixtures (100.00 net + 21.00 IVA = 121.00). */
export function invoiceRecord(over: Partial<LeadFeeInvoiceRecord> = {}, price = "100.00"): LeadFeeInvoiceRecord {
  const purchase = confirmedPurchase(price);
  const draft = buildLeadFeeInvoiceDraft({ ledgerEntry: ledgerEntryFor(purchase), purchase, billing: billingSnapshot(), config: VALID_CONFIG, issuedAt: ISSUED_AT });
  return { ...draft, id: INVOICE_ID, invoiceNumber: "LFI-2026-000001", createdAt: ISSUED_AT, ...over };
}

/** The configured issuer is the one on the invoice (VALID_CONFIG.issuer) and the credit-note approval is its own reference. */
export const CREDIT_CONFIG: LeadFeeCreditNoteIssuanceConfig = {
  issuer: VALID_CONFIG.issuer,
  policyApprovalReference: "TEST-CN-APPROVAL-1",
};
