import { Prisma, type PrismaClient } from "@prisma/client";

import { prisma } from "@/infrastructure/database/prisma/client";
import type { LeadFeeDocumentReconciliationReader } from "@/domain/repositories/lead-fee-document-reconciliation-reader";
import {
  LeadFeeReconciliationScopeTooLargeError,
  type LeadFeeReconciliationSnapshot,
  type ObservedCreditNote,
  type ObservedInvoice,
  type ObservedLedgerEntry,
  type ObservedPurchaseStatus,
} from "@/domain/services/lead-fee-document-reconciliation";

export const DEFAULT_RECONCILIATION_PAGE_SIZE = 1_000;
export const DEFAULT_RECONCILIATION_MAX_ROWS_PER_TABLE = 200_000;
export const DEFAULT_RECONCILIATION_TRANSACTION_TIMEOUT_MS = 120_000;

export interface PrismaLeadFeeDocumentReconciliationReaderOptions {
  pageSize?: number;
  /** Per-table ceiling. Exceeding it throws LeadFeeReconciliationScopeTooLargeError — a subset is never silently reconciled. */
  maxRowsPerTable?: number;
  transactionTimeoutMs?: number;
  /**
   * Client whose `$transaction` is used. Defaults to the shared singleton. Exists so a test can OBSERVE the reader's real
   * transaction through a decorator without ever mutating the shared client (Prisma's client proxy reports `$transaction` as
   * an own property with value `undefined`, so saving/restoring its descriptor destroys it). Production composition roots pass nothing.
   */
  client?: Pick<PrismaClient, "$transaction">;
}

/** Exact 2-decimal string. A value that cannot be one stays unparseable and becomes a finding in the domain rules. */
const money = (value: Prisma.Decimal): string => value.toFixed(2);

/**
 * Module 152 — Prisma implementation of the READ-ONLY reconciliation reader.
 *
 * Only `findMany` is ever issued (static test). Everything happens in ONE interactive transaction that is READ ONLY and
 * REPEATABLE READ, so the three tables (and the purchase statuses) are seen at a single point in time even while the
 * application keeps issuing documents: no false "orphan" from reading the ledger before and an invoice after a concurrent
 * issuance. Rows are read with keyset paging on the primary key (deterministic order, bounded page size). Party data
 * is read only so snapshots can be compared; it never leaves the domain rules (findings do not echo it). The credit
 * note's free-text reason is not selected.
 */
export class PrismaLeadFeeDocumentReconciliationReader implements LeadFeeDocumentReconciliationReader {
  private readonly pageSize: number;
  private readonly maxRows: number;
  private readonly timeoutMs: number;
  private readonly client: Pick<PrismaClient, "$transaction">;

  constructor(options: PrismaLeadFeeDocumentReconciliationReaderOptions = {}) {
    this.client = options.client ?? prisma;
    this.pageSize = options.pageSize ?? DEFAULT_RECONCILIATION_PAGE_SIZE;
    this.maxRows = options.maxRowsPerTable ?? DEFAULT_RECONCILIATION_MAX_ROWS_PER_TABLE;
    this.timeoutMs = options.transactionTimeoutMs ?? DEFAULT_RECONCILIATION_TRANSACTION_TIMEOUT_MS;
    if (!Number.isInteger(this.pageSize) || this.pageSize < 1 || this.pageSize > 10_000) throw new RangeError("pageSize must be an integer in 1..10000");
    if (!Number.isInteger(this.maxRows) || this.maxRows < 1) throw new RangeError("maxRowsPerTable must be a positive integer");
  }

  async readSnapshot(): Promise<LeadFeeReconciliationSnapshot> {
    return this.client.$transaction(
      async (tx) => {
        // Belt and braces: the database itself refuses any write in this transaction. Must precede the first query.
        await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");

        const ledgerEntries: ObservedLedgerEntry[] = [];
        const purchaseStatuses: ObservedPurchaseStatus[] = [];
        let cursor: string | undefined;
        for (;;) {
          const rows = await tx.leadFeeLedgerEntry.findMany({
            orderBy: { id: "asc" },
            take: this.pageSize,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          });
          if (rows.length === 0) break;
          for (const r of rows) {
            ledgerEntries.push({
              id: r.id,
              entryType: r.entryType,
              leadPurchaseId: r.leadPurchaseId,
              leadId: r.leadId,
              professionalProfileId: r.professionalProfileId,
              netFeeAmount: money(r.netFeeAmount),
              taxAmount: money(r.taxAmount),
              totalCollectedAmount: money(r.totalCollectedAmount),
              currency: r.currency,
              taxPolicyVersion: r.taxPolicyVersion,
              paymentConfirmedAt: r.paymentConfirmedAt,
            });
          }
          this.assertWithinLimit("lead_fee_ledger_entries", ledgerEntries.length);
          const purchases = await tx.leadPurchase.findMany({
            where: { id: { in: rows.map((r) => r.leadPurchaseId) } },
            select: { id: true, status: true },
          });
          for (const p of purchases) purchaseStatuses.push({ id: p.id, status: p.status });
          cursor = rows[rows.length - 1]?.id;
          if (rows.length < this.pageSize) break;
        }

        const invoices: ObservedInvoice[] = [];
        let invoiceCursor: string | undefined;
        for (;;) {
          const rows = await tx.leadFeeInvoice.findMany({
            orderBy: { id: "asc" },
            take: this.pageSize,
            ...(invoiceCursor ? { cursor: { id: invoiceCursor }, skip: 1 } : {}),
          });
          if (rows.length === 0) break;
          for (const r of rows) {
            invoices.push({
              id: r.id,
              invoiceNumber: r.invoiceNumber,
              ledgerEntryId: r.ledgerEntryId,
              leadPurchaseId: r.leadPurchaseId,
              leadId: r.leadId,
              professionalProfileId: r.professionalProfileId,
              issuedAt: r.issuedAt,
              paymentConfirmedAt: r.paymentConfirmedAt,
              currency: r.currency,
              netFeeAmount: money(r.netFeeAmount),
              taxRateBps: r.taxRateBps,
              taxAmount: money(r.taxAmount),
              totalAmount: money(r.totalAmount),
              taxPolicyVersion: r.taxPolicyVersion,
              issuerLegalName: r.issuerLegalName,
              issuerTaxId: r.issuerTaxId,
              issuerAddress: r.issuerAddress,
              recipientEntityType: r.recipientEntityType,
              recipientLegalName: r.recipientLegalName,
              recipientTaxId: r.recipientTaxId,
              recipientTaxCountry: r.recipientTaxCountry,
              recipientAddressLine1: r.recipientAddressLine1,
              recipientAddressLine2: r.recipientAddressLine2,
              recipientCity: r.recipientCity,
              recipientRegion: r.recipientRegion,
              recipientPostalCode: r.recipientPostalCode,
              recipientCountry: r.recipientCountry,
            });
          }
          this.assertWithinLimit("lead_fee_invoices", invoices.length);
          invoiceCursor = rows[rows.length - 1]?.id;
          if (rows.length < this.pageSize) break;
        }

        const creditNotes: ObservedCreditNote[] = [];
        let creditNoteCursor: string | undefined;
        for (;;) {
          const rows = await tx.leadFeeCreditNote.findMany({
            orderBy: { id: "asc" },
            take: this.pageSize,
            ...(creditNoteCursor ? { cursor: { id: creditNoteCursor }, skip: 1 } : {}),
          });
          if (rows.length === 0) break;
          for (const r of rows) {
            creditNotes.push({
              id: r.id,
              creditNoteNumber: r.creditNoteNumber,
              leadFeeInvoiceId: r.leadFeeInvoiceId,
              originalInvoiceNumber: r.originalInvoiceNumber,
              originalInvoiceIssuedAt: r.originalInvoiceIssuedAt,
              ledgerEntryId: r.ledgerEntryId,
              leadPurchaseId: r.leadPurchaseId,
              leadId: r.leadId,
              professionalProfileId: r.professionalProfileId,
              issuedAt: r.issuedAt,
              creditKind: r.creditKind,
              currency: r.currency,
              creditedNetAmount: money(r.creditedNetAmount),
              taxRateBps: r.taxRateBps,
              creditedTaxAmount: money(r.creditedTaxAmount),
              creditedTotalAmount: money(r.creditedTotalAmount),
              taxPolicyVersion: r.taxPolicyVersion,
              issuerLegalName: r.issuerLegalName,
              issuerTaxId: r.issuerTaxId,
              issuerAddress: r.issuerAddress,
              recipientEntityType: r.recipientEntityType,
              recipientLegalName: r.recipientLegalName,
              recipientTaxId: r.recipientTaxId,
              recipientTaxCountry: r.recipientTaxCountry,
              recipientAddressLine1: r.recipientAddressLine1,
              recipientAddressLine2: r.recipientAddressLine2,
              recipientCity: r.recipientCity,
              recipientRegion: r.recipientRegion,
              recipientPostalCode: r.recipientPostalCode,
              recipientCountry: r.recipientCountry,
            });
          }
          this.assertWithinLimit("lead_fee_credit_notes", creditNotes.length);
          creditNoteCursor = rows[rows.length - 1]?.id;
          if (rows.length < this.pageSize) break;
        }

        return { ledgerEntries, invoices, creditNotes, purchaseStatuses };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: this.timeoutMs, maxWait: 10_000 },
    );
  }

  private assertWithinLimit(table: string, count: number): void {
    if (count > this.maxRows) throw new LeadFeeReconciliationScopeTooLargeError(table, this.maxRows);
  }
}
