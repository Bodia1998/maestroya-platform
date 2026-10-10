import { DomainError } from "@/domain/errors/domain-error";
import { formatScaledDecimal, parseScaledDecimal } from "@/domain/services/fixed-point-decimal";
import {
  LEAD_FEE_INVOICE_NUMBER_PATTERN,
  LEAD_FEE_INVOICE_SUPPORTED_CURRENCY,
  LEAD_FEE_INVOICE_SUPPORTED_RECIPIENT_COUNTRY,
  LEAD_FEE_INVOICE_SUPPORTED_TAX_POLICIES,
  leadFeeInvoiceYear,
  resolveLeadFeeInvoiceIssuanceConfig,
  type LeadFeeInvoiceIssuer,
  type LeadFeeInvoiceRecord,
} from "@/domain/services/lead-fee-invoice";
import { isPlaceholderIssuerTaxId } from "@/domain/services/invoicing-issuer";
import { computeLeadFeeTax } from "@/domain/services/lead-fee-tax-policy";

/**
 * Module 151 — Lead-Fee Credit Note: pure domain rules (no I/O).
 *
 * WHAT THIS IS. The internal CREDIT NOTE RECORD that cancels, in FULL, ONE M150 lead-fee invoice. It is its own document
 * with POSITIVE credited amounts (it is not a negative invoice) that REFERENCES the invoice and carries an immutable
 * snapshot of the invoice reference, of the amounts credited, and of the issuer / recipient exactly as they were on the
 * invoice. The invoice and the M149 ledger entry are never edited or deleted: a credit note is a NEW row.
 *
 * WHAT THIS IS NOT. It is NOT a claim of legal compliance and it does NOT refund anything. The repository contains no
 * reviewed legal/accounting policy for credit notes of lead-fee invoices (when a credit is allowed, whether partial credits
 * exist, correction deadlines, VAT treatment of the credit, mandatory wording, numbering, delivery). The rules below are
 * therefore a FAIL-CLOSED boundary: only the one scenario that can be represented without inventing policy — a FULL credit
 * of one existing, internally consistent invoice, under an explicit operator-supplied approval reference — is accepted;
 * everything else is rejected with a typed reason and nothing is persisted or guessed. See
 * docs/MODULE_151_LEAD_FEE_CREDIT_NOTES.md.
 *
 * Out of scope by design (separate modules): refunding the Stripe payment (M153), revoking lead access, touching
 * professional balances, changing the lead-purchase status, reconciliation (M152), PDF / e-mail delivery.
 */

/** Counter series for lead-fee credit notes. Distinct from "LFI" (M150 invoices) and the legacy "INV" / "CN" series. PROVISIONAL. */
export const LEAD_FEE_CREDIT_NOTE_SERIES = "LFC";

/** Version of THESE technical rules. It identifies code behaviour only — it is NOT a legal approval. */
export const LEAD_FEE_CREDIT_NOTE_RULES_VERSION = "lead-fee-credit-note-rules-v1";

/** The only representable credit. Partial credits need a documented legal/product policy first (unresolved decision D-1). */
export const LEAD_FEE_CREDIT_NOTE_KIND_FULL = "FULL";

export const LEAD_FEE_CREDIT_NOTE_REASON_MAX_LENGTH = 500;

export const LEAD_FEE_CREDIT_NOTE_NUMBER_PATTERN = /^LFC-\d{4}-\d{6,}$/;

export const LEAD_FEE_CREDIT_NOTE_ENV = Object.freeze({
  /** Distinct from LEAD_FEE_INVOICE_POLICY_APPROVAL_REF: approving invoices is NOT approving credit notes. */
  policyApprovalReference: "LEAD_FEE_CREDIT_NOTE_POLICY_APPROVAL_REF",
});

export type LeadFeeCreditNoteRejectionReason =
  | "INPUT"
  | "INVOICE_NOT_FOUND"
  | "INVOICE_INVALID"
  | "UNSUPPORTED_CURRENCY"
  | "UNSUPPORTED_TAX_POLICY"
  | "TAX_AMOUNT_INCONSISTENT"
  | "UNSUPPORTED_RECIPIENT_COUNTRY"
  | "CREDIT_REASON_INVALID"
  | "CREDIT_EXCEEDS_INVOICE"
  | "PARTIAL_CREDIT_NOT_SUPPORTED"
  | "ISSUER_NOT_CONFIGURED"
  | "ISSUER_MISMATCH"
  | "POLICY_NOT_APPROVED";

/** A credit note cannot be issued. Closed reason, static message: never carries tax ids, names, addresses or the free-text reason. */
export class LeadFeeCreditNoteNotIssuableError extends DomainError {
  readonly code = "LEAD_FEE_CREDIT_NOTE_NOT_ISSUABLE";

  constructor(readonly reason: LeadFeeCreditNoteRejectionReason) {
    super("A lead-fee credit note cannot be issued for this lead purchase.");
  }
}

/** Operator-supplied issuance settings. Anything missing keeps issuance closed. */
export interface LeadFeeCreditNoteIssuanceConfig {
  /** The issuer currently configured by the operator (M150 variables). It must match the invoice's issuer; the snapshot comes from the invoice. */
  issuer: LeadFeeInvoiceIssuer | null;
  /** Reference of the reviewed legal/accounting approval of the CREDIT-NOTE policy. null = not approved = fail closed. */
  policyApprovalReference: string | null;
}

/**
 * Issuer variables are the M150 ones (same legal entity); the approval reference is a SEPARATE variable. No fallbacks,
 * no placeholder tax id, and the M150 approval reference is deliberately NOT accepted as approval of credit notes.
 */
export function resolveLeadFeeCreditNoteIssuanceConfig(env: Readonly<Record<string, string | undefined>>): LeadFeeCreditNoteIssuanceConfig {
  const raw = env[LEAD_FEE_CREDIT_NOTE_ENV.policyApprovalReference];
  const approval = typeof raw === "string" && raw.trim() !== "" ? raw.trim() : null;
  return { issuer: resolveLeadFeeInvoiceIssuanceConfig(env).issuer, policyApprovalReference: approval };
}

/** Caller-requested credit amounts (exact decimal strings). Optional: omitted means "the full invoice". Only the full amounts are accepted. */
export interface LeadFeeCreditNoteRequestedAmounts {
  netAmount: string;
  taxAmount: string;
  totalAmount: string;
}

/** Everything persisted for one credit note except what the repository allocates (id, number, createdAt). Money = exact 2-decimal strings. */
export interface LeadFeeCreditNoteDraft {
  leadFeeInvoiceId: string;
  /** Snapshot of the credited invoice's reference. */
  originalInvoiceNumber: string;
  originalInvoiceIssuedAt: Date;
  ledgerEntryId: string;
  leadPurchaseId: string;
  leadId: string;
  professionalProfileId: string;
  /** System clock at issuance. Which date is legally relevant is an OPEN decision; nothing here asserts it. */
  issuedAt: Date;
  creditKind: typeof LEAD_FEE_CREDIT_NOTE_KIND_FULL;
  reason: string;
  currency: string;
  creditedNetAmount: string;
  taxRateBps: number;
  creditedTaxAmount: string;
  creditedTotalAmount: string;
  taxPolicyVersion: string;
  issuerLegalName: string;
  issuerTaxId: string;
  issuerAddress: string;
  recipientEntityType: LeadFeeInvoiceRecord["recipientEntityType"];
  recipientLegalName: string;
  recipientTaxId: string;
  recipientTaxCountry: string;
  recipientAddressLine1: string;
  recipientAddressLine2: string | null;
  recipientCity: string;
  recipientRegion: string | null;
  recipientPostalCode: string;
  recipientCountry: string;
  rulesVersion: string;
  policyApprovalReference: string;
}

export interface LeadFeeCreditNoteRecord extends LeadFeeCreditNoteDraft {
  id: string;
  creditNoteNumber: string;
  createdAt: Date;
}

/** "LFC-2026-000123". The sequence must come from the database-backed allocator, never from a clock. */
export function formatLeadFeeCreditNoteNumber(input: { year: number; sequence: number }): string {
  if (!Number.isInteger(input.year) || input.year < 2000 || input.year > 9999) throw new RangeError(`Invalid credit note number year: ${input.year}`);
  if (!Number.isInteger(input.sequence) || input.sequence < 1) throw new RangeError(`Invalid credit note number sequence: ${input.sequence}`);
  return `${LEAD_FEE_CREDIT_NOTE_SERIES}-${input.year}-${String(input.sequence).padStart(6, "0")}`;
}

/** Calendar year of `issuedAt` in Spain's civil time — the same convention as the invoice number. PROVISIONAL. */
export function leadFeeCreditNoteYear(issuedAt: Date): number {
  return leadFeeInvoiceYear(issuedAt);
}

/** true when the requested amounts (any decimal spelling, e.g. "100" or "100.00") equal the stored credit note's amounts exactly. */
export function leadFeeCreditNoteAmountsEqual(creditNote: LeadFeeCreditNoteDraft, requested: LeadFeeCreditNoteRequestedAmounts): boolean {
  const pairs: [string, string][] = [
    [requested.netAmount, creditNote.creditedNetAmount],
    [requested.taxAmount, creditNote.creditedTaxAmount],
    [requested.totalAmount, creditNote.creditedTotalAmount],
  ];
  return pairs.every(([a, b]) => {
    const pa = parseScaledDecimal(a, 2);
    return pa !== null && pa === parseScaledDecimal(b, 2);
  });
}

export interface BuildLeadFeeCreditNoteInput {
  /** The persisted M150 invoice being credited (immutable). */
  invoice: LeadFeeInvoiceRecord;
  reason: string;
  /** Optional: when given it must equal the invoice's own amounts (full credit). */
  requestedAmounts?: LeadFeeCreditNoteRequestedAmounts | undefined;
  config: LeadFeeCreditNoteIssuanceConfig;
  issuedAt: Date;
}

function reject(reason: LeadFeeCreditNoteRejectionReason): never {
  throw new LeadFeeCreditNoteNotIssuableError(reason);
}

function invoiceMoney(value: unknown): bigint {
  const parsed = parseScaledDecimal(value, 2);
  return parsed === null ? reject("INVOICE_INVALID") : parsed;
}

function nonBlank(value: unknown): boolean {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Validates the credit reason: a plain, bounded, single-purpose free-text field (it is NOT legal wording and carries no
 * policy). Control characters are rejected so it cannot smuggle line breaks into later documents or logs.
 */
export function normalizeLeadFeeCreditNoteReason(reason: unknown): string {
  if (typeof reason !== "string") return reject("CREDIT_REASON_INVALID");
  const trimmed = reason.trim();
  if (trimmed === "" || trimmed.length > LEAD_FEE_CREDIT_NOTE_REASON_MAX_LENGTH || /[\u0000-\u001f\u007f]/.test(trimmed)) return reject("CREDIT_REASON_INVALID");
  return trimmed;
}

/**
 * Builds the credit note to be recorded from the persisted invoice, or throws LeadFeeCreditNoteNotIssuableError.
 * Checks run cheapest first; the first failure decides. Every credited amount is COPIED from the invoice (verified, never
 * recomputed or "repaired"); the issuer and recipient are the invoice's snapshot, never today's billing identity.
 */
export function buildLeadFeeCreditNoteDraft(input: BuildLeadFeeCreditNoteInput): LeadFeeCreditNoteDraft {
  const { invoice, config, issuedAt } = input;

  // 1. Input: the reason is a bounded, non-blank string.
  const reason = normalizeLeadFeeCreditNoteReason(input.reason);

  // 2. Operator boundary: no approval reference / no complete issuer -> closed.
  if (config.policyApprovalReference === null || config.policyApprovalReference.trim() === "") reject("POLICY_NOT_APPROVED");
  const configured = config.issuer;
  if (!configured || !nonBlank(configured.legalName) || !nonBlank(configured.address) || !nonBlank(configured.taxId) || isPlaceholderIssuerTaxId(configured.taxId)) {
    reject("ISSUER_NOT_CONFIGURED");
  }

  // 3. The invoice must be a well-formed M150 record (defence in depth: the database already guarantees this).
  if (
    !nonBlank(invoice.id) ||
    typeof invoice.invoiceNumber !== "string" ||
    !LEAD_FEE_INVOICE_NUMBER_PATTERN.test(invoice.invoiceNumber) ||
    !nonBlank(invoice.issuerLegalName) ||
    !nonBlank(invoice.issuerAddress) ||
    !nonBlank(invoice.issuerTaxId) ||
    isPlaceholderIssuerTaxId(invoice.issuerTaxId) ||
    !nonBlank(invoice.recipientLegalName) ||
    !nonBlank(invoice.recipientTaxId)
  ) {
    reject("INVOICE_INVALID");
  }
  const net = invoiceMoney(invoice.netFeeAmount);
  const tax = invoiceMoney(invoice.taxAmount);
  const total = invoiceMoney(invoice.totalAmount);
  if (net <= 0n || tax < 0n || total !== net + tax) reject("INVOICE_INVALID");

  // 4. Currency / tax: only what M150 can verify. The stored IVA must equal that policy's result (verification only).
  if (invoice.currency !== LEAD_FEE_INVOICE_SUPPORTED_CURRENCY) reject("UNSUPPORTED_CURRENCY");
  const rateBps = LEAD_FEE_INVOICE_SUPPORTED_TAX_POLICIES[invoice.taxPolicyVersion];
  if (rateBps === undefined) reject("UNSUPPORTED_TAX_POLICY");
  const verified = computeLeadFeeTax(formatScaledDecimal(net, 2, 2));
  if (
    BigInt(invoice.taxRateBps) !== rateBps ||
    verified.taxPolicyVersion !== invoice.taxPolicyVersion ||
    BigInt(verified.taxRateBps) !== rateBps ||
    parseScaledDecimal(verified.taxAmount, 2) !== tax
  ) {
    reject("TAX_AMOUNT_INCONSISTENT");
  }

  // 5. Jurisdiction: same restriction as the invoice (supported recipient country only).
  if (
    invoice.recipientTaxCountry !== LEAD_FEE_INVOICE_SUPPORTED_RECIPIENT_COUNTRY ||
    invoice.recipientCountry !== LEAD_FEE_INVOICE_SUPPORTED_RECIPIENT_COUNTRY
  ) {
    reject("UNSUPPORTED_RECIPIENT_COUNTRY");
  }

  // 6. Issuer: the configured legal entity must be the one that issued the invoice. The snapshot always comes from the invoice.
  if (configured.taxId.trim().toUpperCase() !== invoice.issuerTaxId.trim().toUpperCase()) reject("ISSUER_MISMATCH");

  // 7. Amounts: FULL credit only. A requested amount that exceeds the invoice is an over-credit; any other deviation is a partial credit.
  const requested = input.requestedAmounts;
  if (requested !== undefined) {
    const rn = parseScaledDecimal(requested.netAmount, 2);
    const rt = parseScaledDecimal(requested.taxAmount, 2);
    const rtot = parseScaledDecimal(requested.totalAmount, 2);
    if (rn === null || rt === null || rtot === null || rn <= 0n || rt < 0n || rtot !== rn + rt) reject("INPUT");
    if (rn > net || rt > tax || rtot > total) reject("CREDIT_EXCEEDS_INVOICE");
    if (rn !== net || rt !== tax || rtot !== total) reject("PARTIAL_CREDIT_NOT_SUPPORTED");
  }

  const draft: LeadFeeCreditNoteDraft = {
    leadFeeInvoiceId: invoice.id,
    originalInvoiceNumber: invoice.invoiceNumber,
    originalInvoiceIssuedAt: new Date(invoice.issuedAt.getTime()),
    ledgerEntryId: invoice.ledgerEntryId,
    leadPurchaseId: invoice.leadPurchaseId,
    leadId: invoice.leadId,
    professionalProfileId: invoice.professionalProfileId,
    issuedAt: new Date(issuedAt.getTime()),
    creditKind: LEAD_FEE_CREDIT_NOTE_KIND_FULL,
    reason,
    currency: invoice.currency,
    creditedNetAmount: formatScaledDecimal(net, 2, 2),
    taxRateBps: Number(rateBps),
    creditedTaxAmount: formatScaledDecimal(tax, 2, 2),
    creditedTotalAmount: formatScaledDecimal(total, 2, 2),
    taxPolicyVersion: invoice.taxPolicyVersion,
    issuerLegalName: invoice.issuerLegalName,
    issuerTaxId: invoice.issuerTaxId,
    issuerAddress: invoice.issuerAddress,
    recipientEntityType: invoice.recipientEntityType,
    recipientLegalName: invoice.recipientLegalName,
    recipientTaxId: invoice.recipientTaxId,
    recipientTaxCountry: invoice.recipientTaxCountry,
    recipientAddressLine1: invoice.recipientAddressLine1,
    recipientAddressLine2: invoice.recipientAddressLine2,
    recipientCity: invoice.recipientCity,
    recipientRegion: invoice.recipientRegion,
    recipientPostalCode: invoice.recipientPostalCode,
    recipientCountry: invoice.recipientCountry,
    rulesVersion: LEAD_FEE_CREDIT_NOTE_RULES_VERSION,
    policyApprovalReference: config.policyApprovalReference.trim(),
  };
  return Object.freeze(draft);
}
