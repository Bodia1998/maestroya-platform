import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { makeGetProfessionalInvoiceUseCase } from "@/application/use-cases/invoicing/compose";
import { NotFoundError } from "@/domain/errors/domain-error";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { PageHeader } from "@/components/dashboard/page-header";
import { PageContainer } from "@/components/layout/page-container";
import { Section } from "@/components/layout/section";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Button } from "@/components/ui/button";
import { acceptProfessionalInvoiceFormAction } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("professional.invoices.detail");
  return { title: t("metaTitle") };
}

/**
 * Module 120 — Multilingual Localization, conventions §8: the invoice
 * *document* (parties, lines, tax figures, credit notes) is rendered in the
 * language it is issued in — Spanish — whatever the UI language, inside a
 * `lang="es"` block with `ui.legalDocument.issuedLanguageNotice` above it.
 * These are the document's own field labels, not UI chrome, so they are
 * deliberately not in the message catalog. Only the surrounding page
 * (title, breadcrumbs, accept panel, help text) is localised.
 */
const DOCUMENT_LABELS_ES = {
  invoiceNumber: "Número de factura", // i18n-ignore — issued-document wording (Spanish), conventions §8
  notYetIssued: "Pendiente de emisión", // i18n-ignore — issued-document wording (Spanish), conventions §8
  date: "Fecha", // i18n-ignore — issued-document wording (Spanish), conventions §8
  issuedBy: "Emisor", // i18n-ignore — issued-document wording (Spanish), conventions §8
  issuedTo: "Destinatario", // i18n-ignore — issued-document wording (Spanish), conventions §8
  items: "Conceptos", // i18n-ignore — issued-document wording (Spanish), conventions §8
  description: "Descripción", // i18n-ignore — issued-document wording (Spanish), conventions §8
  amount: "Importe", // i18n-ignore — issued-document wording (Spanish), conventions §8
  tax: "Impuestos", // i18n-ignore — issued-document wording (Spanish), conventions §8
  taxableBase: "Base imponible", // i18n-ignore — issued-document wording (Spanish), conventions §8
  vat: "IVA", // i18n-ignore — tax line name as issued (Spanish), conventions §8
  total: "Total", // i18n-ignore — issued-document wording (Spanish), conventions §8
  creditNotes: "Facturas rectificativas", // i18n-ignore — issued-document wording (Spanish), conventions §8
} as const;

const DOCUMENT_LOCALE = "es";

function formatDocumentDate(date: Date | null): string {
  return date ? new Intl.DateTimeFormat(DOCUMENT_LOCALE, { dateStyle: "medium" }).format(date) : "—";
}

function formatDocumentMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat(DOCUMENT_LOCALE, { style: "currency", currency }).format(amount);
}

function formatDocumentPercent(rateBps: number): string {
  return new Intl.NumberFormat(DOCUMENT_LOCALE, {
    style: "percent",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(rateBps / 10000);
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
  const [t, tList, tUi] = await Promise.all([
    getTranslations("professional.invoices.detail"),
    getTranslations("professional.invoices.list"),
    getTranslations("ui.legalDocument"),
  ]);
  const L = DOCUMENT_LABELS_ES;

  return (
    <PageContainer gap="sm">
      <PageHeader
        title={t("title")}
        breadcrumbs={[
          { label: tList("title"), href: "/dashboard/professional/invoices" },
          { label: invoice.invoiceNumber ?? t("title") },
        ]}
        actions={<StatusBadge status={invoice.status} />}
      />

      {canAccept && (
        <Section bordered gap="sm">
          <p className="text-sm text-foreground/80">
            {t("acceptIntro")}
          </p>
          <form action={acceptProfessionalInvoiceFormAction.bind(null, invoice.id)}>
            <Button type="submit">{t("accept")}</Button>
          </form>
        </Section>
      )}

      <p className="text-xs text-foreground/60">{tUi("issuedLanguageNotice")}</p>

      <div lang={DOCUMENT_LOCALE} className="flex flex-col gap-4">
      <Section bordered gap="sm">
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-foreground/60">{L.invoiceNumber}</dt>
            <dd className="font-medium">{invoice.invoiceNumber ?? L.notYetIssued}</dd>
          </div>
          <div>
            <dt className="text-foreground/60">{L.date}</dt>
            <dd>{formatDocumentDate(invoice.issueDate ?? invoice.invoiceDate)}</dd>
          </div>
          <div>
            <dt className="text-foreground/60">{L.issuedBy}</dt>
            <dd>{invoice.issuerLegalName}</dd>
          </div>
          <div>
            <dt className="text-foreground/60">{L.issuedTo}</dt>
            <dd>{invoice.recipientLegalName}</dd>
          </div>
        </dl>
      </Section>

      <Section title={L.items} bordered gap="sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-foreground/60">
              <th className="py-2 font-normal">{L.description}</th>
              <th className="py-2 text-right font-normal">{L.amount}</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lineItems.map((item) => (
              <tr key={item.id} className="border-b border-border/50">
                <td className="py-2">{item.description}</td>
                <td className="py-2 text-right">{formatDocumentMoney(item.amount, invoice.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title={L.tax} bordered gap="sm">
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-foreground/60">{L.taxableBase}</dt>
            <dd>{formatDocumentMoney(invoice.taxableBase, invoice.currency)}</dd>
          </div>
          <div>
            <dt className="text-foreground/60">
              {L.vat} ({formatDocumentPercent(invoice.vatRateBps)})
            </dt>
            <dd>{formatDocumentMoney(invoice.vatAmount, invoice.currency)}</dd>
          </div>
          <div>
            <dt className="text-foreground/60">{L.total}</dt>
            <dd className="text-base font-semibold">{formatDocumentMoney(invoice.totalAmount, invoice.currency)}</dd>
          </div>
        </dl>
      </Section>

      {creditNotes.length > 0 && (
        <Section title={L.creditNotes} bordered gap="sm">
          <ul className="flex flex-col gap-2">
            {creditNotes.map((cn) => (
              <li key={cn.id} className="flex items-center justify-between gap-4 text-sm">
                <span>
                  {cn.creditNoteNumber ?? L.notYetIssued} — {cn.reason}
                </span>
                <span className="font-medium">{formatDocumentMoney(-cn.totalAmount, invoice.currency)}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      </div>

      {invoice.documentHash && (
        <p className="text-xs text-foreground/40">
          {t("documentReference", { reference: invoice.documentHash.slice(0, 16) })}
        </p>
      )}
    </PageContainer>
  );
}
