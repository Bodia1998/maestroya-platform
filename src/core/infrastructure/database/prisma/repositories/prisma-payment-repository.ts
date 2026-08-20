import { Prisma } from "@prisma/client";

import { prisma } from "@/infrastructure/database/prisma/client";
import {
  ACTIVE_PAYMENT_STATUSES,
  type CreatePaymentRecordData,
  type PaymentRecord,
  type PaymentRepository,
  type PaymentStatusValue,
  type UpdatePaymentStatusInput,
  type UpdatePaymentStatusResult,
} from "@/domain/repositories/payment-repository";

const SELECT = {
  id: true,
  serviceRequestId: true,
  quoteId: true,
  payerId: true,
  amount: true,
  currency: true,
  status: true,
  capturedAt: true,
  stripePaymentIntentId: true,
  method: true,
  failureReason: true,
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
  stripePaymentIntentId: string | null;
  method: string;
  failureReason: string | null;
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
    status: row.status as PaymentRecord["status"],
    capturedAt: row.capturedAt,
    stripePaymentIntentId: row.stripePaymentIntentId,
    method: row.method as PaymentRecord["method"],
    failureReason: row.failureReason,
  };
}

/**
 * Module 22 — Commission & Financial (read side) / Module 73 — Real
 * Customer Payment Capture (write side): Prisma implementation of
 * `PaymentRepository`. See that interface's own doc comment for why the
 * write methods below extend, rather than duplicate, this class.
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

  async findByStripePaymentIntentId(stripePaymentIntentId: string): Promise<PaymentRecord | null> {
    const row = await prisma.payment.findUnique({ where: { stripePaymentIntentId }, select: SELECT });
    return row ? toRecord(row) : null;
  }

  async findActiveByQuoteId(quoteId: string): Promise<PaymentRecord | null> {
    const row = await prisma.payment.findFirst({
      where: { quoteId, status: { in: [...ACTIVE_PAYMENT_STATUSES] } },
      select: SELECT,
      orderBy: { createdAt: "desc" },
    });
    return row ? toRecord(row) : null;
  }

  /**
   * Upsert keyed on `stripePaymentIntentId` — see `PaymentRepository
   * .create`'s own doc comment for why this MUST NOT be a plain `create`.
   * The `update: {}` branch is intentionally a no-op: if a row for this
   * `stripePaymentIntentId` already exists (a concurrent caller won the
   * race), this call must return that existing row untouched, never
   * overwrite it with this caller's own (possibly different) generated
   * `id`/payload.
   */
  async create(data: CreatePaymentRecordData): Promise<PaymentRecord> {
    const row = await prisma.payment.upsert({
      where: { stripePaymentIntentId: data.stripePaymentIntentId },
      create: {
        id: data.id,
        serviceRequestId: data.serviceRequestId,
        quoteId: data.quoteId,
        payerId: data.payerId,
        amount: new Prisma.Decimal(data.amount),
        currency: data.currency,
        method: data.method,
        status: "PENDING",
        stripePaymentIntentId: data.stripePaymentIntentId,
      },
      update: {},
      select: SELECT,
    });
    return toRecord(row);
  }

  /**
   * Compare-and-swap update — see `UpdatePaymentStatusInput`'s own doc
   * comment for the full contract. Implemented as a single conditional
   * `updateMany` (never a separate read-then-write) so the guard and the
   * write happen atomically in one statement, the same pattern
   * `ProfessionalOnboardingRepository.updateStripeConnectAccountIfNotStale`
   * (Module 72) already establishes for this exact "no read-then-write
   * race window" requirement.
   */
  async updateStatus(input: UpdatePaymentStatusInput): Promise<UpdatePaymentStatusResult> {
    const data: Prisma.PaymentUpdateManyMutationInput = { status: input.toStatus };
    if (input.capturedAt !== undefined) data.capturedAt = input.capturedAt;
    if (input.failureReason !== undefined) data.failureReason = input.failureReason;

    const result = await prisma.payment.updateMany({
      where: { id: input.id, status: { in: [...input.fromStatuses] as PaymentStatusValue[] } },
      data,
    });

    const record = await this.findById(input.id);
    if (!record) {
      throw new Error(`Payment ${input.id} disappeared during updateStatus — this should never happen.`);
    }

    return { applied: result.count > 0, record };
  }
}
