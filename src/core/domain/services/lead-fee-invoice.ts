import { DomainError } from "@/domain/errors/domain-error";
import type { LeadPurchaseRecord } from "@/domain/repositories/lead-purchase-repository";
import { formatScaledDecimal, parseScaledDecimal } from "@/domain/services/fixed-point-decimal";
import { isPlaceholderIssuerTaxId } from "@/domain/services/invoicing-issuer";
import { LEAD_FEE_IVA_RATE_BPS, LEAD_FEE_TAX_POLICY_VERSION, computeLeadFeeTax } from "@/domain/services/lead-fee-tax-policy";
import {
  LEAD_FEE_PAYMENT_SUCCEEDED,
  type LeadFeeRevenueLedgerEntryRecord,
} from "@/domain/services/lead-fee-revenue-ledger";
import {
  findBillingIdentityIssues,
  type BillingEntityType,
  type BillingIdentitySnapshot,
} from "@/domain/services/professional-billing-identity";

/**
 * Module 150 — Lead-Fee Invoice: pure domain rules (no I/O).
 *
 * WHAT THIS IS. The internal INVOICE RECORD MaestroYa issues to a professional for ONE confirmed lead-access
 * fee payment (one M149 ledger entry -> at most one invoice). Every amount is copied from the persisted M149
 * ledger entry (never recomputed from current pricing configuration); the recipient is the M146 billing-identity
 * snapshot at the moment of issuance; the issuer is MaestroYa as configured by the operator.
 *
 * WHAT THIS IS NOT. It is NOT a claim of legal compliance. The repository contains no reviewed legal/accounting
 * policy for LEAD_V1 invoices (issuer entity, mandatory fields, numbering series, tax point, IVA cases, document
 * format, delivery, retention — see docs/MODULE_150_LEAD_FEE_INVOICE.md). The rules below are therefore a
 * FAIL-CLOSED boundary: an invoice is recorded only for the narrow, explicitly listed case this code can verify
 * (confirmed purchase, EUR, the known M136 policy version with a consistent IVA amount, a verified and complete
 * Spanish billing identity in the IVA territory, a configured issuer, and an explicit policy-approval reference);
 * everything else is rejected with a typed reason and nothing is persisted or guessed.
 *
 * It never reads the customer's job value, the lead's estimated job value, quotes or the professional's service
 * revenue: none of them is part of the ledger entry or the purchase snapshot used here.
 */

/** Counter series for lead-fee invoices. Distinct from the legacy "INV" / "CN" series, which are never touched. PROVISIONAL (D-numbering). */
export const LEAD_FEE_INVOICE_SERIES = "LFI";

/** Version of THESE technical rules. It identifies code behaviour only — it is NOT a legal approval. */
export const LEAD_FEE_INVOICE_RULES_VERSION = "lead-fee-invoice-rules-v1";

/** Neutral, non-localised line description (final wording/language is an open product/legal decision). It carries no customer or job data. */
export const LEAD_FEE_INVOICE_DESCRIPTION = "Lead access fee (LEAD_V1)";

export const LEAD_FEE_INVOICE_SUPPORTED_CURRENCY = "EUR";
/** The only recipient tax country / billing country the rules can verify. Everything else needs an approved policy. */
export const LEAD_FEE_INVOICE_SUPPORTED_RECIPIENT_COUNTRY = "ES";

/** M136 tax-policy versions whose IVA rate this module can verify. A snapshot under any other version is rejected. */
export const LEAD_FEE_INVOICE_SUPPORTED_TAX_POLICIES: Readonly<Record<string, bigint>> = Object.freeze({
  [LEAD_FEE_TAX_POLICY_VERSION]: LEAD_FEE_IVA_RATE_BPS,
});

/**
 * Spanish postal-code provinces outside the IVA territory (Las Palmas 35, Santa Cruz de Tenerife 38, Ceuta 51,
 * Melilla 52): the 21% IVA of the M136 policy is not applicable there, so the recipient is "unsupported tax
 * territory". A conservative postal-code heuristic, not a legal determination of the professional's tax status.
 */
export const LEAD_FEE_INVOICE_NON_IVA_POSTAL_PREFIXES: readonly string[] = Object.freeze(["35", "38", "51", "52"]);

export const LEAD_FEE_INVOICE_NUMBER_PATTERN = /^LFI-\d{4}-\d{6,}$/;

export type LeadFeeInvoiceRejectionReason =
  | "INPUT"
  | "LEDGER_ENTRY_MISSING"
  | "PURCHASE_NOT_FOUND"
  | "PURCHASE_NOT_CONFIRMED"
  | "LEDGER_ENTRY_INVALID"
  | "LEDGER_PURCHASE_MISMATCH"
  | "UNSUPPORTED_CURRENCY"
  | "UNSUPPORTED_TAX_POLICY"
  | "TAX_AMOUNT_INCONSISTENT"
  | "BILLING_IDENTITY_NOT_READY"
  | "BILLING_IDENTITY_CHANGED"
  | "UNSUPPORTED_RECIPIENT_COUNTRY"
  | "UNSUPPORTED_TAX_TERRITORY"
  | "ISSUER_NOT_CONFIGURED"
  | "POLICY_NOT_APPROVED";

/** An invoice cannot be issued for this ledger entry. Closed reason, static message: never carries tax ids, names or addresses. */
export class LeadFeeInvoiceNotIssuableError extends DomainError {
  readonly code = "LEAD_FEE_INVOICE_NOT_ISSUABLE";

  constructor(readonly reason: LeadFeeInvoiceRejectionReason) {
    super("A lead-fee invoice cannot be issued for this lead purchase.");
  }
}

/** MaestroYa as issuer, exactly as configured by the operator at issuance time. */
export interface LeadFeeInvoiceIssuer {
  legalName: string;
  taxId: string;
  address: string;
}

/** Operator-supplied issuance settings. Anything missing keeps issuance closed. */
export interface LeadFeeInvoiceIssuanceConfig {
  issuer: LeadFeeInvoiceIssuer | null;
  /** Reference of the reviewed legal/accounting approval of this invoice policy. null = not approved = fail closed. */
  policyApprovalReference: string | null;
}

export const LEAD_FEE_INVOICE_ENV = Object.freeze({
  issuerLegalName: "MAESTROYA_ISSUER_LEGAL_NAME",
  issuerTaxId: "MAESTROYA_ISSUER_TAX_ID",
  issuerAddress: "MAESTROYA_ISSUER_ADDRESS",
  policyApprovalReference: "LEAD_FEE_INVOICE_POLICY_APPROVAL_REF",
});

function nonEmpty(value: string | undefined): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed === "" ? null : trimmed;
}

/**
 * Reads issuance settings from an environment map. Deliberately does NOT reuse the legacy invoicing-issuer
 * constants: those silently fall back to a default legal name, which would let an unconfirmed name reach an
 * invoice. Here the legal name, tax id (never the known placeholder) and address must ALL be set explicitly.
 */
export function resolveLeadFeeInvoiceIssuanceConfig(env: Readonly<Record<string, string | undefined>>): LeadFeeInvoiceIssuanceConfig {
  const legalName = nonEmpty(env[LEAD_FEE_INVOICE_ENV.issuerLegalName]);
  const taxId = nonEmpty(env[LEAD_FEE_INVOICE_ENV.issuerTaxId]);
  const address = nonEmpty(env[LEAD_FEE_INVOICE_ENV.issuerAddress]);
  const issuer =
    legalName !== null && taxId !== null && address !== null && !isPlaceholderIssuerTaxId(taxId) ? { legalName, taxId, address } : null;
  return { issuer, policyApprovalReference: nonEmpty(env[LEAD_FEE_INVOICE_ENV.policyApprovalReference]) };
}

/** Everything persisted for one invoice except what the repository allocates (id, number, createdAt). Money = exact 2-decimal strings. */
export interface LeadFeeInvoiceDraft {
  ledgerEntryId: string;
  leadPurchaseId: string;
  leadId: string;
  professionalProfileId: string;
  /** Issue date/time (system clock at issuance). Which date is the tax point is an OPEN decision; nothing here asserts it. */
  issuedAt: Date;
  /** M149 `paymentConfirmedAt`, copied unchanged. */
  paymentConfirmedAt: Date;
  currency: string;
  netFeeAmount: string;
  taxRateBps: number;
  taxAmount: string;
  totalAmount: string;
  taxPolicyVersion: string;
  description: string;
  issuerLegalName: string;
  issuerTaxId: string;
  issuerAddress: string;
  recipientEntityType: BillingEntityType;
  recipientLegalName: string;
  recipientTaxId: string;
  recipientTaxCountry: string;
  recipientAddressLine1: string;
  recipientAddressLine2: string | null;
  recipientCity: string;
  recipientRegion: string | null;
  recipientPostalCode: string;
  recipientCountry: string;
  /** M146 revision + verification time of the identity the snapshot above was taken from. */
  billingIdentityRevision: number;
  billingIdentityVerifiedAt: Date;
  /** Version of these technical rules (not a legal approval). */
  rulesVersion: string;
  /** The operator-supplied reference of the reviewed policy approval under which the invoice was issued. */
  policyApprovalReference: string;
}

export interface LeadFeeInvoiceRecord extends LeadFeeInvoiceDraft {
  id: string;
  invoiceNumber: string;
  createdAt: Date;
}

/** "LFI-2026-000123". The sequence must come from the database-backed allocator, never from a clock. */
export function formatLeadFeeInvoiceNumber(input: { year: number; sequence: number }): string {
  if (!Number.isInteger(input.year) || input.year < 2000 || input.year > 9999) throw new RangeError(`Invalid invoice number year: ${input.year}`);
  if (!Number.isInteger(input.sequence) || input.sequence < 1) throw new RangeError(`Invalid invoice number sequence: ${input.sequence}`);
  return `${LEAD_FEE_INVOICE_SERIES}-${input.year}-${String(input.sequence).padStart(6, "0")}`;
}

/** Calendar year of `issuedAt` in Spain's civil time (so the number's year matches the local date near New Year). PROVISIONAL. */
export function leadFeeInvoiceYear(issuedAt: Date): number {
  const year = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric" }).format(issuedAt);
  return Number(year);
}

export interface BuildLeadFeeInvoiceInput {
  ledgerEntry: LeadFeeRevenueLedgerEntryRecord;
  purchase: LeadPurchaseRecord | null;
  /** M146 frozen snapshot: non-null only for a VERIFIED, complete identity. */
  billing: BillingIdentitySnapshot | null;
  config: LeadFeeInvoiceIssuanceConfig;
  issuedAt: Date;
}

function reject(reason: LeadFeeInvoiceRejectionReason): never {
  throw new LeadFeeInvoiceNotIssuableError(reason);
}

function exactMoney(value: unknown): bigint {
  const parsed = parseScaledDecimal(value, 2);
  return parsed === null ? reject("LEDGER_ENTRY_INVALID") : parsed;
}

/**
 * Builds the invoice to be recorded from the authoritative persisted facts, or throws
 * LeadFeeInvoiceNotIssuableError. Checks run cheapest/least-revealing first; the first failure decides.
 * No amount is recomputed: the IVA amount is only VERIFIED against the policy version stored with the entry.
 */
export function buildLeadFeeInvoiceDraft(input: BuildLeadFeeInvoiceInput): LeadFeeInvoiceDraft {
  const { ledgerEntry: entry, purchase, billing, config, issuedAt } = input;

  // 1. Operator boundary: no approval reference / no complete issuer -> closed.
  if (config.policyApprovalReference === null || config.policyApprovalReference.trim() === "") reject("POLICY_NOT_APPROVED");
  const issuer = config.issuer;
  if (!issuer || issuer.legalName.trim() === "" || issuer.address.trim() === "" || issuer.taxId.trim() === "" || isPlaceholderIssuerTaxId(issuer.taxId)) {
    reject("ISSUER_NOT_CONFIGURED");
  }

  // 2. The purchase must still be a confirmed, paid purchase (REFUNDED / REVOKED / pending / failed / cancelled never qualify).
  if (!purchase) reject("PURCHASE_NOT_FOUND");
  const confirmed = purchase;
  if (confirmed.status !== "CONFIRMED") reject("PURCHASE_NOT_CONFIRMED");

  // 3. The authoritative ledger entry must be the successful-payment entry and agree with the purchase's own snapshot.
  if (entry.entryType !== LEAD_FEE_PAYMENT_SUCCEEDED) reject("LEDGER_ENTRY_INVALID");
  const net = exactMoney(entry.netFeeAmount);
  const tax = exactMoney(entry.taxAmount);
  const total = exactMoney(entry.totalCollectedAmount);
  if (net <= 0n || total !== net + tax) reject("LEDGER_ENTRY_INVALID");
  const snapshot = confirmed.financialSnapshot;
  const sameMoney = (a: string | null, b: bigint): boolean => a !== null && parseScaledDecimal(a, 2) === b;
  if (
    confirmed.id !== entry.leadPurchaseId ||
    confirmed.leadId !== entry.leadId ||
    confirmed.professionalProfileId !== entry.professionalProfileId ||
    confirmed.paymentReference !== entry.paymentReference ||
    !sameMoney(snapshot.feeAmount, net) ||
    !sameMoney(snapshot.taxAmount, tax) ||
    !sameMoney(snapshot.totalAmount, total) ||
    snapshot.currency !== entry.currency
  ) {
    reject("LEDGER_PURCHASE_MISMATCH");
  }

  // 4. Tax: only a currency and a policy version whose rate this module can verify; the stored IVA must equal that policy's result.
  if (entry.currency !== LEAD_FEE_INVOICE_SUPPORTED_CURRENCY) reject("UNSUPPORTED_CURRENCY");
  const rateBps = LEAD_FEE_INVOICE_SUPPORTED_TAX_POLICIES[entry.taxPolicyVersion];
  if (rateBps === undefined) reject("UNSUPPORTED_TAX_POLICY");
  // Verification only (the persisted amount stays authoritative and is what gets invoiced).
  const verified = computeLeadFeeTax(formatScaledDecimal(net, 2, 2));
  if (verified.taxPolicyVersion !== entry.taxPolicyVersion || BigInt(verified.taxRateBps) !== rateBps || parseScaledDecimal(verified.taxAmount, 2) !== tax) {
    reject("TAX_AMOUNT_INCONSISTENT");
  }

  // 5. Recipient: a verified, complete billing identity of THIS professional, inside the supported tax scope.
  if (!billing) reject("BILLING_IDENTITY_NOT_READY");
  const recipient = billing;
  if (recipient.professionalProfileId !== entry.professionalProfileId || findBillingIdentityIssues(recipient).length > 0) {
    reject("BILLING_IDENTITY_NOT_READY");
  }
  if (
    recipient.taxCountry !== LEAD_FEE_INVOICE_SUPPORTED_RECIPIENT_COUNTRY ||
    recipient.country !== LEAD_FEE_INVOICE_SUPPORTED_RECIPIENT_COUNTRY
  ) {
    reject("UNSUPPORTED_RECIPIENT_COUNTRY");
  }
  const postalCode = recipient.postalCode.replace(/\s+/g, "");
  if (!/^\d{5}$/.test(postalCode) || LEAD_FEE_INVOICE_NON_IVA_POSTAL_PREFIXES.includes(postalCode.slice(0, 2))) reject("UNSUPPORTED_TAX_TERRITORY");

  const draft: LeadFeeInvoiceDraft = {
    ledgerEntryId: entry.id,
    leadPurchaseId: entry.leadPurchaseId,
    leadId: entry.leadId,
    professionalProfileId: entry.professionalProfileId,
    issuedAt: new Date(issuedAt.getTime()),
    paymentConfirmedAt: new Date(entry.paymentConfirmedAt.getTime()),
    currency: entry.currency,
    netFeeAmount: formatScaledDecimal(net, 2, 2),
    taxRateBps: Number(rateBps),
    taxAmount: formatScaledDecimal(tax, 2, 2),
    totalAmount: formatScaledDecimal(total, 2, 2),
    taxPolicyVersion: entry.taxPolicyVersion,
    description: LEAD_FEE_INVOICE_DESCRIPTION,
    issuerLegalName: issuer.legalName.trim(),
    issuerTaxId: issuer.taxId.trim(),
    issuerAddress: issuer.address.trim(),
    recipientEntityType: recipient.entityType,
    recipientLegalName: recipient.legalName,
    recipientTaxId: recipient.taxId,
    recipientTaxCountry: recipient.taxCountry,
    recipientAddressLine1: recipient.addressLine1,
    recipientAddressLine2: recipient.addressLine2,
    recipientCity: recipient.city,
    recipientRegion: recipient.region,
    recipientPostalCode: recipient.postalCode,
    recipientCountry: recipient.country,
    billingIdentityRevision: recipient.revision,
    billingIdentityVerifiedAt: new Date(recipient.verifiedAt.getTime()),
    rulesVersion: LEAD_FEE_INVOICE_RULES_VERSION,
    policyApprovalReference: config.policyApprovalReference.trim(),
  };
  return Object.freeze(draft);
}
