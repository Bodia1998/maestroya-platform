import { prisma } from "@/infrastructure/database/prisma/client";
import type {
  CreateCreditNoteData,
  CreditNoteLineItemRecord,
  CreditNoteRecord,
  CreditNoteRepository,
  CreditNoteStatusValue,
  IssueCreditNoteData,
} from "@/domain/repositories/credit-note-repository";

/**
 * Module 79 — Invoicing & Credit Notes. Same raw-SQL rationale as
 * `PrismaInvoiceRepository`/`PrismaSelfBillingAuthorizationRepository`.
 */

const CREDIT_NOTE_COLUMNS = `
  "id", "creditNoteNumber", "status", "originalInvoiceId",
  "professionalProfileId", "companyProfileId", "reason", "idempotencyKey",
  "issueDate", "currency", "reversedTaxableBase", "reversedVatRateBps",
  "reversedVatAmount", "reversedCommissionAmount",
  "reversedIrpfWithholdingAmount", "totalAmount", "documentHash",
  "cancelledAt", "cancelledByUserId", "createdAt", "updatedAt"
`;

interface CreditNoteRow {
  id: string;
  creditNoteNumber: string | null;
  status: string;
  originalInvoiceId: string;
  professionalProfileId: string | null;
  companyProfileId: string | null;
  reason: string;
  idempotencyKey: string;
  issueDate: Date | null;
  currency: string;
  reversedTaxableBase: unknown;
  reversedVatRateBps: number;
  reversedVatAmount: unknown;
  reversedCommissionAmount: unknown;
  reversedIrpfWithholdingAmount: unknown;
  totalAmount: unknown;
  documentHash: string | null;
  cancelledAt: Date | null;
  cancelledByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface LineItemRow {
  id: string;
  description: string;
  amount: unknown;
}

function toLineItem(row: LineItemRow): CreditNoteLineItemRecord {
  return { id: row.id, description: row.description, amount: Number(row.amount) };
}

async function fetchLineItems(creditNoteId: string): Promise<CreditNoteLineItemRecord[]> {
  const rows = await prisma.$queryRawUnsafe<LineItemRow[]>(
    `SELECT "id", "description", "amount" FROM "credit_note_line_items" WHERE "creditNoteId" = $1::uuid ORDER BY "id" ASC`,
    creditNoteId,
  );
  return rows.map(toLineItem);
}

function toRecord(row: CreditNoteRow, lineItems: CreditNoteLineItemRecord[]): CreditNoteRecord {
  return {
    id: row.id,
    creditNoteNumber: row.creditNoteNumber,
    status: row.status as CreditNoteStatusValue,
    originalInvoiceId: row.originalInvoiceId,
    professionalProfileId: row.professionalProfileId,
    companyProfileId: row.companyProfileId,
    reason: row.reason,
    idempotencyKey: row.idempotencyKey,
    issueDate: row.issueDate,
    currency: row.currency,
    lineItems,
    reversedTaxableBase: Number(row.reversedTaxableBase),
    reversedVatRateBps: row.reversedVatRateBps,
    reversedVatAmount: Number(row.reversedVatAmount),
    reversedCommissionAmount: Number(row.reversedCommissionAmount),
    reversedIrpfWithholdingAmount: Number(row.reversedIrpfWithholdingAmount),
    totalAmount: Number(row.totalAmount),
    documentHash: row.documentHash,
    cancelledAt: row.cancelledAt,
    cancelledByUserId: row.cancelledByUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PrismaCreditNoteRepository implements CreditNoteRepository {
  async findById(id: string): Promise<CreditNoteRecord | null> {
    const rows = await prisma.$queryRawUnsafe<CreditNoteRow[]>(`SELECT ${CREDIT_NOTE_COLUMNS} FROM "credit_notes" WHERE "id" = $1::uuid`, id);
    const row = rows[0];
    if (!row) return null;
    return toRecord(row, await fetchLineItems(row.id));
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<CreditNoteRecord | null> {
    const rows = await prisma.$queryRawUnsafe<CreditNoteRow[]>(`SELECT ${CREDIT_NOTE_COLUMNS} FROM "credit_notes" WHERE "idempotencyKey" = $1`, idempotencyKey);
    const row = rows[0];
    if (!row) return null;
    return toRecord(row, await fetchLineItems(row.id));
  }

  async listByOriginalInvoiceId(originalInvoiceId: string): Promise<CreditNoteRecord[]> {
    const rows = await prisma.$queryRawUnsafe<CreditNoteRow[]>(
      `SELECT ${CREDIT_NOTE_COLUMNS} FROM "credit_notes" WHERE "originalInvoiceId" = $1::uuid ORDER BY "createdAt" ASC`,
      originalInvoiceId,
    );
    return Promise.all(rows.map(async (row) => toRecord(row, await fetchLineItems(row.id))));
  }

  async sumCreditedAmountForInvoice(originalInvoiceId: string): Promise<number> {
    const rows = await prisma.$queryRawUnsafe<{ total: unknown }[]>(
      `SELECT COALESCE(SUM("totalAmount"), 0) AS "total" FROM "credit_notes"
       WHERE "originalInvoiceId" = $1::uuid AND "status" <> 'CANCELLED'`,
      originalInvoiceId,
    );
    return Number(rows[0]?.total ?? 0);
  }

  async createOrGetExisting(data: CreateCreditNoteData): Promise<CreditNoteRecord> {
    return prisma.$transaction(async (tx) => {
      const inserted = await tx.$queryRawUnsafe<CreditNoteRow[]>(
        `INSERT INTO "credit_notes" (
           "id", "status", "originalInvoiceId", "professionalProfileId", "companyProfileId",
           "reason", "idempotencyKey", "currency", "reversedTaxableBase", "reversedVatRateBps",
           "reversedVatAmount", "reversedCommissionAmount", "reversedIrpfWithholdingAmount",
           "totalAmount", "createdAt", "updatedAt"
         )
         VALUES (
           gen_random_uuid(), 'DRAFT', $1::uuid, $2::uuid, $3::uuid,
           $4, $5, $6, $7, $8,
           $9, $10, $11,
           $12, now(), now()
         )
         ON CONFLICT ("idempotencyKey") DO NOTHING
         RETURNING ${CREDIT_NOTE_COLUMNS}`,
        data.originalInvoiceId,
        data.professionalProfileId,
        data.companyProfileId,
        data.reason,
        data.idempotencyKey,
        data.currency,
        data.reversedTaxableBase,
        data.reversedVatRateBps,
        data.reversedVatAmount,
        data.reversedCommissionAmount,
        data.reversedIrpfWithholdingAmount,
        data.totalAmount,
      );

      const insertedRow = inserted[0];
      if (!insertedRow) {
        // Lost the race — a concurrent call with the same idempotencyKey
        // already won. Return that existing row (see this method's own
        // doc comment).
        const existing = await tx.$queryRawUnsafe<CreditNoteRow[]>(
          `SELECT ${CREDIT_NOTE_COLUMNS} FROM "credit_notes" WHERE "idempotencyKey" = $1`,
          data.idempotencyKey,
        );
        const row = existing[0];
        if (!row) {
          throw new Error(`credit_notes: unique violation on idempotencyKey "${data.idempotencyKey}" but no row found on re-read.`);
        }
        return toRecord(row, await fetchLineItems(row.id));
      }

      for (const item of data.lineItems) {
        await tx.$executeRawUnsafe(
          `INSERT INTO "credit_note_line_items" ("id", "creditNoteId", "description", "amount", "createdAt")
           VALUES (gen_random_uuid(), $1::uuid, $2, $3, now())`,
          insertedRow.id,
          item.description,
          item.amount,
        );
      }

      return toRecord(insertedRow, await fetchLineItems(insertedRow.id));
    });
  }

  async issue(data: IssueCreditNoteData): Promise<CreditNoteRecord> {
    const rows = await prisma.$queryRawUnsafe<CreditNoteRow[]>(
      `UPDATE "credit_notes"
       SET "status" = 'ISSUED', "creditNoteNumber" = $2, "issueDate" = $3, "documentHash" = $4, "updatedAt" = now()
       WHERE "id" = $1::uuid AND "status" = 'DRAFT'
       RETURNING ${CREDIT_NOTE_COLUMNS}`,
      data.id,
      data.creditNoteNumber,
      data.issueDate,
      data.documentHash,
    );
    const row = rows[0];
    if (row) return toRecord(row, await fetchLineItems(row.id));

    const existing = await prisma.$queryRawUnsafe<CreditNoteRow[]>(`SELECT ${CREDIT_NOTE_COLUMNS} FROM "credit_notes" WHERE "id" = $1::uuid`, data.id);
    const existingRow = existing[0];
    if (!existingRow) {
      throw new Error(`CreditNote ${data.id} disappeared during issue — this should never happen.`);
    }
    // Already ISSUED (idempotency race already handled by createOrGetExisting) — return as-is.
    return toRecord(existingRow, await fetchLineItems(existingRow.id));
  }
}
