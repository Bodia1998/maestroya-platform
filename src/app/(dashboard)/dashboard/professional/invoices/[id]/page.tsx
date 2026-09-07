import { notFound } from "next/navigation";

import { makeGetProfessionalInvoiceUseCase } from "@/application/use-cases/invoicing/compose";
import { NotFoundError } from "@/domain/errors/domain-error";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { PageHeader } from "@/components/dashboard/page-header";
import { PageContainer } from "@/components/layout/page-container";
import { Section } from "@/components/layout/section";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { formatMoney } from "@/components/dashboard/quote-items-table";
import { Button } from "@/components/ui/button";
import { acceptProfessionalInvoiceFormAction } from "../actions";

export const metadata = { title: "Invoice" };

function formatDate(date: Date | null): string {
  return date ? date.toLocaleDateString() : "—";
}

/**
 * Module 99 — Self-Billing Authorization Entry Point & Financial Document
 * Access.
 *
 * Single self-billed-invoice HTML view for the professional/company side.
 * Same HTML-only, tamper-evidence-checksum-only convention as
 * receipts/[id]/page.tsx — no PDF generation, no signature/seal claim.
 *
 * `GetProfessionalInvoiceUseCase` resolves ownership (solo professional or
 * company member with viewing rights) from the session; an invoice that
 * exists but isn't this caller's own 404s identically to a nonexistent id.
 *
 * When the invoice is PENDING_ACCEPTANCE, this is also the entry point for
 * `AcceptInvoiceUseCase` (Workstream A/C) — the professional's explicit act
 * of accepting a self-billed invoice MaestroYa drafted on their behalf.
 */
export default async function ProfessionalInvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireAuth();

  let invoice, creditNotes;
  try {
    const result = await makeGetProfessionalInvoiceUseCase().execute(user.id, id);
    invoice = result.invoice;
    creditNotes = result.creditNotes;
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const canAccept = invoice.status === "PENDING_ACCEPTANCE";

  return (
    <PageContainer gap="sm">
      <PageHeader
        title="Invoice"
        breadcrumbs={[{ label: "My invoices", href: "/dashboard/professional/invoices" }, { label: invoice.invoiceNumber ?? "Invoice" }]}
        actions={<StatusBadge status={invoice.status} />}
      />

      {canAccept && (
        <Section bordered gap="sm">
          <p className="text-sm text-foreground/80">
            MaestroYa has drafted this self-billed invoice on your behalf. Review the details below and accept it
            to confirm they are correct.
          </p>
          <form action={acceptProfessionalInvoiceFormAction.bind(null, invoice.id)}>
            <Button type="submit">Accept this invoice</Button>
          </form>
        </Section>
      )}

      <Section bordered gap="sm">
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-foreground/60">Invoice number</dt>
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
            <dt className="text-foreground/60">Issued to</dt>
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
