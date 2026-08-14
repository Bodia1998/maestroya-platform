import { prisma } from "@/infrastructure/database/prisma/client";
import { calculateQuoteItemAmount } from "@/domain/services/money";
import { OPEN_QUOTE_STATUSES } from "@/domain/services/quote-state";
import { DEFAULT_MATERIALS_STRATEGY } from "@/domain/value-objects/materials-strategy";
import type { MaterialsStrategyValue } from "@/domain/value-objects/materials-strategy";
import type {
  CreateQuoteData,
  QuoteItemInput,
  QuoteItemRecord,
  QuoteMaterialInput,
  QuoteMaterialRecord,
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
  // Module 63 — Materials Procurement Workflow.
  materialsStrategy: true,
  materialsConfirmedAt: true,
  materialsConfirmedByUserId: true,
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
  materials: {
    select: {
      id: true,
      name: true,
      brand: true,
      model: true,
      quantity: true,
      notes: true,
      sortOrder: true,
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
  materialsStrategy: string;
  materialsConfirmedAt: Date | null;
  materialsConfirmedByUserId: string | null;
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
  materials: {
    id: string;
    name: string;
    brand: string | null;
    model: string | null;
    quantity: unknown;
    notes: string | null;
    sortOrder: number;
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

function toMaterialRecord(row: PrismaQuoteRow["materials"][number]): QuoteMaterialRecord {
  return {
    id: row.id,
    name: row.name,
    brand: row.brand,
    model: row.model,
    quantity: Number(row.quantity),
    notes: row.notes,
    sortOrder: row.sortOrder,
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
    materialsStrategy: row.materialsStrategy as MaterialsStrategyValue,
    materials: row.materials.map(toMaterialRecord),
    materialsConfirmedAt: row.materialsConfirmedAt,
    materialsConfirmedByUserId: row.materialsConfirmedByUserId,
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

// Module 63 — Materials Procurement Workflow: mirrors toItemCreateData's own
// "index becomes sortOrder" convention. Callers (CreateQuoteUseCase/
// UpdateQuoteUseCase) have already run assertValidMaterialsList, so this
// never needs to re-validate — it only maps shape.
function toMaterialCreateData(materials: QuoteMaterialInput[]) {
  return materials.map((material, index) => ({
    name: material.name,
    brand: material.brand ?? null,
    model: material.model ?? null,
    quantity: material.quantity,
    notes: material.notes ?? null,
    sortOrder: index,
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
    const materialsStrategy = data.materialsStrategy ?? DEFAULT_MATERIALS_STRATEGY;
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
        materialsStrategy,
        materials: { create: toMaterialCreateData(data.materials ?? []) },
      },
      select: SELECT,
    });
    return toRecord(row);
  }

  async update(id: string, data: UpdateQuoteFields): Promise<QuoteRecord> {
    // Items and materials are always fully replaced on update (see
    // UpdateQuoteFields' doc comment) — deleteMany + create in the same
    // nested write, which Prisma runs as a single transaction, avoiding
    // stale/duplicate rows from a partial merge.
    const data_ = {
      totalAmount: data.totalAmount,
      currency: data.currency,
      validUntil: data.validUntil,
      notes: data.notes,
      items: {
        deleteMany: {},
        create: toItemCreateData(data.items),
      },
      ...(data.materialsStrategy !== undefined ? { materialsStrategy: data.materialsStrategy } : {}),
      ...(data.materials !== undefined
        ? { materials: { deleteMany: {}, create: toMaterialCreateData(data.materials) } }
        : {}),
    };
    const row = await prisma.quote.update({
      where: { id },
      data: data_,
      select: SELECT,
    });
    return toRecord(row);
  }

  async updateStatus(id: string, status: QuoteStatusValue): Promise<void> {
    await prisma.quote.update({ where: { id }, data: { status } });
  }

  async findExpirable(now: Date): Promise<QuoteRecord[]> {
    const rows = await prisma.quote.findMany({
      where: {
        status: { in: ["PENDING", "SENT", "VIEWED"] },
        validUntil: { lte: now },
      },
      select: SELECT,
    });
    return rows.map(toRecord);
  }

  async confirmMaterialsPurchased(quoteId: string, confirmedByUserId: string): Promise<QuoteRecord> {
    // Guarded by `materialsConfirmedAt: null` so a concurrent double-confirm
    // loses the race with a Prisma "record not found" error rather than
    // silently overwriting an already-set confirmation timestamp — same
    // "re-check state atomically inside the write, never trust a
    // previously-fetched record" discipline every other mutating method on
    // this repository follows (see updateStatus/update's own doc comments
    // and PrismaAppointmentRepository.confirm for the fullest example).
    const row = await prisma.quote.update({
      where: { id: quoteId, materialsConfirmedAt: null },
      data: {
        materialsConfirmedAt: new Date(),
        materialsConfirmedByUserId: confirmedByUserId,
      },
      select: SELECT,
    });
    return toRecord(row);
  }
}
