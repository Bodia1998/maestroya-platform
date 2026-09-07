import { notFound } from "next/navigation";

import { makeGetCustomerReceiptUseCase } from "@/application/use-cases/invoicing/compose";
import { NotFoundError } from "@/domain/errors/domain-error";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { PageHeader } from "@/components/dashboard/page-header";
import { PageContainer } from "@/components/layout/page-container";
import { Section } from "@/components/layout/section";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { formatMoney } from "@/components/dashboard/quote-items-table";

export const metadata = { title: "Receipt" };

function formatDate(date: Date | null): string {
  return date ? date.toLocaleDateString() : "—";
}

/**
 * Module 99 — Self-Billing Authorization Entry Point & Financial Document
 * Access.
 *
 * Single-receipt HTML view — deliberately HTML only, per the decision
 * document's §8: every figure here is already computed and immutable
 * once ISSUED (see `invoice-lifecycle.ts`'s own `isImmutableInvoiceStatus`),
 * so this page is a pure read-only presentation layer with no PDF
 * generation, no signature, and no seal claim. `documentHash` is shown as
 * tamper-evidence only — see `invoice-document.ts`'s own doc comment —
 * never described here as a legal signature.
 *
 * `GetCustomerReceiptUseCase` resolves ownership from the session; an
 * invoice that exists but isn't this customer's own receipt 404s
 * identically to a nonexistent id (see that use case's own doc comment).
 */
export default async function ReceiptDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireAuth();

  let invoice, creditNotes;
  try {
    const result = await makeGetCustomerReceiptUseCase().execute(user.id, id);
    invoice = result.invoice;
    creditNotes = result.creditNotes;
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  return (
    <PageContainer gap="sm">
      <PageHeader
        title="Receipt"
        breadcrumbs={[{ label: "My receipts", href: "/receipts" }, { label: invoice.invoiceNumber ?? "Receipt" }]}
        actions={<StatusBadge status={invoice.status} />}
      />

      <Section bordered gap="sm">
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-foreground/60">Receipt number</dt>
            <dd className="font-medium">{invoice.invoiceNumber ?? "Not yet issued"}</dd>
          </div>
          <div>
            <dt className="text-foreground/60">Date</dt>
            <dd>{formatDate(invoice.issueDate ?? invoice.invoiceDate)}</dd>
          </div>
          <div>
            <dt className="text-foreground/60">Issued by</dt>
            <dd>{invoice.issuerLegalName}</dd>
          </div>
          <div>
            <dt className="text-foreground/60">Billed to</dt>
            <dd>{invoice.recipientLegalName}</dd>
          </div>
        </dl>
      </Section>

      <Section title="Items" bordered gap="sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-foreground/60">
              <th className="py-2 font-normal">Description</th>
              <th className="py-2 text-right font-normal">Amount</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lineItems.map((item) => (
              <tr key={item.id} className="border-b border-border/50">
                <td className="py-2">{item.description}</td>
                <td className="py-2 text-right">{formatMoney(item.amount, invoice.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Tax" bordered gap="sm">
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-foreground/60">Taxable base</dt>
            <dd>{formatMoney(invoice.taxableBase, invoice.currency)}</dd>
          </div>
          <div>
            <dt className="text-foreground/60">VAT ({(invoice.vatRateBps / 100).toFixed(2)}%)</dt>
            <dd>{formatMoney(invoice.vatAmount, invoice.currency)}</dd>
          </div>
          <div>
            <dt className="text-foreground/60">Total</dt>
            <dd className="text-base font-semibold">{formatMoney(invoice.totalAmount, invoice.currency)}</dd>
          </div>
        </dl>
      </Section>

      {creditNotes.length > 0 && (
        <Section title="Credit notes" bordered gap="sm">
          <ul className="flex flex-col gap-2">
            {creditNotes.map((cn) => (
              <li key={cn.id} className="flex items-center justify-between gap-4 text-sm">
                <span>{cn.creditNoteNumber ?? "Not yet issued"} — {cn.reason}</span>
                <span className="font-medium">-{formatMoney(cn.totalAmount, invoice.currency)}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {invoice.documentHash && (
        <p className="text-xs text-foreground/40">
          Document reference: {invoice.documentHash.slice(0, 16)}… (tamper-evidence checksum only — not an electronic signature).
        </p>
      )}
    </PageContainer>
  );
}
