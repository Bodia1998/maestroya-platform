import { DomainError } from "@/domain/errors/domain-error";
import { formatScaledDecimal, parseScaledDecimal } from "@/domain/services/fixed-point-decimal";
import { LEAD_FEE_CREDIT_NOTE_KIND_FULL, LEAD_FEE_CREDIT_NOTE_NUMBER_PATTERN } from "@/domain/services/lead-fee-credit-note";
import {
  LEAD_FEE_INVOICE_NUMBER_PATTERN,
  LEAD_FEE_INVOICE_SUPPORTED_CURRENCY,
  LEAD_FEE_INVOICE_SUPPORTED_TAX_POLICIES,
  leadFeeInvoiceYear,
} from "@/domain/services/lead-fee-invoice";
import { computeLeadFeeTax } from "@/domain/services/lead-fee-tax-policy";
import { LEAD_FEE_PAYMENT_SUCCEEDED } from "@/domain/services/lead-fee-revenue-ledger";

/**
 * Module 152 — Lead-Fee Document Reconciliation: pure, read-only rules (no I/O, no clock, no randomness).
 *
 * WHAT THIS IS. A consistency check between the persisted M149 ledger entries, M150 invoices and M151 credit notes. It
 * compares rows with each other under the rules M150 / M151 ACTUALLY implement and returns structured findings. The same
 * snapshot always yields the same findings in the same order. All money is compared as fixed-point `bigint` cents.
 *
 * WHAT THIS IS NOT. It is NOT a statement of legal, tax (IVA / AEAT) or accounting compliance, it repairs nothing, it
 * resolves nothing, and it never issues a document. A finding is evidence for a human reviewer, not a verdict: in
 * particular a ledger entry without an invoice is NOT a confirmed violation (the repository documents no issuance
 * deadline, and issuance is gated by operator configuration and the recipient's verified billing details (M146), which this check cannot see).
 * It also defines no net-revenue figure: invoices and credit notes are never added up or netted here.
 * See docs/MODULE_152_LEAD_FEE_DOCUMENT_RECONCILIATION.md for what is deliberately not checked.
 */

export const LEAD_FEE_RECONCILIATION_RULES_VERSION = "lead-fee-document-reconciliation-rules-v1";

export const LEAD_FEE_RECONCILIATION_NOTICE =
  "Technical consistency check of persisted records only. It is not a statement of legal, tax or accounting compliance, and a finding is not a confirmed violation.";

/** Same vocabulary as the Module 80 reconciliation framework. */
export type LeadFeeReconciliationSeverity = "INFO" | "WARNING" | "ERROR" | "CRITICAL";

/** AUTOMATIC: the persisted data alone proves the discrepancy. HUMAN_REVIEW_REQUIRED: only a person can classify it. */
export type LeadFeeReconciliationVerification = "AUTOMATIC" | "HUMAN_REVIEW_REQUIRED";

export type LeadFeeReconciliationSubjectKind = "LEDGER_ENTRY" | "INVOICE" | "CREDIT_NOTE";

/**
 * Severity rules (technical criteria only):
 *  - CRITICAL: a monetary value (amount, currency) contradicts the document it is derived from, or credits exceed what they credit.
 *  - ERROR:    a database-guaranteed invariant or a reference/snapshot relationship is violated (only reachable if constraints
 *              were bypassed or data was written outside the application), or a document is internally inconsistent.
 *  - WARNING:  an M150 / M151 application rule that the database does not enforce is violated, or a provisional-format rule.
 *  - INFO:     a state that may be legitimate pending an operational / legal decision (needs a person).
 */
export const LEAD_FEE_RECONCILIATION_CATALOG = {
  LEDGER_ENTRY_WITHOUT_INVOICE: { severity: "INFO", verification: "HUMAN_REVIEW_REQUIRED" },
  LEDGER_ENTRY_AMOUNTS_INVALID: { severity: "ERROR", verification: "AUTOMATIC" },

  INVOICE_LEDGER_ENTRY_MISSING: { severity: "ERROR", verification: "AUTOMATIC" },
  INVOICE_SOURCE_REFERENCE_MISMATCH: { severity: "ERROR", verification: "AUTOMATIC" },
  INVOICE_AMOUNT_MISMATCH: { severity: "CRITICAL", verification: "AUTOMATIC" },
  INVOICE_CURRENCY_MISMATCH: { severity: "CRITICAL", verification: "AUTOMATIC" },
  INVOICE_TAX_POLICY_MISMATCH: { severity: "ERROR", verification: "AUTOMATIC" },
  INVOICE_CONFIRMATION_TIME_MISMATCH: { severity: "ERROR", verification: "AUTOMATIC" },
  INVOICE_AMOUNTS_INVALID: { severity: "ERROR", verification: "AUTOMATIC" },
  INVOICE_CURRENCY_UNSUPPORTED: { severity: "WARNING", verification: "HUMAN_REVIEW_REQUIRED" },
  INVOICE_TAX_POLICY_UNSUPPORTED: { severity: "WARNING", verification: "HUMAN_REVIEW_REQUIRED" },
  INVOICE_TAX_INCONSISTENT: { severity: "WARNING", verification: "AUTOMATIC" },
  INVOICE_DUPLICATE_FOR_SOURCE: { severity: "ERROR", verification: "AUTOMATIC" },
  INVOICE_NUMBER_MALFORMED: { severity: "ERROR", verification: "AUTOMATIC" },
  INVOICE_NUMBER_DUPLICATE: { severity: "ERROR", verification: "AUTOMATIC" },
  INVOICE_NUMBER_YEAR_MISMATCH: { severity: "WARNING", verification: "HUMAN_REVIEW_REQUIRED" },

  CREDIT_NOTE_INVOICE_MISSING: { severity: "ERROR", verification: "AUTOMATIC" },
  CREDIT_NOTE_REFERENCE_MISMATCH: { severity: "ERROR", verification: "AUTOMATIC" },
  CREDIT_NOTE_CURRENCY_MISMATCH: { severity: "CRITICAL", verification: "AUTOMATIC" },
  CREDIT_NOTE_EXCEEDS_INVOICE: { severity: "CRITICAL", verification: "AUTOMATIC" },
  CREDIT_NOTE_PARTIAL_UNDER_FULL_ONLY_POLICY: { severity: "ERROR", verification: "AUTOMATIC" },
  CREDIT_NOTE_TAX_SNAPSHOT_MISMATCH: { severity: "ERROR", verification: "AUTOMATIC" },
  CREDIT_NOTE_PARTY_SNAPSHOT_MISMATCH: { severity: "ERROR", verification: "AUTOMATIC" },
  CREDIT_NOTE_AMOUNTS_INVALID: { severity: "ERROR", verification: "AUTOMATIC" },
  CREDIT_NOTE_KIND_UNSUPPORTED: { severity: "ERROR", verification: "AUTOMATIC" },
  CREDIT_NOTE_CURRENCY_UNSUPPORTED: { severity: "ERROR", verification: "AUTOMATIC" },
  CREDIT_NOTE_MULTIPLE_FOR_INVOICE: { severity: "ERROR", verification: "AUTOMATIC" },
  CREDIT_NOTE_CUMULATIVE_EXCEEDS_INVOICE: { severity: "CRITICAL", verification: "AUTOMATIC" },
  CREDIT_NOTE_NUMBER_MALFORMED: { severity: "ERROR", verification: "AUTOMATIC" },
  CREDIT_NOTE_NUMBER_DUPLICATE: { severity: "ERROR", verification: "AUTOMATIC" },
  CREDIT_NOTE_NUMBER_YEAR_MISMATCH: { severity: "WARNING", verification: "HUMAN_REVIEW_REQUIRED" },
  CREDIT_NOTE_ORIGINAL_NUMBER_MALFORMED: { severity: "ERROR", verification: "AUTOMATIC" },
} as const satisfies Record<string, { severity: LeadFeeReconciliationSeverity; verification: LeadFeeReconciliationVerification }>;

export type LeadFeeReconciliationFindingCode = keyof typeof LEAD_FEE_RECONCILIATION_CATALOG;

export const LEAD_FEE_RECONCILIATION_SEVERITIES: readonly LeadFeeReconciliationSeverity[] = ["CRITICAL", "ERROR", "WARNING", "INFO"];

// ---------------------------------------------------------------------------------------------------------------------
// Observed input (what the read-only adapter returns). Money = the database value as a decimal STRING; it is parsed here so
// that a malformed value becomes a finding instead of a crash. Free text (credit-note reason) is deliberately not part of it.
// ---------------------------------------------------------------------------------------------------------------------

export interface ObservedParty {
  issuerLegalName: string;
  issuerTaxId: string;
  issuerAddress: string;
  recipientEntityType: string;
  recipientLegalName: string;
  recipientTaxId: string;
  recipientTaxCountry: string;
  recipientAddressLine1: string;
  recipientAddressLine2: string | null;
  recipientCity: string;
  recipientRegion: string | null;
  recipientPostalCode: string;
  recipientCountry: string;
}

export interface ObservedLedgerEntry {
  id: string;
  entryType: string;
  leadPurchaseId: string;
  leadId: string;
  professionalProfileId: string;
  netFeeAmount: string;
  taxAmount: string;
  totalCollectedAmount: string;
  currency: string;
  taxPolicyVersion: string;
  paymentConfirmedAt: Date;
}

export interface ObservedInvoice extends ObservedParty {
  id: string;
  invoiceNumber: string;
  ledgerEntryId: string;
  leadPurchaseId: string;
  leadId: string;
  professionalProfileId: string;
  issuedAt: Date;
  paymentConfirmedAt: Date;
  currency: string;
  netFeeAmount: string;
  taxRateBps: number;
  taxAmount: string;
  totalAmount: string;
  taxPolicyVersion: string;
}

export interface ObservedCreditNote extends ObservedParty {
  id: string;
  creditNoteNumber: string;
  leadFeeInvoiceId: string;
  originalInvoiceNumber: string;
  originalInvoiceIssuedAt: Date;
  ledgerEntryId: string;
  leadPurchaseId: string;
  leadId: string;
  professionalProfileId: string;
  issuedAt: Date;
  creditKind: string;
  currency: string;
  creditedNetAmount: string;
  taxRateBps: number;
  creditedTaxAmount: string;
  creditedTotalAmount: string;
  taxPolicyVersion: string;
}

export interface ObservedPurchaseStatus {
  id: string;
  status: string;
}

/** A consistent, complete view of the three tables (plus the purchase status of every ledger entry) taken at one point in time. */
export interface LeadFeeReconciliationSnapshot {
  ledgerEntries: readonly ObservedLedgerEntry[];
  invoices: readonly ObservedInvoice[];
  creditNotes: readonly ObservedCreditNote[];
  purchaseStatuses: readonly ObservedPurchaseStatus[];
}

export interface LeadFeeReconciliationFinding {
  code: LeadFeeReconciliationFindingCode;
  severity: LeadFeeReconciliationSeverity;
  verification: LeadFeeReconciliationVerification;
  subject: { kind: LeadFeeReconciliationSubjectKind; id: string };
  ledgerEntryId: string | null;
  invoiceId: string | null;
  creditNoteId: string | null;
  leadPurchaseId: string | null;
  /** Invoice / credit-note number the finding is about, when it is about one. Never a name, tax id or address. */
  documentNumber: string | null;
  /** The compared field. */
  field: string | null;
  /** Value the authoritative side implies; null when not safe or not meaningful (e.g. party data is never echoed). */
  expected: string | null;
  observed: string | null;
  explanation: string;
}

/** Entries that were deliberately not evaluated for a missing invoice, by reason (always present, deterministic). */
export interface LeadFeeReconciliationNotEvaluated {
  /** The purchase is not CONFIRMED (e.g. REFUNDED / REVOKED): M150 would not issue an invoice, so an absent one is not reported. */
  ledgerEntriesWithPurchaseNotConfirmed: number;
  /** The purchase could not be found, so M150 eligibility cannot be judged. */
  ledgerEntriesWithPurchaseUnknown: number;
  /** The entry itself is not invoiceable under M150's data rules (invalid amounts, non-EUR, unknown tax policy, IVA not verifying). */
  ledgerEntriesNotInvoiceableByDataRules: number;
}

export interface LeadFeeReconciliationEvaluation {
  findings: LeadFeeReconciliationFinding[];
  notEvaluated: LeadFeeReconciliationNotEvaluated;
}

/** A snapshot exceeds the configured in-memory scope: reconciliation refuses rather than silently checking a subset. */
export class LeadFeeReconciliationScopeTooLargeError extends DomainError {
  readonly code = "LEAD_FEE_RECONCILIATION_SCOPE_TOO_LARGE";

  constructor(readonly table: string, readonly limit: number) {
    super("The lead-fee reconciliation scope exceeds the configured limit; no partial result is produced.");
  }
}

// ---------------------------------------------------------------------------------------------------------------------

const PARTY_FIELDS: readonly (keyof ObservedParty)[] = [
  "issuerLegalName",
  "issuerTaxId",
  "issuerAddress",
  "recipientEntityType",
  "recipientLegalName",
  "recipientTaxId",
  "recipientTaxCountry",
  "recipientAddressLine1",
  "recipientAddressLine2",
  "recipientCity",
  "recipientRegion",
  "recipientPostalCode",
  "recipientCountry",
];

const SUBJECT_ORDER: Record<LeadFeeReconciliationSubjectKind, number> = { LEDGER_ENTRY: 0, INVOICE: 1, CREDIT_NOTE: 2 };

const money = (value: unknown): bigint | null => parseScaledDecimal(value, 2);
const fmt = (value: bigint): string => formatScaledDecimal(value, 2, 2);
const iso = (value: Date): string => (Number.isNaN(value.getTime()) ? "invalid-date" : value.toISOString());

/** "LFI-2026-000001" -> { series, year, sequence } (sequence numeric, so zero-padding variants collide). null when malformed. */
function parseNumber(value: string, pattern: RegExp): { series: string; year: number; sequence: bigint } | null {
  if (typeof value !== "string" || !pattern.test(value)) return null;
  const [series, year, sequence] = value.split("-");
  return { series: series as string, year: Number(year), sequence: BigInt(sequence as string) };
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = groups.get(k);
    if (list) list.push(item);
    else groups.set(k, [item]);
  }
  return groups;
}

class Collector {
  readonly findings: LeadFeeReconciliationFinding[] = [];

  add(
    code: LeadFeeReconciliationFindingCode,
    subject: LeadFeeReconciliationFinding["subject"],
    refs: Partial<Pick<LeadFeeReconciliationFinding, "ledgerEntryId" | "invoiceId" | "creditNoteId" | "leadPurchaseId" | "documentNumber">>,
    detail: { field?: string | null; expected?: string | null; observed?: string | null; explanation: string },
  ): void {
    const rule = LEAD_FEE_RECONCILIATION_CATALOG[code];
    this.findings.push({
      code,
      severity: rule.severity,
      verification: rule.verification,
      subject,
      ledgerEntryId: refs.ledgerEntryId ?? null,
      invoiceId: refs.invoiceId ?? null,
      creditNoteId: refs.creditNoteId ?? null,
      leadPurchaseId: refs.leadPurchaseId ?? null,
      documentNumber: refs.documentNumber ?? null,
      field: detail.field ?? null,
      expected: detail.expected ?? null,
      observed: detail.observed ?? null,
      explanation: detail.explanation,
    });
  }
}

interface ParsedAmounts {
  net: bigint;
  tax: bigint;
  total: bigint;
}

function parseAmounts(net: string, tax: string, total: string): ParsedAmounts | null {
  const n = money(net);
  const t = money(tax);
  const g = money(total);
  return n === null || t === null || g === null ? null : { net: n, tax: t, total: g };
}

/** M150 / M149 data rule: net > 0, tax >= 0, total = net + tax (the same rule the CHECK constraints encode). */
const amountsConsistent = (a: ParsedAmounts): boolean => a.net > 0n && a.tax >= 0n && a.total === a.net + a.tax;

/** M150's tax verification (never a recalculation of what is invoiced): known policy, matching rate, IVA equal to the policy result. */
function taxVerification(version: string, rateBps: number | null, amounts: ParsedAmounts): "OK" | "UNSUPPORTED_POLICY" | "INCONSISTENT" {
  const supportedRate = LEAD_FEE_INVOICE_SUPPORTED_TAX_POLICIES[version];
  if (supportedRate === undefined) return "UNSUPPORTED_POLICY";
  if (rateBps !== null && BigInt(rateBps) !== supportedRate) return "INCONSISTENT";
  const verified = computeLeadFeeTax(fmt(amounts.net));
  return money(verified.taxAmount) === amounts.tax && verified.taxPolicyVersion === version ? "OK" : "INCONSISTENT";
}

export function evaluateLeadFeeDocumentReconciliation(snapshot: LeadFeeReconciliationSnapshot): LeadFeeReconciliationEvaluation {
  const out = new Collector();
  const notEvaluated: LeadFeeReconciliationNotEvaluated = {
    ledgerEntriesWithPurchaseNotConfirmed: 0,
    ledgerEntriesWithPurchaseUnknown: 0,
    ledgerEntriesNotInvoiceableByDataRules: 0,
  };

  const ledgerById = new Map(snapshot.ledgerEntries.map((e) => [e.id, e] as const));
  const invoiceById = new Map(snapshot.invoices.map((i) => [i.id, i] as const));
  const purchaseStatus = new Map(snapshot.purchaseStatuses.map((p) => [p.id, p.status] as const));
  const invoicesByLedgerEntry = groupBy(snapshot.invoices, (i) => i.ledgerEntryId);
  const invoicesByPurchase = groupBy(snapshot.invoices, (i) => i.leadPurchaseId);
  const creditNotesByInvoice = groupBy(snapshot.creditNotes, (c) => c.leadFeeInvoiceId);

  // ------------------------------------------------------------------------------------------ ledger entries
  for (const entry of snapshot.ledgerEntries) {
    const subject = { kind: "LEDGER_ENTRY", id: entry.id } as const;
    const refs = { ledgerEntryId: entry.id, leadPurchaseId: entry.leadPurchaseId };
    const amounts = parseAmounts(entry.netFeeAmount, entry.taxAmount, entry.totalCollectedAmount);
    const valid = amounts !== null && amountsConsistent(amounts);
    if (!valid) {
      out.add("LEDGER_ENTRY_AMOUNTS_INVALID", subject, refs, {
        field: "amounts",
        explanation: "The ledger entry's net / IVA / total are not valid exact amounts with net > 0, IVA >= 0 and total = net + IVA.",
      });
    }

    if (invoicesByLedgerEntry.has(entry.id) || invoicesByPurchase.has(entry.leadPurchaseId)) continue;

    // No invoice: only report when M150's DATA-derivable eligibility holds. Operator gates (issuer, approval reference),
    // the recipient's verified billing details and timing are NOT visible here, which is why the finding is INFO and needs a person.
    const status = purchaseStatus.get(entry.leadPurchaseId);
    if (status === undefined) {
      notEvaluated.ledgerEntriesWithPurchaseUnknown += 1;
      continue;
    }
    if (status !== "CONFIRMED") {
      notEvaluated.ledgerEntriesWithPurchaseNotConfirmed += 1;
      continue;
    }
    const invoiceable =
      entry.entryType === LEAD_FEE_PAYMENT_SUCCEEDED &&
      amounts !== null &&
      valid &&
      entry.currency === LEAD_FEE_INVOICE_SUPPORTED_CURRENCY &&
      taxVerification(entry.taxPolicyVersion, null, amounts) === "OK";
    if (!invoiceable) {
      notEvaluated.ledgerEntriesNotInvoiceableByDataRules += 1;
      continue;
    }
    out.add("LEDGER_ENTRY_WITHOUT_INVOICE", subject, refs, {
      field: "invoice",
      explanation:
        "A ledger entry for a CONFIRMED purchase has no M150 invoice. This is not a confirmed violation: no issuance deadline is documented, and issuance also depends on operator configuration and the recipient's verified billing details, which this check does not evaluate.",
    });
  }

  // ------------------------------------------------------------------------------------------ invoices
  const invoiceNumberGroups = groupBy(snapshot.invoices, (i) => {
    const p = parseNumber(i.invoiceNumber, LEAD_FEE_INVOICE_NUMBER_PATTERN);
    return p ? `${p.series}-${p.year}-${p.sequence}` : `raw:${i.invoiceNumber}`;
  });

  for (const invoice of snapshot.invoices) {
    const subject = { kind: "INVOICE", id: invoice.id } as const;
    const refs = { invoiceId: invoice.id, ledgerEntryId: invoice.ledgerEntryId, leadPurchaseId: invoice.leadPurchaseId, documentNumber: invoice.invoiceNumber };

    // -- document number
    const parsedNumber = parseNumber(invoice.invoiceNumber, LEAD_FEE_INVOICE_NUMBER_PATTERN);
    if (!parsedNumber) {
      out.add("INVOICE_NUMBER_MALFORMED", subject, refs, { field: "invoiceNumber", observed: String(invoice.invoiceNumber), explanation: "The invoice number does not match the M150 format LFI-YYYY-NNNNNN." });
    } else if (parsedNumber.year !== leadFeeInvoiceYear(invoice.issuedAt)) {
      out.add("INVOICE_NUMBER_YEAR_MISMATCH", subject, refs, {
        field: "invoiceNumber",
        expected: String(leadFeeInvoiceYear(invoice.issuedAt)),
        observed: String(parsedNumber.year),
        explanation: "The year in the invoice number differs from the year of issuedAt in Europe/Madrid civil time (the M150 convention; the numbering scheme is provisional).",
      });
    }
    const sameNumber = invoiceNumberGroups.get(parsedNumber ? `${parsedNumber.series}-${parsedNumber.year}-${parsedNumber.sequence}` : `raw:${invoice.invoiceNumber}`) ?? [];
    if (sameNumber.length > 1) {
      out.add("INVOICE_NUMBER_DUPLICATE", subject, refs, { field: "invoiceNumber", expected: "1", observed: String(sameNumber.length), explanation: "Several invoices share the same series, year and sequence." });
    }

    // -- duplicates per source
    const sameLedger = invoicesByLedgerEntry.get(invoice.ledgerEntryId) ?? [];
    if (sameLedger.length > 1) {
      out.add("INVOICE_DUPLICATE_FOR_SOURCE", subject, refs, { field: "ledgerEntryId", expected: "1", observed: String(sameLedger.length), explanation: "M150 allows at most one invoice per ledger entry." });
    }
    const samePurchase = invoicesByPurchase.get(invoice.leadPurchaseId) ?? [];
    if (samePurchase.length > 1) {
      out.add("INVOICE_DUPLICATE_FOR_SOURCE", subject, refs, { field: "leadPurchaseId", expected: "1", observed: String(samePurchase.length), explanation: "M150 allows at most one invoice per lead purchase." });
    }

    // -- internal consistency (M150's own data rules)
    const amounts = parseAmounts(invoice.netFeeAmount, invoice.taxAmount, invoice.totalAmount);
    if (amounts === null || !amountsConsistent(amounts)) {
      out.add("INVOICE_AMOUNTS_INVALID", subject, refs, { field: "amounts", explanation: "The invoice's net / IVA / total are not valid exact amounts with net > 0, IVA >= 0 and total = net + IVA." });
    }
    if (invoice.currency !== LEAD_FEE_INVOICE_SUPPORTED_CURRENCY) {
      out.add("INVOICE_CURRENCY_UNSUPPORTED", subject, refs, { field: "currency", expected: LEAD_FEE_INVOICE_SUPPORTED_CURRENCY, observed: invoice.currency, explanation: "M150 issues EUR invoices only." });
    }
    if (amounts !== null && amounts.net > 0n) {
      const tax = taxVerification(invoice.taxPolicyVersion, invoice.taxRateBps, amounts);
      if (tax === "UNSUPPORTED_POLICY") {
        out.add("INVOICE_TAX_POLICY_UNSUPPORTED", subject, refs, { field: "taxPolicyVersion", observed: invoice.taxPolicyVersion, explanation: "The invoice's tax-policy version is not one whose rate M150 can verify." });
      } else if (tax === "INCONSISTENT") {
        out.add("INVOICE_TAX_INCONSISTENT", subject, refs, { field: "taxAmount", explanation: "The invoice's IVA rate or amount does not equal the result of its stored tax-policy version (verification only; nothing is recalculated or repaired)." });
      }
    }

    // -- against the ledger entry
    const entry = ledgerById.get(invoice.ledgerEntryId);
    if (!entry) {
      out.add("INVOICE_LEDGER_ENTRY_MISSING", subject, refs, { field: "ledgerEntryId", observed: invoice.ledgerEntryId, explanation: "The invoice references a ledger entry that does not exist." });
      continue;
    }
    for (const field of ["leadPurchaseId", "leadId", "professionalProfileId"] as const) {
      if (invoice[field] !== entry[field]) {
        out.add("INVOICE_SOURCE_REFERENCE_MISMATCH", subject, refs, { field, expected: entry[field], observed: invoice[field], explanation: `The invoice's ${field} differs from its ledger entry's.` });
      }
    }
    if (invoice.currency !== entry.currency) {
      out.add("INVOICE_CURRENCY_MISMATCH", subject, refs, { field: "currency", expected: entry.currency, observed: invoice.currency, explanation: "The invoice currency differs from its ledger entry's." });
    }
    const entryAmounts = parseAmounts(entry.netFeeAmount, entry.taxAmount, entry.totalCollectedAmount);
    if (amounts !== null && entryAmounts !== null) {
      const pairs: [string, bigint, bigint][] = [
        ["netFeeAmount", entryAmounts.net, amounts.net],
        ["taxAmount", entryAmounts.tax, amounts.tax],
        ["totalAmount", entryAmounts.total, amounts.total],
      ];
      for (const [field, expected, observed] of pairs) {
        if (expected !== observed) {
          out.add("INVOICE_AMOUNT_MISMATCH", subject, refs, { field, expected: fmt(expected), observed: fmt(observed), explanation: `The invoice's ${field} differs from the authoritative ledger value (M150 copies it verbatim).` });
        }
      }
    }
    if (invoice.taxPolicyVersion !== entry.taxPolicyVersion) {
      out.add("INVOICE_TAX_POLICY_MISMATCH", subject, refs, { field: "taxPolicyVersion", expected: entry.taxPolicyVersion, observed: invoice.taxPolicyVersion, explanation: "The invoice's tax-policy version differs from its ledger entry's." });
    }
    if (invoice.paymentConfirmedAt.getTime() !== entry.paymentConfirmedAt.getTime()) {
      out.add("INVOICE_CONFIRMATION_TIME_MISMATCH", subject, refs, { field: "paymentConfirmedAt", expected: iso(entry.paymentConfirmedAt), observed: iso(invoice.paymentConfirmedAt), explanation: "The invoice's paymentConfirmedAt differs from its ledger entry's (M150 copies it unchanged)." });
    }
  }

  // ------------------------------------------------------------------------------------------ credit notes
  const creditNumberGroups = groupBy(snapshot.creditNotes, (c) => {
    const p = parseNumber(c.creditNoteNumber, LEAD_FEE_CREDIT_NOTE_NUMBER_PATTERN);
    return p ? `${p.series}-${p.year}-${p.sequence}` : `raw:${c.creditNoteNumber}`;
  });

  for (const note of snapshot.creditNotes) {
    const subject = { kind: "CREDIT_NOTE", id: note.id } as const;
    const refs = { creditNoteId: note.id, invoiceId: note.leadFeeInvoiceId, ledgerEntryId: note.ledgerEntryId, leadPurchaseId: note.leadPurchaseId, documentNumber: note.creditNoteNumber };

    // -- document numbers
    const parsedNumber = parseNumber(note.creditNoteNumber, LEAD_FEE_CREDIT_NOTE_NUMBER_PATTERN);
    if (!parsedNumber) {
      out.add("CREDIT_NOTE_NUMBER_MALFORMED", subject, refs, { field: "creditNoteNumber", observed: String(note.creditNoteNumber), explanation: "The credit-note number does not match the M151 format LFC-YYYY-NNNNNN." });
    } else if (parsedNumber.year !== leadFeeInvoiceYear(note.issuedAt)) {
      out.add("CREDIT_NOTE_NUMBER_YEAR_MISMATCH", subject, refs, {
        field: "creditNoteNumber",
        expected: String(leadFeeInvoiceYear(note.issuedAt)),
        observed: String(parsedNumber.year),
        explanation: "The year in the credit-note number differs from the year of issuedAt in Europe/Madrid civil time (the M151 convention; the numbering scheme is provisional).",
      });
    }
    const sameNumber = creditNumberGroups.get(parsedNumber ? `${parsedNumber.series}-${parsedNumber.year}-${parsedNumber.sequence}` : `raw:${note.creditNoteNumber}`) ?? [];
    if (sameNumber.length > 1) {
      out.add("CREDIT_NOTE_NUMBER_DUPLICATE", subject, refs, { field: "creditNoteNumber", expected: "1", observed: String(sameNumber.length), explanation: "Several credit notes share the same series, year and sequence." });
    }
    if (!LEAD_FEE_INVOICE_NUMBER_PATTERN.test(String(note.originalInvoiceNumber))) {
      out.add("CREDIT_NOTE_ORIGINAL_NUMBER_MALFORMED", subject, refs, { field: "originalInvoiceNumber", observed: String(note.originalInvoiceNumber), explanation: "The credited invoice's number snapshot does not match the M150 format LFI-YYYY-NNNNNN." });
    }

    // -- internal consistency (M151's own data rules)
    const credited = parseAmounts(note.creditedNetAmount, note.creditedTaxAmount, note.creditedTotalAmount);
    if (credited === null || !amountsConsistent(credited)) {
      out.add("CREDIT_NOTE_AMOUNTS_INVALID", subject, refs, { field: "amounts", explanation: "The credit note's net / IVA / total are not valid exact amounts with net > 0, IVA >= 0 and total = net + IVA." });
    }
    if (note.creditKind !== LEAD_FEE_CREDIT_NOTE_KIND_FULL) {
      out.add("CREDIT_NOTE_KIND_UNSUPPORTED", subject, refs, { field: "creditKind", expected: LEAD_FEE_CREDIT_NOTE_KIND_FULL, observed: String(note.creditKind), explanation: "M151 represents FULL credits only." });
    }
    if (note.currency !== LEAD_FEE_INVOICE_SUPPORTED_CURRENCY) {
      out.add("CREDIT_NOTE_CURRENCY_UNSUPPORTED", subject, refs, { field: "currency", expected: LEAD_FEE_INVOICE_SUPPORTED_CURRENCY, observed: note.currency, explanation: "M151 (and its database CHECK) allow EUR only." });
    }

    // -- against the invoice
    const invoice = invoiceById.get(note.leadFeeInvoiceId);
    if (!invoice) {
      out.add("CREDIT_NOTE_INVOICE_MISSING", subject, refs, { field: "leadFeeInvoiceId", observed: note.leadFeeInvoiceId, explanation: "The credit note references an invoice that does not exist." });
      continue;
    }
    const referenceChecks: [string, string, string][] = [
      ["originalInvoiceNumber", invoice.invoiceNumber, note.originalInvoiceNumber],
      ["originalInvoiceIssuedAt", iso(invoice.issuedAt), iso(note.originalInvoiceIssuedAt)],
      ["ledgerEntryId", invoice.ledgerEntryId, note.ledgerEntryId],
      ["leadPurchaseId", invoice.leadPurchaseId, note.leadPurchaseId],
      ["leadId", invoice.leadId, note.leadId],
      ["professionalProfileId", invoice.professionalProfileId, note.professionalProfileId],
    ];
    for (const [field, expected, observed] of referenceChecks) {
      if (expected !== observed) {
        out.add("CREDIT_NOTE_REFERENCE_MISMATCH", subject, refs, { field, expected, observed, explanation: `The credit note's ${field} snapshot differs from the credited invoice's.` });
      }
    }
    if (note.currency !== invoice.currency) {
      out.add("CREDIT_NOTE_CURRENCY_MISMATCH", subject, refs, { field: "currency", expected: invoice.currency, observed: note.currency, explanation: "The credit-note currency differs from the credited invoice's." });
    }
    if (note.taxRateBps !== invoice.taxRateBps || note.taxPolicyVersion !== invoice.taxPolicyVersion) {
      out.add("CREDIT_NOTE_TAX_SNAPSHOT_MISMATCH", subject, refs, {
        field: note.taxRateBps !== invoice.taxRateBps ? "taxRateBps" : "taxPolicyVersion",
        expected: note.taxRateBps !== invoice.taxRateBps ? String(invoice.taxRateBps) : invoice.taxPolicyVersion,
        observed: note.taxRateBps !== invoice.taxRateBps ? String(note.taxRateBps) : note.taxPolicyVersion,
        explanation: "The credit note's tax-rate / tax-policy snapshot differs from the credited invoice's.",
      });
    }
    for (const field of PARTY_FIELDS) {
      if (note[field] !== invoice[field]) {
        // Party data (names, tax ids, addresses) is never echoed into a finding.
        out.add("CREDIT_NOTE_PARTY_SNAPSHOT_MISMATCH", subject, refs, { field, explanation: `The credit note's ${field} snapshot differs from the credited invoice's (values withheld).` });
      }
    }
    const invoiceAmounts = parseAmounts(invoice.netFeeAmount, invoice.taxAmount, invoice.totalAmount);
    if (credited !== null && invoiceAmounts !== null) {
      const components: [string, bigint, bigint][] = [
        ["creditedNetAmount", invoiceAmounts.net, credited.net],
        ["creditedTaxAmount", invoiceAmounts.tax, credited.tax],
        ["creditedTotalAmount", invoiceAmounts.total, credited.total],
      ];
      for (const [field, invoiced, creditedValue] of components) {
        if (creditedValue > invoiced) {
          out.add("CREDIT_NOTE_EXCEEDS_INVOICE", subject, refs, { field, expected: fmt(invoiced), observed: fmt(creditedValue), explanation: `The credit note's ${field} is greater than the credited invoice's amount.` });
        } else if (creditedValue < invoiced) {
          out.add("CREDIT_NOTE_PARTIAL_UNDER_FULL_ONLY_POLICY", subject, refs, { field, expected: fmt(invoiced), observed: fmt(creditedValue), explanation: `The credit note's ${field} is smaller than the invoice's, but M151 only represents FULL credits.` });
        }
      }
    }
  }

  // ------------------------------------------------------------------------------------------ several credit notes per invoice
  // M151 policy: one FULL credit per invoice, so a second note is itself a violation and the cumulative credit necessarily exceeds
  // the invoice. Both are reported against the invoice; credited amounts are NEVER netted against the invoice into a revenue figure.
  for (const [invoiceId, notes] of creditNotesByInvoice) {
    if (notes.length < 2) continue;
    const invoice = invoiceById.get(invoiceId);
    const subject = { kind: "INVOICE", id: invoiceId } as const;
    const refs = { invoiceId, ledgerEntryId: invoice?.ledgerEntryId ?? null, leadPurchaseId: invoice?.leadPurchaseId ?? null, documentNumber: invoice?.invoiceNumber ?? null };
    out.add("CREDIT_NOTE_MULTIPLE_FOR_INVOICE", subject, refs, { field: "creditNotes", expected: "1", observed: String(notes.length), explanation: "M151 allows exactly one (FULL) credit note per invoice." });
    if (!invoice) continue;
    const invoiceAmounts = parseAmounts(invoice.netFeeAmount, invoice.taxAmount, invoice.totalAmount);
    if (invoiceAmounts === null) continue;
    const parsed = notes.map((n) => parseAmounts(n.creditedNetAmount, n.creditedTaxAmount, n.creditedTotalAmount));
    if (parsed.some((p) => p === null)) continue;
    const sum = (pick: (a: ParsedAmounts) => bigint): bigint => parsed.reduce((acc, p) => acc + pick(p as ParsedAmounts), 0n);
    const cumulative: [string, bigint, bigint][] = [
      ["creditedNetAmount", invoiceAmounts.net, sum((a) => a.net)],
      ["creditedTaxAmount", invoiceAmounts.tax, sum((a) => a.tax)],
      ["creditedTotalAmount", invoiceAmounts.total, sum((a) => a.total)],
    ];
    for (const [field, invoiced, total] of cumulative) {
      if (total > invoiced) {
        out.add("CREDIT_NOTE_CUMULATIVE_EXCEEDS_INVOICE", subject, refs, { field, expected: fmt(invoiced), observed: fmt(total), explanation: `The ${notes.length} credit notes of this invoice together exceed the invoiced amount for ${field}.` });
      }
    }
  }

  const findings = out.findings.sort(compareFindings);
  return { findings, notEvaluated };
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Total order, independent of input order: subject kind, subject id, code, field, observed. */
export function compareFindings(a: LeadFeeReconciliationFinding, b: LeadFeeReconciliationFinding): number {
  return (
    SUBJECT_ORDER[a.subject.kind] - SUBJECT_ORDER[b.subject.kind] ||
    cmp(a.subject.id, b.subject.id) ||
    cmp(a.code, b.code) ||
    cmp(a.field ?? "", b.field ?? "") ||
    cmp(a.observed ?? "", b.observed ?? "")
  );
}
