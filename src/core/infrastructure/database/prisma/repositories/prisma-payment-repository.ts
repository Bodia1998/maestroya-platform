import { prisma } from "@/infrastructure/database/prisma/client";
import type { PaymentRecord, PaymentRepository, PaymentStatusValue } from "@/domain/repositories/payment-repository";

const SELECT = {
  id: true,
  serviceRequestId: true,
  quoteId: true,
  payerId: true,
  amount: true,
  currency: true,
  status: true,
  capturedAt: true,
  quote: { select: { job: { select: { id: true } } } },
} as const;

type Row = {
  id: string;
  serviceRequestId: string;
  quoteId: string | null;
  payerId: string;
  amount: unknown;
  currency: string;
  status: string;
  capturedAt: Date | null;
  quote: { job: { id: string } | null } | null;
};

function toRecord(row: Row): PaymentRecord {
  return {
    id: row.id,
    serviceRequestId: row.serviceRequestId,
    quoteId: row.quoteId,
    jobId: row.quote?.job?.id ?? null,
    payerId: row.payerId,
    amount: Number(row.amount),
    currency: row.currency,
    status: row.status as PaymentStatusValue,
    capturedAt: row.capturedAt,
  };
}

/**
 * Module 22 — Commission & Financial: read-only Prisma implementation of
 * PaymentRepository — see that interface's own doc comment on why this
 * never creates/captures a Payment (Module 12's job once implemented).
 */
export class PrismaPaymentRepository implements PaymentRepository {
  async findById(id: string): Promise<PaymentRecord | null> {
    const row = await prisma.payment.findUnique({ where: { id }, select: SELECT });
    return row ? toRecord(row) : null;
  }

  async findByJobId(jobId: string): Promise<PaymentRecord[]> {
    const rows = await prisma.payment.findMany({
      where: { quote: { job: { id: jobId } } },
      select: SELECT,
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toRecord);
  }

  async listForPayer(payerId: string): Promise<PaymentRecord[]> {
    const rows = await prisma.payment.findMany({
      where: { payerId },
      select: SELECT,
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toRecord);
  }

  async sumProcessedRefunds(paymentId: string): Promise<number> {
    const result = await prisma.refund.aggregate({
      where: { paymentId, status: "PROCESSED" },
      _sum: { amount: true },
    });
    return Number(result._sum.amount ?? 0);
  }
}
