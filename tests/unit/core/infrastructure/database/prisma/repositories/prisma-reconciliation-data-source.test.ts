import { describe, expect, it, vi } from "vitest";

/**
 * Regression test for the Module 85 follow-up fix in
 * `prisma-reconciliation-data-source.ts`'s `toInvoiceRecord`:
 *
 * 1. The Prisma-generated `Invoice.selfBillingAuthorizationId` column
 *    became nullable (Module 85's `CUSTOMER_RECEIPT` invoice type has no
 *    self-billing authorization at all), but this file's own inline row
 *    type had not been updated to match, causing a `tsc` failure.
 * 2. While auditing that fix, a related latent bug was found in the same
 *    function: `selfBilled` was hardcoded to `true` for every invoice
 *    row, which silently mis-tags a `CUSTOMER_RECEIPT` row (which now can
 *    coexist with a `PROFESSIONAL_SELF_BILLED` row on the same job) as
 *    self-billed. It must instead be derived from `type`, exactly as
 *    `prisma-invoice-repository.ts`'s own `toRecord` already does.
 *
 * This test drives `PrismaReconciliationDataSource.getJobFinancialContext`
 * with a mocked Prisma client returning one row of each invoice type for
 * the same job, and asserts both fields are mapped correctly for each.
 */

vi.mock("@/infrastructure/database/prisma/client", () => ({
  prisma: {
    job: { findUnique: vi.fn() },
    invoice: { findMany: vi.fn() },
    payout: { findUnique: vi.fn() },
    payment: { findMany: vi.fn() },
    commission: { findUnique: vi.fn() },
    jobCompletionConfirmation: { findUnique: vi.fn() },
    refund: { findMany: vi.fn() },
    creditNote: { findMany: vi.fn() },
  },
}));

const now = new Date("2026-06-01T00:00:00.000Z");
const JOB_ID = "11111111-1111-1111-1111-111111111111";
const QUOTE_ID = "22222222-2222-2222-2222-222222222222";
const CUSTOMER_ID = "33333333-3333-3333-3333-333333333333";
const AUTHORIZATION_ID = "44444444-4444-4444-4444-444444444444";

function baseInvoiceRow(overrides: Record<string, unknown>) {
  return {
    id: "invoice-id",
    invoiceNumber: null,
    status: "DRAFT",
    jobId: JOB_ID,
    quoteId: QUOTE_ID,
    paymentId: null,
    professionalProfileId: null,
    companyProfileId: null,
    customerId: CUSTOMER_ID,
    issuerLegalName: "MaestroYa S.L.",
    issuerTaxId: "B00000000",
    recipientLegalName: "Recipient",
    recipientTaxId: null,
    issueDate: null,
    invoiceDate: now,
    acceptedAt: null,
    acceptedByUserId: null,
    acceptanceAgreementVersion: null,
    currency: "EUR",
    taxableBase: 100,
    vatRateBps: 2100,
    vatAmount: 21,
    commissionBase: 100,
    commissionRateBps: 1000,
    commissionAmount: 10,
    irpfWithholdingRateBps: 0,
    irpfWithholdingAmount: 0,
    totalAmount: 121,
    documentHash: null,
    version: 1,
    cancelledAt: null,
    cancelledByUserId: null,
    cancellationReason: null,
    lineItems: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("infrastructure/database/prisma/repositories/prisma-reconciliation-data-source", () => {
  it("maps PROFESSIONAL_SELF_BILLED and CUSTOMER_RECEIPT invoice rows with correct selfBilled/selfBillingAuthorizationId, including nulls", async () => {
    const { prisma } = await import("@/infrastructure/database/prisma/client");
    const mocked = prisma as unknown as {
      job: { findUnique: ReturnType<typeof vi.fn> };
      invoice: { findMany: ReturnType<typeof vi.fn> };
      payout: { findUnique: ReturnType<typeof vi.fn> };
      payment: { findMany: ReturnType<typeof vi.fn> };
      jobCompletionConfirmation: { findUnique: ReturnType<typeof vi.fn> };
      creditNote: { findMany: ReturnType<typeof vi.fn> };
    };

    mocked.job.findUnique.mockResolvedValue({
      id: JOB_ID,
      status: "COMPLETED",
      quoteId: QUOTE_ID,
      customerId: CUSTOMER_ID,
      professionalProfileId: null,
      companyProfileId: null,
      quote: { totalAmount: 121, currency: "EUR" },
    });
    mocked.invoice.findMany.mockResolvedValue([
      baseInvoiceRow({
        id: "invoice-professional",
        type: "PROFESSIONAL_SELF_BILLED",
        selfBillingAuthorizationId: AUTHORIZATION_ID,
      }),
      baseInvoiceRow({
        id: "invoice-customer-receipt",
        type: "CUSTOMER_RECEIPT",
        selfBillingAuthorizationId: null,
      }),
    ]);
    mocked.payout.findUnique.mockResolvedValue(null);
    mocked.payment.findMany.mockResolvedValue([]);
    mocked.jobCompletionConfirmation.findUnique.mockResolvedValue(null);
    mocked.creditNote.findMany.mockResolvedValue([]);

    const { PrismaReconciliationDataSource } = await import(
      "@/infrastructure/database/prisma/repositories/prisma-reconciliation-data-source"
    );
    const dataSource = new PrismaReconciliationDataSource();

    const context = await dataSource.getJobFinancialContext(JOB_ID);

    expect(context).not.toBeNull();
    const invoices = context!.invoices;
    expect(invoices).toHaveLength(2);

    const professional = invoices.find((inv) => inv.id === "invoice-professional")!;
    expect(professional.type).toBe("PROFESSIONAL_SELF_BILLED");
    expect(professional.selfBilled).toBe(true);
    expect(professional.selfBillingAuthorizationId).toBe(AUTHORIZATION_ID);

    const customerReceipt = invoices.find((inv) => inv.id === "invoice-customer-receipt")!;
    expect(customerReceipt.type).toBe("CUSTOMER_RECEIPT");
    expect(customerReceipt.selfBilled).toBe(false);
    expect(customerReceipt.selfBillingAuthorizationId).toBeNull();
  });
});
