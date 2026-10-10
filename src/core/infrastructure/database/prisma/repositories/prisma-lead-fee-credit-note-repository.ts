import { Prisma } from "@prisma/client";

import { prisma } from "@/infrastructure/database/prisma/client";
import { allocateNextDocumentSequence } from "@/infrastructure/database/prisma/repositories/prisma-document-number-allocator";
import type { LeadFeeCreditNoteRepository } from "@/domain/repositories/lead-fee-credit-note-repository";
import { formatScaledDecimal, parseScaledDecimal } from "@/domain/services/fixed-point-decimal";
import {
  LEAD_FEE_CREDIT_NOTE_SERIES,
  LEAD_FEE_CREDIT_NOTE_KIND_FULL,
  formatLeadFeeCreditNoteNumber,
  leadFeeCreditNoteYear,
  type LeadFeeCreditNoteDraft,
  type LeadFeeCreditNoteRecord,
} from "@/domain/services/lead-fee-credit-note";

/** Prisma `create` data for a credit note. Money stays a decimal STRING end to end (never a JS number). */
export function toLeadFeeCreditNoteCreateData(draft: LeadFeeCreditNoteDraft, creditNoteNumber: string) {
  return {
    creditNoteNumber,
    leadFeeInvoiceId: draft.leadFeeInvoiceId,
    originalInvoiceNumber: draft.originalInvoiceNumber,
    originalInvoiceIssuedAt: draft.originalInvoiceIssuedAt,
    ledgerEntryId: draft.ledgerEntryId,
    leadPurchaseId: draft.leadPurchaseId,
    leadId: draft.leadId,
    professionalProfileId: draft.professionalProfileId,
    issuedAt: draft.issuedAt,
    creditKind: draft.creditKind,
    reason: draft.reason,
    currency: draft.currency,
    creditedNetAmount: draft.creditedNetAmount,
    taxRateBps: draft.taxRateBps,
    creditedTaxAmount: draft.creditedTaxAmount,
    creditedTotalAmount: draft.creditedTotalAmount,
    taxPolicyVersion: draft.taxPolicyVersion,
    issuerLegalName: draft.issuerLegalName,
    issuerTaxId: draft.issuerTaxId,
    issuerAddress: draft.issuerAddress,
    recipientEntityType: draft.recipientEntityType,
    recipientLegalName: draft.recipientLegalName,
    recipientTaxId: draft.recipientTaxId,
    recipientTaxCountry: draft.recipientTaxCountry,
    recipientAddressLine1: draft.recipientAddressLine1,
    recipientAddressLine2: draft.recipientAddressLine2,
    recipientCity: draft.recipientCity,
    recipientRegion: draft.recipientRegion,
    recipientPostalCode: draft.recipientPostalCode,
    recipientCountry: draft.recipientCountry,
    rulesVersion: draft.rulesVersion,
    policyApprovalReference: draft.policyApprovalReference,
  };
}

interface Row {
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
  reason: string;
  currency: string;
  creditedNetAmount: unknown;
  taxRateBps: number;
  creditedTaxAmount: unknown;
  creditedTotalAmount: unknown;
  taxPolicyVersion: string;
  issuerLegalName: string;
  issuerTaxId: string;
  issuerAddress: string;
  recipientEntityType: "INDIVIDUAL" | "COMPANY";
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
  createdAt: Date;
}

function exactMoney(value: unknown, column: string): string {
  const parsed = parseScaledDecimal(String(value), 2);
  if (parsed === null) throw new Error(`LeadFeeCreditNote ${column} is not a valid Decimal(10,2).`);
  return formatScaledDecimal(parsed, 2, 2);
}

function toRecord(row: Row): LeadFeeCreditNoteRecord {
  if (row.creditKind !== LEAD_FEE_CREDIT_NOTE_KIND_FULL) throw new Error("LeadFeeCreditNote creditKind is not a supported kind.");
  return {
    id: row.id,
    creditNoteNumber: row.creditNoteNumber,
    leadFeeInvoiceId: row.leadFeeInvoiceId,
    originalInvoiceNumber: row.originalInvoiceNumber,
    originalInvoiceIssuedAt: row.originalInvoiceIssuedAt,
    ledgerEntryId: row.ledgerEntryId,
    leadPurchaseId: row.leadPurchaseId,
    leadId: row.leadId,
    professionalProfileId: row.professionalProfileId,
    issuedAt: row.issuedAt,
    creditKind: LEAD_FEE_CREDIT_NOTE_KIND_FULL,
    reason: row.reason,
    currency: row.currency,
    creditedNetAmount: exactMoney(row.creditedNetAmount, "creditedNetAmount"),
    taxRateBps: row.taxRateBps,
    creditedTaxAmount: exactMoney(row.creditedTaxAmount, "creditedTaxAmount"),
    creditedTotalAmount: exactMoney(row.creditedTotalAmount, "creditedTotalAmount"),
    taxPolicyVersion: row.taxPolicyVersion,
    issuerLegalName: row.issuerLegalName,
    issuerTaxId: row.issuerTaxId,
    issuerAddress: row.issuerAddress,
    recipientEntityType: row.recipientEntityType,
    recipientLegalName: row.recipientLegalName,
    recipientTaxId: row.recipientTaxId,
    recipientTaxCountry: row.recipientTaxCountry,
    recipientAddressLine1: row.recipientAddressLine1,
    recipientAddressLine2: row.recipientAddressLine2,
    recipientCity: row.recipientCity,
    recipientRegion: row.recipientRegion,
    recipientPostalCode: row.recipientPostalCode,
    recipientCountry: row.recipientCountry,
    rulesVersion: row.rulesVersion,
    policyApprovalReference: row.policyApprovalReference,
    createdAt: row.createdAt,
  };
}

/**
 * Module 151 — Prisma implementation of the lead-fee credit note (table `lead_fee_credit_notes` + the shared `LFC`
 * counter row only). It never reads or writes the invoice, ledger, purchase, recipient-identity, payment or legacy
 * invoice / credit-note tables or their `INV` / `CN` counters: the migration's INSERT trigger verifies the draft
 * against the invoice inside the same transaction.
 */
export class PrismaLeadFeeCreditNoteRepository implements LeadFeeCreditNoteRepository {
  async issue(draft: LeadFeeCreditNoteDraft): Promise<{ created: boolean; creditNote: LeadFeeCreditNoteRecord }> {
    try {
      return await prisma.$transaction(async (tx) => {
        // 1. Serialise attempts for the SAME invoice (transaction-scoped; released on commit/rollback). A losing caller
        //    waits, then sees the winner's row below and returns it WITHOUT allocating a number. The unique index on
        //    the invoice id remains the final arbiter.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('lead_fee_credit_note'), hashtext(${draft.leadFeeInvoiceId}))`;

        const existing = await tx.leadFeeCreditNote.findUnique({ where: { leadFeeInvoiceId: draft.leadFeeInvoiceId } });
        if (existing) return { created: false, creditNote: toRecord(existing) };

        // 2. Allocate the number in the SAME transaction: any later failure (a rejecting trigger, a missing invoice FK)
        //    rolls the counter back — no burned number.
        const year = leadFeeCreditNoteYear(draft.issuedAt);
        const sequence = await allocateNextDocumentSequence(tx, LEAD_FEE_CREDIT_NOTE_SERIES, year);
        const creditNoteNumber = formatLeadFeeCreditNoteNumber({ year, sequence });

        const row = await tx.leadFeeCreditNote.create({ data: toLeadFeeCreditNoteCreateData(draft, creditNoteNumber) });
        return { created: true, creditNote: toRecord(row) };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        // Unreachable under the advisory lock; kept so a unique race can never surface as a duplicate or a raw error.
        const winner = await this.findByInvoiceId(draft.leadFeeInvoiceId);
        if (winner) return { created: false, creditNote: winner };
      }
      throw error;
    }
  }

  async findByInvoiceId(leadFeeInvoiceId: string): Promise<LeadFeeCreditNoteRecord | null> {
    const row = await prisma.leadFeeCreditNote.findUnique({ where: { leadFeeInvoiceId } });
    return row ? toRecord(row) : null;
  }

  async findByLeadPurchaseId(leadPurchaseId: string): Promise<LeadFeeCreditNoteRecord | null> {
    const row = await prisma.leadFeeCreditNote.findFirst({ where: { leadPurchaseId } });
    return row ? toRecord(row) : null;
  }
}
