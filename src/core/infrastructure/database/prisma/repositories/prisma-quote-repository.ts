import { prisma } from "@/infrastructure/database/prisma/client";
import { calculateQuoteItemAmount } from "@/domain/services/money";
import { OPEN_QUOTE_STATUSES } from "@/domain/services/quote-state";
import type {
  CreateQuoteData,
  QuoteItemInput,
  QuoteItemRecord,
  QuoteRecord,
  QuoteRepository,
  QuoteStatusValue,
  UpdateQuoteFields,
} from "@/domain/repositories/quote-repository";

const SELECT = {
  id: true,
  serviceRequestId: true,
  professionalProfileId: true,
  submittedByUserId: true,
  status: true,
  totalAmount: true,
  currency: true,
  validUntil: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  items: {
    select: {
      id: true,
      description: true,
      quantity: true,
      unitPrice: true,
      amount: true,
      sortOrder: true,
      category: true,
    },
    orderBy: { sortOrder: "asc" as const },
  },
} as const;

type PrismaQuoteRow = {
  id: string;
  serviceRequestId: string;
  professionalProfileId: string | null;
  submittedByUserId: string;
  status: string;
  totalAmount: unknown;
  currency: string;
  validUntil: Date | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  items: {
    id: string;
    description: string;
    quantity: unknown;
    unitPrice: unknown;
    amount: unknown;
    sortOrder: number;
    category: string;
  }[];
};

function toItemRecord(row: PrismaQuoteRow["items"][number]): QuoteItemRecord {
  return {
    id: row.id,
    description: row.description,
    quantity: Number(row.quantity),
    unitPrice: Number(row.unitPrice),
    amount: Number(row.amount),
    sortOrder: row.sortOrder,
    category: row.category as QuoteItemRecord["category"],
  };
}

function toRecord(row: PrismaQuoteRow): QuoteRecord {
  return {
    id: row.id,
    serviceRequestId: row.serviceRequestId,
    // Offers/Quotes module only ever creates professional-owned quotes
    // (never companyProfileId, see quote-repository.ts scope note), so this
    // is always non-null for rows this module writes.
    professionalProfileId: row.professionalProfileId as string,
    submittedByUserId: row.submittedByUserId,
    status: row.status as QuoteStatusValue,
    totalAmount: Number(row.totalAmount),
    currency: row.currency,
    validUntil: row.validUntil,
    notes: row.notes,
    items: row.items.map(toItemRecord),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// `amount` is computed inline per item (rather than via a parallel
// `amounts` array indexed alongside `items`) so this never runs into
// `noUncheckedIndexedAccess`-style "possibly undefined" mismatches — each
// item's amount is always calculated from that exact item, using the same
// helper CreateQuoteUseCase/UpdateQuoteUseCase already used to compute the
// quote's total (see domain/services/money.ts), so the two can never drift
// apart no matter how this method is called.
function toItemCreateData(items: QuoteItemInput[]) {
  return items.map((item, index) => ({
    description: item.description,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    amount: calculateQuoteItemAmount(item.quantity, item.unitPrice),
    sortOrder: index,
    category: item.category ?? "LABOR",
  }));
}

export class PrismaQuoteRepository implements QuoteRepository {
  async findById(id: string): Promise<QuoteRecord | null> {
    const row = await prisma.quote.findUnique({ where: { id }, select: SELECT });
    return row ? toRecord(row) : null;
  }

  async findManyByProfessionalId(
    professionalProfileId: string,
    status?: QuoteStatusValue,
  ): Promise<QuoteRecord[]> {
    const rows = await prisma.quote.findMany({
      where: { professionalProfileId, ...(status ? { status } : {}) },
      select: SELECT,
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toRecord);
  }

  async findManyByServiceRequestId(serviceRequestId: string): Promise<QuoteRecord[]> {
    const rows = await prisma.quote.findMany({
      where: { serviceRequestId },
      select: SELECT,
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toRecord);
  }

  async findActiveByServiceRequestAndProfessional(
    serviceRequestId: string,
    professionalProfileId: string,
  ): Promise<QuoteRecord | null> {
    const row = await prisma.quote.findFirst({
      where: {
        serviceRequestId,
        professionalProfileId,
        status: { in: [...OPEN_QUOTE_STATUSES] },
      },
      select: SELECT,
    });
    return row ? toRecord(row) : null;
  }

  async findByServiceRequestAndProfessional(
    serviceRequestId: string,
    professionalProfileId: string,
  ): Promise<QuoteRecord | null> {
    const row = await prisma.quote.findFirst({
      where: { serviceRequestId, professionalProfileId },
      select: SELECT,
      orderBy: { createdAt: "desc" },
    });
    return row ? toRecord(row) : null;
  }

  async create(data: CreateQuoteData): Promise<QuoteRecord> {
    const row = await prisma.quote.create({
      data: {
        serviceRequestId: data.serviceRequestId,
        professionalProfileId: data.professionalProfileId,
        submittedByUserId: data.submittedByUserId,
        status: "SENT",
        totalAmount: data.totalAmount,
        currency: data.currency,
        validUntil: data.validUntil,
        notes: data.notes,
        items: { create: toItemCreateData(data.items) },
      },
      select: SELECT,
    });
    return toRecord(row);
  }

  async update(id: string, data: UpdateQuoteFields): Promise<QuoteRecord> {
    // Items are always fully replaced on update (see UpdateQuoteFields'
    // doc comment) — deleteMany + create in the same nested write, which
    // Prisma runs as a single transaction, avoiding stale/duplicate rows
    // from a partial merge.
    const row = await prisma.quote.update({
      where: { id },
      data: {
        totalAmount: data.totalAmount,
        currency: data.currency,
        validUntil: data.validUntil,
        notes: data.notes,
        items: {
          deleteMany: {},
          create: toItemCreateData(data.items),
        },
      },
      select: SELECT,
    });
    return toRecord(row);
  }

  async updateStatus(id: string, status: QuoteStatusValue): Promise<void> {
    await prisma.quote.update({ where: { id }, data: { status } });
  }
}
