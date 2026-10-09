import { prisma } from "@/infrastructure/database/prisma/client";
import type { LeadFeeRevenueLedgerRepository } from "@/domain/repositories/lead-fee-revenue-ledger-repository";
import { formatScaledDecimal, parseScaledDecimal } from "@/domain/services/fixed-point-decimal";
import {
  LEAD_FEE_PAYMENT_SUCCEEDED,
  LeadFeeLedgerConflictError,
  isSameLeadFeePayment,
  type LeadFeeLedgerEntryType,
  type LeadFeeRevenueLedgerEntryData,
  type LeadFeeRevenueLedgerEntryRecord,
} from "@/domain/services/lead-fee-revenue-ledger";

/** Prisma `create` data for an entry. Money stays a decimal STRING end to end (never a JS number). */
export function toLeadFeeLedgerCreateData(entry: LeadFeeRevenueLedgerEntryData) {
  return {
    entryType: entry.entryType,
    leadPurchaseId: entry.leadPurchaseId,
    leadId: entry.leadId,
    professionalProfileId: entry.professionalProfileId,
    paymentReference: entry.paymentReference,
    providerEventId: entry.providerEventId,
    providerEventCreatedAt: entry.providerEventCreatedAt,
    netFeeAmount: entry.netFeeAmount,
    taxAmount: entry.taxAmount,
    totalCollectedAmount: entry.totalCollectedAmount,
    currency: entry.currency,
    taxPolicyVersion: entry.taxPolicyVersion,
    pricingConfigVersion: entry.pricingConfigVersion,
    pricingRuleVersion: entry.pricingRuleVersion,
    paymentConfirmedAt: entry.paymentConfirmedAt,
  };
}

interface Row {
  id: string;
  entryType: string;
  leadPurchaseId: string;
  leadId: string;
  professionalProfileId: string;
  paymentReference: string;
  providerEventId: string;
  providerEventCreatedAt: Date | null;
  netFeeAmount: unknown;
  taxAmount: unknown;
  totalCollectedAmount: unknown;
  currency: string;
  taxPolicyVersion: string;
  pricingConfigVersion: string | null;
  pricingRuleVersion: string | null;
  paymentConfirmedAt: Date;
  recordedAt: Date;
}

function exactMoney(value: unknown, column: string): string {
  const parsed = parseScaledDecimal(String(value), 2);
  if (parsed === null) throw new Error(`LeadFeeLedgerEntry ${column} is not a valid Decimal(10,2).`);
  return formatScaledDecimal(parsed, 2, 2);
}

function toRecord(row: Row): LeadFeeRevenueLedgerEntryRecord {
  if (row.entryType !== LEAD_FEE_PAYMENT_SUCCEEDED) throw new Error(`Unknown LeadFeeLedgerEntry type "${row.entryType}".`);
  return {
    id: row.id,
    entryType: row.entryType,
    leadPurchaseId: row.leadPurchaseId,
    leadId: row.leadId,
    professionalProfileId: row.professionalProfileId,
    paymentReference: row.paymentReference,
    providerEventId: row.providerEventId,
    providerEventCreatedAt: row.providerEventCreatedAt,
    netFeeAmount: exactMoney(row.netFeeAmount, "netFeeAmount"),
    taxAmount: exactMoney(row.taxAmount, "taxAmount"),
    totalCollectedAmount: exactMoney(row.totalCollectedAmount, "totalCollectedAmount"),
    currency: row.currency,
    taxPolicyVersion: row.taxPolicyVersion,
    pricingConfigVersion: row.pricingConfigVersion,
    pricingRuleVersion: row.pricingRuleVersion,
    paymentConfirmedAt: row.paymentConfirmedAt,
    recordedAt: row.recordedAt,
  };
}

/** Module 149 — Prisma implementation of the append-only lead-fee revenue ledger (table `lead_fee_ledger_entries` only). */
export class PrismaLeadFeeRevenueLedgerRepository implements LeadFeeRevenueLedgerRepository {
  async recordIfAbsent(entry: LeadFeeRevenueLedgerEntryData): Promise<{ created: boolean; entry: LeadFeeRevenueLedgerEntryRecord }> {
    // ON CONFLICT DO NOTHING: concurrent callers race on the DB unique indexes; exactly one inserts.
    const { count } = await prisma.leadFeeLedgerEntry.createMany({ data: [toLeadFeeLedgerCreateData(entry)], skipDuplicates: true });
    const existing = await this.findByLeadPurchaseId(entry.leadPurchaseId, entry.entryType);
    if (!existing) {
      // Skipped by a conflict on a DIFFERENT unique key (same paymentReference, other purchase): never silent.
      throw new LeadFeeLedgerConflictError(entry.leadPurchaseId);
    }
    if (!isSameLeadFeePayment(existing, entry)) throw new LeadFeeLedgerConflictError(entry.leadPurchaseId);
    return { created: count === 1, entry: existing };
  }

  async findByLeadPurchaseId(
    leadPurchaseId: string,
    entryType: LeadFeeLedgerEntryType = LEAD_FEE_PAYMENT_SUCCEEDED,
  ): Promise<LeadFeeRevenueLedgerEntryRecord | null> {
    const row = await prisma.leadFeeLedgerEntry.findUnique({ where: { leadPurchaseId_entryType: { leadPurchaseId, entryType } } });
    return row ? toRecord(row) : null;
  }
}
