import { prisma } from "@/infrastructure/database/prisma/client";
import type { InvoiceNumberAllocator } from "@/domain/repositories/invoice-repository";
import { formatCreditNoteNumber, formatInvoiceNumber } from "@/domain/services/invoice-document";

/**
 * Module 79 — Invoicing & Credit Notes.
 *
 * Concurrency-safe invoice/credit-note number allocation over the
 * `invoice_number_counters` table (`(series, year)` primary key — see
 * schema.prisma's own doc comment). `INSERT ... ON CONFLICT ("series",
 * "year") DO UPDATE SET "lastValue" = "invoice_number_counters"."lastValue"
 * + 1 ... RETURNING "lastValue"` is a single atomic statement: Postgres
 * takes a row-level lock for the duration of the statement, so two
 * concurrent callers requesting the same (series, year) are strictly
 * serialized by the database itself — never a read-then-write race, and
 * never two callers computing the same `lastValue + 1`. This is the exact
 * "concurrency-safe allocation strategy" the module brief requires, and
 * is verified directly by a dedicated concurrency test (N concurrent
 * calls -> N distinct, gapless-or-not-but-never-duplicate values).
 *
 * Same raw-SQL-for-a-brand-new-table reasoning as every other Module 79
 * repository in this directory (see e.g.
 * `PrismaSelfBillingAuthorizationRepository`'s own doc comment).
 */
export class PrismaDocumentNumberAllocator implements InvoiceNumberAllocator {
  async allocateNextInvoiceNumber(year: number): Promise<string> {
    const sequence = await this.allocateNextSequence("INV", year);
    return formatInvoiceNumber({ year, sequence });
  }

  async allocateNextCreditNoteNumber(year: number): Promise<string> {
    const sequence = await this.allocateNextSequence("CN", year);
    return formatCreditNoteNumber({ year, sequence });
  }

  private async allocateNextSequence(series: string, year: number): Promise<number> {
    const rows = await prisma.$queryRawUnsafe<{ lastValue: number }[]>(
      `INSERT INTO "invoice_number_counters" ("series", "year", "lastValue", "updatedAt")
       VALUES ($1, $2, 1, now())
       ON CONFLICT ("series", "year")
       DO UPDATE SET "lastValue" = "invoice_number_counters"."lastValue" + 1, "updatedAt" = now()
       RETURNING "lastValue"`,
      series,
      year,
    );
    return rows[0]!.lastValue;
  }
}
