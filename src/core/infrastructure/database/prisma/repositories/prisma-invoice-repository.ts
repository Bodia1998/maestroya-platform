import { prisma } from "@/infrastructure/database/prisma/client";
import type {
  AcceptInvoiceData,
  CancelInvoiceData,
  CreateInvoiceDraftData,
  InvoiceLineItemRecord,
  InvoiceRecord,
  InvoiceRepository,
  InvoiceStatusValue,
  IssueInvoiceData,
  UpdateInvoiceResult,
} from "@/domain/repositories/invoice-repository";

/**
 * Module 79 — Invoicing & Credit Notes.
 *
 * See `PrismaSelfBillingAuthorizationRepository`'s own doc comment for
 * why this is written against `prisma.$queryRawUnsafe`/`$executeRawUnsafe`
 * rather than `prisma.invoice.*` — the same pre-existing, environment-level
 * `prisma generate` network restriction, unrelated to this module's own
 * schema content.
 */

const INVOICE_COLUMNS = `
  "id", "invoiceNumber", "type", "status", "jobId", "quoteId", "paymentId",
  "professionalProfileId", "companyProfileId", "customerId",
  "issuerLegalName", "issuerTaxId", "recipientLegalName", "recipientTaxId",
  "selfBillingAuthorizationId", "issueDate", "invoiceDate", "acceptedAt",
  "acceptedByUserId", "acceptanceAgreementVersion", "currency",
  "taxableBase", "vatRateBps", "vatAmount", "commissionBase",
  "commissionRateBps", "commissionAmount", "irpfWithholdingRateBps",
  "irpfWithholdingAmount", "totalAmount", "documentHash", "version",
  "cancelledAt", "cancelledByUserId", "cancellationReason",
  "createdAt", "updatedAt"
`;

interface InvoiceRow {
  id: string;
  invoiceNumber: string | null;
  type: string;
  status: string;
  jobId: string;
  quoteId: string;
  paymentId: string | null;
  professionalProfileId: string | null;
  companyProfileId: string | null;
  customerId: string;
  issuerLegalName: string;
  issuerTaxId: string;
  recipientLegalName: string;
  recipientTaxId: string | null;
  selfBillingAuthorizationId: string;
  issueDate: Date | null;
  invoiceDate: Date;
  acceptedAt: Date | null;
  acceptedByUserId: string | null;
  acceptanceAgreementVersion: string | null;
  currency: string;
  taxableBase: unknown;
  vatRateBps: number;
  vatAmount: unknown;
  commissionBase: unknown;
  commissionRateBps: number;
  commissionAmount: unknown;
  irpfWithholdingRateBps: number;
  irpfWithholdingAmount: unknown;
  totalAmount: unknown;
  documentHash: string | null;
  version: number;
  cancelledAt: Date | null;
  cancelledByUserId: string | null;
  cancellationReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface LineItemRow {
  id: string;
  invoiceId: string;
  description: string;
  quantity: unknown;
  unitPrice: unknown;
  amount: unknown;
  sortOrder: number;
  category: string;
}

function toLineItem(row: LineItemRow): InvoiceLineItemRecord {
  return {
    id: row.id,
    description: row.description,
    quantity: Number(row.quantity),
    unitPrice: Number(row.unitPrice),
    amount: Number(row.amount),
    sortOrder: row.sortOrder,
    category: row.category as "LABOR" | "MATERIALS",
  };
}

async function fetchLineItems(invoiceId: string): Promise<InvoiceLineItemRecord[]> {
  const rows = await prisma.$queryRawUnsafe<LineItemRow[]>(
    `SELECT "id", "invoiceId", "description", "quantity", "unitPrice", "amount", "sortOrder", "category"
     FROM "invoice_line_items" WHERE "invoiceId" = $1::uuid ORDER BY "sortOrder" ASC`,
    invoiceId,
  );
  return rows.map(toLineItem);
}

function toRecord(row: InvoiceRow, lineItems: InvoiceLineItemRecord[]): InvoiceRecord {
  return {
    id: row.id,
    invoiceNumber: row.invoiceNumber,
    type: row.type as InvoiceRecord["type"],
    status: row.status as InvoiceStatusValue,
    jobId: row.jobId,
    quoteId: row.quoteId,
    paymentId: row.paymentId,
    professionalProfileId: row.professionalProfileId,
    companyProfileId: row.companyProfileId,
    customerId: row.customerId,
    issuerLegalName: row.issuerLegalName,
    issuerTaxId: row.issuerTaxId,
    recipientLegalName: row.recipientLegalName,
    recipientTaxId: row.recipientTaxId,
    selfBillingAuthorizationId: row.selfBillingAuthorizationId,
    issueDate: row.issueDate,
    invoiceDate: row.invoiceDate,
    acceptedAt: row.acceptedAt,
    acceptedByUserId: row.acceptedByUserId,
    acceptanceAgreementVersion: row.acceptanceAgreementVersion,
    currency: row.currency,
    lineItems,
    taxableBase: Number(row.taxableBase),
    vatRateBps: row.vatRateBps,
    vatAmount: Number(row.vatAmount),
    commissionBase: Number(row.commissionBase),
    commissionRateBps: row.commissionRateBps,
    commissionAmount: Number(row.commissionAmount),
    irpfWithholdingRateBps: row.irpfWithholdingRateBps,
    irpfWithholdingAmount: Number(row.irpfWithholdingAmount),
    totalAmount: Number(row.totalAmount),
    documentHash: row.documentHash,
    version: row.version,
    selfBilled: true,
    cancelledAt: row.cancelledAt,
    cancelledByUserId: row.cancelledByUserId,
    cancellationReason: row.cancellationReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PrismaInvoiceRepository implements InvoiceRepository {
  async findById(id: string): Promise<InvoiceRecord | null> {
    const rows = await prisma.$queryRawUnsafe<InvoiceRow[]>(`SELECT ${INVOICE_COLUMNS} FROM "invoices" WHERE "id" = $1::uuid`, id);
    const row = rows[0];
    if (!row) return null;
    return toRecord(row, await fetchLineItems(row.id));
  }

  async findByJobId(jobId: string): Promise<InvoiceRecord | null> {
    const rows = await prisma.$queryRawUnsafe<InvoiceRow[]>(
      `SELECT ${INVOICE_COLUMNS} FROM "invoices" WHERE "jobId" = $1::uuid AND "status" <> 'CANCELLED' ORDER BY "createdAt" DESC LIMIT 1`,
      jobId,
    );
    const row = rows[0];
    if (!row) return null;
    return toRecord(row, await fetchLineItems(row.id));
  }

  async findByInvoiceNumber(invoiceNumber: string): Promise<InvoiceRecord | null> {
    const rows = await prisma.$queryRawUnsafe<InvoiceRow[]>(`SELECT ${INVOICE_COLUMNS} FROM "invoices" WHERE "invoiceNumber" = $1`, invoiceNumber);
    const row = rows[0];
    if (!row) return null;
    return toRecord(row, await fetchLineItems(row.id));
  }

  async listForProfessional(professionalProfileId: string, options: { limit: number; offset: number }): Promise<InvoiceRecord[]> {
    const rows = await prisma.$queryRawUnsafe<InvoiceRow[]>(
      `SELECT ${INVOICE_COLUMNS} FROM "invoices" WHERE "professionalProfileId" = $1::uuid
       ORDER BY "createdAt" DESC LIMIT $2 OFFSET $3`,
      professionalProfileId,
      options.limit,
      options.offset,
    );
    return Promise.all(rows.map(async (row) => toRecord(row, await fetchLineItems(row.id))));
  }

  async createDraft(data: CreateInvoiceDraftData): Promise<InvoiceRecord> {
    return prisma.$transaction(async (tx) => {
      const inserted = await tx.$queryRawUnsafe<InvoiceRow[]>(
        `INSERT INTO "invoices" (
           "id", "type", "status", "jobId", "quoteId", "paymentId",
           "professionalProfileId", "companyProfileId", "customerId",
           "issuerLegalName", "issuerTaxId", "recipientLegalName", "recipientTaxId",
           "selfBillingAuthorizationId", "invoiceDate", "currency",
           "taxableBase", "vatRateBps", "vatAmount", "commissionBase",
           "commissionRateBps", "commissionAmount", "irpfWithholdingRateBps",
           "irpfWithholdingAmount", "totalAmount", "version",
           "createdAt", "updatedAt"
         )
         VALUES (
           gen_random_uuid(), 'PROFESSIONAL_SELF_BILLED', 'DRAFT', $1::uuid, $2::uuid, $3::uuid,
           $4::uuid, $5::uuid, $6::uuid,
           $7, $8, $9, $10,
           $11::uuid, $12, $13,
           $14, $15, $16, $17,
           $18, $19, $20,
           $21, $22, 1,
           now(), now()
         )
         RETURNING ${INVOICE_COLUMNS}`,
        data.jobId,
        data.quoteId,
        data.paymentId,
        data.professionalProfileId,
        data.companyProfileId,
        data.customerId,
        data.issuerLegalName,
        data.issuerTaxId,
        data.recipientLegalName,
        data.recipientTaxId,
        data.selfBillingAuthorizationId,
        data.invoiceDate,
        data.currency,
        data.taxableBase,
        data.vatRateBps,
        data.vatAmount,
        data.commissionBase,
        data.commissionRateBps,
        data.commissionAmount,
        data.irpfWithholdingRateBps,
        data.irpfWithholdingAmount,
        data.totalAmount,
      );

      const invoice = inserted[0]!;

      for (let i = 0; i < data.lineItems.length; i++) {
        const item = data.lineItems[i]!;
        await tx.$executeRawUnsafe(
          `INSERT INTO "invoice_line_items" ("id", "invoiceId", "description", "quantity", "unitPrice", "amount", "sortOrder", "category", "createdAt")
           VALUES (gen_random_uuid(), $1::uuid, $2, $3, $4, $5, $6, $7::"InvoiceLineItemCategory", now())`,
          invoice.id,
          item.description,
          item.quantity,
          item.unitPrice,
          item.amount,
          i,
          item.category,
        );
      }

      const lineItems = await tx.$queryRawUnsafe<LineItemRow[]>(
        `SELECT "id", "invoiceId", "description", "quantity", "unitPrice", "amount", "sortOrder", "category"
         FROM "invoice_line_items" WHERE "invoiceId" = $1::uuid ORDER BY "sortOrder" ASC`,
        invoice.id,
      );

      return toRecord(invoice, lineItems.map(toLineItem));
    });
  }

  async submitForAcceptance(id: string, fromStatuses: readonly InvoiceStatusValue[]): Promise<UpdateInvoiceResult> {
    const rows = await prisma.$queryRawUnsafe<InvoiceRow[]>(
      `UPDATE "invoices" SET "status" = 'PENDING_ACCEPTANCE', "updatedAt" = now()
       WHERE "id" = $1::uuid AND "status" = ANY($2::"InvoiceStatus"[])
       RETURNING ${INVOICE_COLUMNS}`,
      id,
      [...fromStatuses],
    );
    return this.resultFor(id, rows[0]);
  }

  async accept(data: AcceptInvoiceData): Promise<UpdateInvoiceResult> {
    const rows = await prisma.$queryRawUnsafe<InvoiceRow[]>(
      `UPDATE "invoices"
       SET "status" = 'ACCEPTED', "acceptedAt" = $2, "acceptedByUserId" = $3::uuid,
           "acceptanceAgreementVersion" = $4, "updatedAt" = now()
       WHERE "id" = $1::uuid AND "status" = ANY($5::"InvoiceStatus"[])
       RETURNING ${INVOICE_COLUMNS}`,
      data.id,
      data.acceptedAt,
      data.acceptedByUserId,
      data.acceptanceAgreementVersion,
      [...data.fromStatuses],
    );
    return this.resultFor(data.id, rows[0]);
  }

  async issue(data: IssueInvoiceData): Promise<UpdateInvoiceResult> {
    const rows = await prisma.$queryRawUnsafe<InvoiceRow[]>(
      `UPDATE "invoices"
       SET "status" = 'ISSUED', "invoiceNumber" = $2, "issueDate" = $3, "documentHash" = $4, "updatedAt" = now()
       WHERE "id" = $1::uuid AND "status" = ANY($5::"InvoiceStatus"[])
       RETURNING ${INVOICE_COLUMNS}`,
      data.id,
      data.invoiceNumber,
      data.issueDate,
      data.documentHash,
      [...data.fromStatuses],
    );
    return this.resultFor(data.id, rows[0]);
  }

  async markPaid(id: string, paidAt: Date, fromStatuses: readonly InvoiceStatusValue[]): Promise<UpdateInvoiceResult> {
    const rows = await prisma.$queryRawUnsafe<InvoiceRow[]>(
      `UPDATE "invoices" SET "status" = 'PAID', "updatedAt" = now()
       WHERE "id" = $1::uuid AND "status" = ANY($2::"InvoiceStatus"[])
       RETURNING ${INVOICE_COLUMNS}`,
      id,
      [...fromStatuses],
    );
    void paidAt; // No dedicated "paidAt" column today — PAID's own updatedAt records when the transition happened; see InvoiceRecord's own doc comment (no persisted field currently reads this separately).
    return this.resultFor(id, rows[0]);
  }

  async cancel(data: CancelInvoiceData): Promise<UpdateInvoiceResult> {
    const rows = await prisma.$queryRawUnsafe<InvoiceRow[]>(
      `UPDATE "invoices"
       SET "status" = 'CANCELLED', "cancelledAt" = $2, "cancelledByUserId" = $3::uuid, "cancellationReason" = $4, "updatedAt" = now()
       WHERE "id" = $1::uuid AND "status" = ANY($5::"InvoiceStatus"[])
       RETURNING ${INVOICE_COLUMNS}`,
      data.id,
      data.cancelledAt,
      data.cancelledByUserId,
      data.reason,
      [...data.fromStatuses],
    );
    return this.resultFor(data.id, rows[0]);
  }

  private async resultFor(id: string, updatedRow: InvoiceRow | undefined): Promise<UpdateInvoiceResult> {
    if (updatedRow) {
      return { applied: true, record: toRecord(updatedRow, await fetchLineItems(updatedRow.id)) };
    }
    const current = await this.findById(id);
    if (!current) {
      throw new Error(`Invoice ${id} disappeared during an update — this should never happen.`);
    }
    return { applied: false, record: current };
  }
}
