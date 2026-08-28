import { createHash } from "node:crypto";

/**
 * Module 79 — Invoicing & Credit Notes: small, dependency-free (beyond
 * Node's built-in `crypto` — same convention `domain/services/
 * security-key.ts` already establishes) helpers for the document-hash and
 * invoice/credit-note number FORMAT concerns — never the number
 * ALLOCATION concern, which is inherently stateful/concurrent and lives
 * behind `InvoiceNumberAllocator` (a port, implemented against the
 * database — see `PrismaInvoiceNumberAllocator`).
 *
 * ## Document hash — what it is and is not
 * `computeDocumentHash` produces a deterministic SHA-256 digest over an
 * invoice's/credit note's own financial fields. This is a
 * tamper-evidence checksum ONLY: it lets a later reader detect that a
 * persisted row's financial fields differ from what was hashed at ISSUE
 * time. It is explicitly and deliberately NOT represented anywhere in
 * this module as a qualified electronic signature, a legally binding
 * signature, or any other form of legal attestation — see the module
 * brief's "IMPORTANT LEGAL/ACCOUNTING LIMITATION" section. No key,
 * certificate, or timestamping authority is involved; this is a plain,
 * unkeyed hash (unlike `hashSecret`, which is deliberately keyed to
 * resist reversal of a *secret* value — a document hash has no
 * confidentiality property to protect, only integrity).
 */
export interface InvoiceNumberFormatInput {
  year: number;
  sequence: number;
}

const INVOICE_NUMBER_SEQUENCE_WIDTH = 6;

/** "INV-2026-000123". Never derived from a timestamp alone (see the
 *  module brief's "NUMBERING" section) — `sequence` must come from
 *  `InvoiceNumberAllocator.allocateNext`, a concurrency-safe, database-
 *  backed counter, never a clock reading. */
export function formatInvoiceNumber({ year, sequence }: InvoiceNumberFormatInput): string {
  if (!Number.isInteger(year) || year < 2000 || year > 9999) {
    throw new RangeError(`Invalid invoice number year: ${year}`);
  }
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new RangeError(`Invalid invoice number sequence: ${sequence}`);
  }
  return `INV-${year}-${String(sequence).padStart(INVOICE_NUMBER_SEQUENCE_WIDTH, "0")}`;
}

/** "CN-2026-000045" — a distinct prefix/series from `formatInvoiceNumber`
 *  so the two document types' numbers are never visually or
 *  programmatically confusable, even though both are allocated via the
 *  same underlying per-year-counter mechanism. */
export function formatCreditNoteNumber({ year, sequence }: InvoiceNumberFormatInput): string {
  if (!Number.isInteger(year) || year < 2000 || year > 9999) {
    throw new RangeError(`Invalid credit note number year: ${year}`);
  }
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new RangeError(`Invalid credit note number sequence: ${sequence}`);
  }
  return `CN-${year}-${String(sequence).padStart(INVOICE_NUMBER_SEQUENCE_WIDTH, "0")}`;
}

/** Canonicalizes an arbitrary JSON-serializable value with sorted object
 *  keys, so `computeDocumentHash` is stable regardless of the property
 *  insertion order of the object it's given (JS object key order is
 *  otherwise part of the JSON.stringify output and would make the hash
 *  fragile to harmless refactors of the calling code). */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, val]) => [key, canonicalize(val)] as const);
    return Object.fromEntries(entries);
  }
  return value;
}

/** SHA-256 hex digest of `payload`'s canonical JSON form — see this
 *  file's own doc comment for what this is and is not. */
export function computeDocumentHash(payload: Record<string, unknown>): string {
  const canonicalJson = JSON.stringify(canonicalize(payload));
  return createHash("sha256").update(canonicalJson).digest("hex");
}
