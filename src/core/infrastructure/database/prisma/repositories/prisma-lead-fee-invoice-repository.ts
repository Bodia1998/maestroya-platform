import { Prisma } from "@prisma/client";

import { prisma } from "@/infrastructure/database/prisma/client";
import { allocateNextDocumentSequence } from "@/infrastructure/database/prisma/repositories/prisma-document-number-allocator";
import type { LeadFeeInvoiceRepository } from "@/domain/repositories/lead-fee-invoice-repository";
import { formatScaledDecimal, parseScaledDecimal } from "@/domain/services/fixed-point-decimal";
import {
  LEAD_FEE_INVOICE_SERIES,
  LeadFeeInvoiceNotIssuableError,
  formatLeadFeeInvoiceNumber,
  leadFeeInvoiceYear,
  type LeadFeeInvoiceDraft,
  type LeadFeeInvoiceRecord,
} from "@/domain/services/lead-fee-invoice";

/** Prisma `create` data for an invoice. Money stays a decimal STRING end to end (never a JS number). */
export function toLeadFeeInvoiceCreateData(draft: LeadFeeInvoiceDraft, invoiceNumber: string) {
  return {
    invoiceNumber,
    ledgerEntryId: draft.ledgerEntryId,
    leadPurchaseId: draft.leadPurchaseId,
    leadId: draft.leadId,
    professionalProfileId: draft.professionalProfileId,
    issuedAt: draft.issuedAt,
    paymentConfirmedAt: draft.paymentConfirmedAt,
    currency: draft.currency,
    netFeeAmount: draft.netFeeAmount,
    taxRateBps: draft.taxRateBps,
    taxAmount: draft.taxAmount,
    totalAmount: draft.totalAmount,
    taxPolicyVersion: draft.taxPolicyVersion,
    description: draft.description,
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
    billingIdentityRevision: draft.billingIdentityRevision,
    billingIdentityVerifiedAt: draft.billingIdentityVerifiedAt,
    rulesVersion: draft.rulesVersion,
    policyApprovalReference: draft.policyApprovalReference,
  };
}

interface Row {
  id: string;
  invoiceNumber: string;
  ledgerEntryId: string;
  leadPurchaseId: string;
  leadId: string;
  professionalProfileId: string;
  issuedAt: Date;
  paymentConfirmedAt: Date;
  currency: string;
  netFeeAmount: unknown;
  taxRateBps: number;
  taxAmount: unknown;
  totalAmount: unknown;
  taxPolicyVersion: string;
  description: string;
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
  billingIdentityRevision: number;
  billingIdentityVerifiedAt: Date;
  rulesVersion: string;
  policyApprovalReference: string;
  createdAt: Date;
}

function exactMoney(value: unknown, column: string): string {
  const parsed = parseScaledDecimal(String(value), 2);
  if (parsed === null) throw new Error(`LeadFeeInvoice ${column} is not a valid Decimal(10,2).`);
  return formatScaledDecimal(parsed, 2, 2);
}

function toRecord(row: Row): LeadFeeInvoiceRecord {
  return {
    id: row.id,
    invoiceNumber: row.invoiceNumber,
    ledgerEntryId: row.ledgerEntryId,
    leadPurchaseId: row.leadPurchaseId,
    leadId: row.leadId,
    professionalProfileId: row.professionalProfileId,
    issuedAt: row.issuedAt,
    paymentConfirmedAt: row.paymentConfirmedAt,
    currency: row.currency,
    netFeeAmount: exactMoney(row.netFeeAmount, "netFeeAmount"),
    taxRateBps: row.taxRateBps,
    taxAmount: exactMoney(row.taxAmount, "taxAmount"),
    totalAmount: exactMoney(row.totalAmount, "totalAmount"),
    taxPolicyVersion: row.taxPolicyVersion,
    description: row.description,
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
    billingIdentityRevision: row.billingIdentityRevision,
    billingIdentityVerifiedAt: row.billingIdentityVerifiedAt,
    rulesVersion: row.rulesVersion,
    policyApprovalReference: row.policyApprovalReference,
    createdAt: row.createdAt,
  };
}

/**
 * Module 150 — Prisma implementation of the lead-fee invoice (table `lead_fee_invoices` + the shared `LFI`
 * counter row only). Never touches the legacy `invoices` / `credit_notes` tables or their `INV` / `CN` counters.
 */
export class PrismaLeadFeeInvoiceRepository implements LeadFeeInvoiceRepository {
  async issue(draft: LeadFeeInvoiceDraft): Promise<{ created: boolean; invoice: LeadFeeInvoiceRecord }> {
    try {
      return await prisma.$transaction(async (tx) => {
        // 1. Serialise attempts for the SAME ledger entry (transaction-scoped; released on commit/rollback). A losing
        //    caller waits, then sees the winner's row below and returns it WITHOUT allocating a number. The unique
        //    indexes remain the final arbiter.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('lead_fee_invoice'), hashtext(${draft.ledgerEntryId}))`;

        const existing = await tx.leadFeeInvoice.findUnique({ where: { ledgerEntryId: draft.ledgerEntryId } });
        if (existing) return { created: false, invoice: toRecord(existing) };

        // 2. The recipient snapshot must still be the VERIFIED identity at the same revision. FOR SHARE holds off a
        //    concurrent edit until this transaction ends (the migration's INSERT trigger re-checks it as a backstop).
        const identity = await tx.$queryRaw<{ revision: number }[]>`
          SELECT "revision" FROM "professional_billing_identities"
          WHERE "professionalProfileId" = ${draft.professionalProfileId}::uuid AND "verificationStatus"::text = 'VERIFIED'
          FOR SHARE`;
        if (identity.length !== 1 || identity[0]?.revision !== draft.billingIdentityRevision) {
          throw new LeadFeeInvoiceNotIssuableError("BILLING_IDENTITY_CHANGED");
        }

        // 3. Allocate the number in the SAME transaction: any later failure rolls the counter back (no burned number).
        const year = leadFeeInvoiceYear(draft.issuedAt);
        const sequence = await allocateNextDocumentSequence(tx, LEAD_FEE_INVOICE_SERIES, year);
        const invoiceNumber = formatLeadFeeInvoiceNumber({ year, sequence });

        const row = await tx.leadFeeInvoice.create({ data: toLeadFeeInvoiceCreateData(draft, invoiceNumber) });
        return { created: true, invoice: toRecord(row) };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        // Unreachable under the advisory lock; kept so a unique race can never surface as a duplicate or a raw error.
        const winner = await this.findByLedgerEntryId(draft.ledgerEntryId);
        if (winner) return { created: false, invoice: winner };
      }
      throw error;
    }
  }

  async findByLedgerEntryId(ledgerEntryId: string): Promise<LeadFeeInvoiceRecord | null> {
    const row = await prisma.leadFeeInvoice.findUnique({ where: { ledgerEntryId } });
    return row ? toRecord(row) : null;
  }

  async findByLeadPurchaseId(leadPurchaseId: string): Promise<LeadFeeInvoiceRecord | null> {
    const row = await prisma.leadFeeInvoice.findUnique({ where: { leadPurchaseId } });
    return row ? toRecord(row) : null;
  }
}
