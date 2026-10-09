import { DomainError } from "@/domain/errors/domain-error";
import type { LeadPurchaseRecord } from "@/domain/repositories/lead-purchase-repository";
import { LeadFeePaymentNotInitiableError, leadFeePaymentTermsFromSnapshot } from "@/domain/services/lead-fee-payment";
import { formatScaledDecimal, parseScaledDecimal } from "@/domain/services/fixed-point-decimal";

/**
 * Module 149 — Lead-Fee Revenue Ledger: pure domain rules.
 *
 * An OPERATIONAL event ledger: "the professional's lead-access fee payment SUCCEEDED". It is not a
 * double-entry ledger and encodes no accounting policy (no debit/credit, revenue recognition, IVA
 * allocation, invoice or credit-note semantics) — those decisions are open, see
 * docs/MODULE_149_LEAD_FEE_REVENUE_LEDGER.md.
 *
 * Every amount is read from the persisted, immutable M135/M136 purchase snapshot (exact decimal strings,
 * never recomputed, never client-supplied). The customer's job value / the professional's service revenue
 * is NOT part of the snapshot used here and can never reach an entry.
 */

export const LEAD_FEE_LEDGER_ENTRY_TYPES = ["LEAD_FEE_PAYMENT_SUCCEEDED"] as const;
export type LeadFeeLedgerEntryType = (typeof LEAD_FEE_LEDGER_ENTRY_TYPES)[number];
export const LEAD_FEE_PAYMENT_SUCCEEDED: LeadFeeLedgerEntryType = "LEAD_FEE_PAYMENT_SUCCEEDED";

/** The authoritative provider event that proved the payment (already signature-verified upstream). */
export interface LeadFeePaymentLedgerSource {
  providerEventId: string;
  providerEventCreatedAt: Date | null;
}

/** What is written for one successful lead-fee payment. Money = exact 2-decimal strings. */
export interface LeadFeeRevenueLedgerEntryData {
  entryType: LeadFeeLedgerEntryType;
  leadPurchaseId: string;
  leadId: string;
  professionalProfileId: string;
  paymentReference: string;
  providerEventId: string;
  providerEventCreatedAt: Date | null;
  /** LeadPurchase.price — the net lead-access fee. */
  netFeeAmount: string;
  /** M136 IVA exactly as snapshotted (not recomputed, not an accounting allocation). */
  taxAmount: string;
  /** What the professional paid MaestroYa (= net + tax), equal to the provider amount that was verified. */
  totalCollectedAmount: string;
  currency: string;
  taxPolicyVersion: string;
  pricingConfigVersion: string | null;
  pricingRuleVersion: string | null;
  paymentConfirmedAt: Date;
}

export interface LeadFeeRevenueLedgerEntryRecord extends LeadFeeRevenueLedgerEntryData {
  id: string;
  recordedAt: Date;
}

/** The purchase / source cannot produce a valid ledger entry. Deterministic data problem — never repaired or guessed. */
export class LeadFeeLedgerEntryInvalidError extends DomainError {
  readonly code = "LEAD_FEE_LEDGER_ENTRY_INVALID";

  constructor(readonly reason: "STATUS_NOT_CONFIRMED" | "PAYMENT_REFERENCE_MISSING" | "CONFIRMED_AT_MISSING" | "SNAPSHOT_INVALID" | "SOURCE_INVALID") {
    super("A lead-fee ledger entry cannot be built for this purchase.");
  }
}

/** An entry already exists for the purchase but disagrees with what would be recorded. Surfaced, never overwritten. */
export class LeadFeeLedgerConflictError extends DomainError {
  readonly code = "LEAD_FEE_LEDGER_CONFLICT";

  constructor(readonly leadPurchaseId: string) {
    super("An existing lead-fee ledger entry conflicts with the confirmed payment.");
  }
}

/**
 * Builds the entry for a CONFIRMED purchase from its persisted snapshot only. Throws
 * LeadFeeLedgerEntryInvalidError for anything that is not a confirmed, provider-paid, fully snapshotted
 * purchase (pending/failed/cancelled never yield an entry; neither does a purchase without a payment reference).
 */
export function buildLeadFeeRevenueLedgerEntry(
  purchase: LeadPurchaseRecord,
  source: LeadFeePaymentLedgerSource,
): LeadFeeRevenueLedgerEntryData {
  if (purchase.status !== "CONFIRMED") throw new LeadFeeLedgerEntryInvalidError("STATUS_NOT_CONFIRMED");
  if (typeof purchase.paymentReference !== "string" || purchase.paymentReference === "") {
    throw new LeadFeeLedgerEntryInvalidError("PAYMENT_REFERENCE_MISSING");
  }
  if (!(purchase.confirmedAt instanceof Date)) throw new LeadFeeLedgerEntryInvalidError("CONFIRMED_AT_MISSING");
  if (typeof source.providerEventId !== "string" || source.providerEventId === "") throw new LeadFeeLedgerEntryInvalidError("SOURCE_INVALID");

  try {
    // Same validation M140/M141 applied (EUR, fee > 0, total = fee + tax, snapshot complete) — nothing recomputed.
    leadFeePaymentTermsFromSnapshot(purchase);
  } catch (error) {
    if (error instanceof LeadFeePaymentNotInitiableError) throw new LeadFeeLedgerEntryInvalidError("SNAPSHOT_INVALID");
    throw error;
  }
  const snapshot = purchase.financialSnapshot;
  const money = (value: string | null): string => {
    const parsed = value === null ? null : parseScaledDecimal(value, 2);
    if (parsed === null) throw new LeadFeeLedgerEntryInvalidError("SNAPSHOT_INVALID");
    return formatScaledDecimal(parsed, 2, 2);
  };
  return {
    entryType: LEAD_FEE_PAYMENT_SUCCEEDED,
    leadPurchaseId: purchase.id,
    leadId: purchase.leadId,
    professionalProfileId: purchase.professionalProfileId,
    paymentReference: purchase.paymentReference,
    providerEventId: source.providerEventId,
    providerEventCreatedAt: source.providerEventCreatedAt ?? null,
    netFeeAmount: money(snapshot.feeAmount),
    taxAmount: money(snapshot.taxAmount),
    totalCollectedAmount: money(snapshot.totalAmount),
    currency: snapshot.currency,
    taxPolicyVersion: snapshot.taxPolicyVersion as string,
    pricingConfigVersion: snapshot.pricingConfigVersion,
    pricingRuleVersion: snapshot.pricingRuleVersion,
    paymentConfirmedAt: purchase.confirmedAt,
  };
}

/** True when an existing entry records the same payment facts as `expected` (the audit source event may differ). */
export function isSameLeadFeePayment(existing: LeadFeeRevenueLedgerEntryData, expected: LeadFeeRevenueLedgerEntryData): boolean {
  return (
    existing.entryType === expected.entryType &&
    existing.leadPurchaseId === expected.leadPurchaseId &&
    existing.leadId === expected.leadId &&
    existing.professionalProfileId === expected.professionalProfileId &&
    existing.paymentReference === expected.paymentReference &&
    existing.netFeeAmount === expected.netFeeAmount &&
    existing.taxAmount === expected.taxAmount &&
    existing.totalCollectedAmount === expected.totalCollectedAmount &&
    existing.currency === expected.currency
  );
}
