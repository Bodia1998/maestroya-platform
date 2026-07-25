import { prisma } from "@/infrastructure/database/prisma/client";
import type {
  CreateLedgerEntryData,
  FinancialLedgerRepository,
  FinancialTransactionRecord,
  TransactionStatusValue,
  TransactionTypeValue,
} from "@/domain/repositories/financial-ledger-repository";

const SELECT = {
  id: true,
  paymentId: true,
  payoutId: true,
  refundId: true,
  commissionId: true,
  type: true,
  status: true,
  amount: true,
  currency: true,
  description: true,
  idempotencyKey: true,
  createdAt: true,
} as const;

type Row = {
  id: string;
  paymentId: string | null;
  payoutId: string | null;
  refundId: string | null;
  commissionId: string | null;
  type: string;
  status: string;
  amount: unknown;
  currency: string;
  description: string | null;
  idempotencyKey: string | null;
  createdAt: Date;
};

function toRecord(row: Row): FinancialTransactionRecord {
  return {
    id: row.id,
    paymentId: row.paymentId,
    payoutId: row.payoutId,
    refundId: row.refundId,
    commissionId: row.commissionId,
    type: row.type as TransactionTypeValue,
    status: row.status as TransactionStatusValue,
    amount: Number(row.amount),
    currency: row.currency,
    description: row.description,
    idempotencyKey: row.idempotencyKey,
    createdAt: row.createdAt,
  };
}

/**
 * Module 22 — Commission & Financial: Prisma implementation of the
 * append-only ledger. No `update`/`delete` method is exposed anywhere in
 * this class — see FinancialLedgerRepository's own doc comment on why the
 * ledger is immutable by construction, not just by convention.
 */
export class PrismaFinancialLedgerRepository implements FinancialLedgerRepository {
  async create(data: CreateLedgerEntryData): Promise<FinancialTransactionRecord> {
    const row = await prisma.transaction.create({
      data: {
        type: data.type,
        status: data.status ?? "COMPLETED",
        amount: data.amount,
        currency: data.currency ?? "EUR",
        paymentId: data.paymentId ?? null,
        payoutId: data.payoutId ?? null,
        refundId: data.refundId ?? null,
        commissionId: data.commissionId ?? null,
        description: data.description ?? null,
        idempotencyKey: data.idempotencyKey,
      },
      select: SELECT,
    });
    return toRecord(row);
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<FinancialTransactionRecord | null> {
    const row = await prisma.transaction.findUnique({ where: { idempotencyKey }, select: SELECT });
    return row ? toRecord(row) : null;
  }

  async listForPayment(paymentId: string): Promise<FinancialTransactionRecord[]> {
    const rows = await prisma.transaction.findMany({
      where: { paymentId },
      select: SELECT,
      orderBy: { createdAt: "asc" },
    });
    return rows.map(toRecord);
  }
}
