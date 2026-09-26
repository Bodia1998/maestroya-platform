import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";

import { makeGetCustomerReceiptUseCase } from "@/application/use-cases/invoicing/compose";
import { NotFoundError } from "@/domain/errors/domain-error";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { PageHeader } from "@/components/dashboard/page-header";
import { PageContainer } from "@/components/layout/page-container";
import { Section } from "@/components/layout/section";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { formatMoney } from "@/components/dashboard/quote-items-table";

export async function generateMetadata() {
  const t = await getTranslations("customer.receipts");
  return { title: t("detail.title") };
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

  // Module 120 — Multilingual Localization: only the page chrome (labels,
  // headings, help text) is localized. Values stored on the issued
  // document — numbers, legal names, line-item descriptions, credit-note
  // reasons — are shown exactly as issued (conventions §8), marked
  // `lang="es"`, and the tax is always named by its legal Spanish name
  // (IVA) inside the localized label.
  const [t, tUi, format, locale] = await Promise.all([
    getTranslations("customer.receipts"),
    getTranslations("ui"),
    getFormatter(),
    getLocale(),
  ]);
  const formatDate = (date: Date | null): string =>
    date ? format.dateTime(date, { dateStyle: "medium" }) : t("detail.dateUnset");
  const money = (amount: number) => formatMoney(amount, invoice.currency, locale);
  const vatRate = format.number(invoice.vatRateBps / 10000, { style: "percent", maximumFractionDigits: 2 });

  return (
    <PageContainer gap="sm">
      <PageHeader
        title={t("detail.title")}
        breadcrumbs={[{ label: t("list.title"), href: "/receipts" }, { label: invoice.invoiceNumber ?? t("detail.title") }]}
        actions={<StatusBadge status={invoice.status} />}
      />

      <p className="text-xs text-foreground/60">{tUi("legalDocument.issuedLanguageNotice")}</p>

      <Section bordered gap="sm">
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-foreground/60">{t("detail.receiptNumber")}</dt>
            <dd className="font-medium">{invoice.invoiceNumber ?? t("notYetIssued")}</dd>
          </div>
          <div>
            <dt className="text-foreground/60">{t("detail.date")}</dt>
            <dd>{formatDate(invoice.issueDate ?? invoice.invoiceDate)}</dd>
          </div>
          <div>
            <dt className="text-foreground/60">{t("detail.issuedBy")}</dt>
            <dd lang="es">{invoice.issuerLegalName}</dd>
          </div>
          <div>
            <dt className="text-foreground/60">{t("detail.billedTo")}</dt>
            <dd lang="es">{invoice.recipientLegalName}</dd>
          </div>
        </dl>
      </Section>

      <Section title={t("detail.items")} bordered gap="sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-foreground/60">
              <th className="py-2 font-normal">{t("detail.description")}</th>
              <th className="py-2 text-right font-normal">{t("detail.amount")}</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lineItems.map((item) => (
              <tr key={item.id} className="border-b border-border/50">
                <td className="py-2" lang="es">
                  {item.description}
                </td>
                <td className="py-2 text-right">{money(item.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title={t("detail.tax")} bordered gap="sm">
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-foreground/60">{t("detail.taxableBase")}</dt>
            <dd>{money(invoice.taxableBase)}</dd>
          </div>
          <div>
            <dt className="text-foreground/60">{t("detail.vat", { rate: vatRate })}</dt>
            <dd>{money(invoice.vatAmount)}</dd>
          </div>
          <div>
            <dt className="text-foreground/60">{t("detail.total")}</dt>
            <dd className="text-base font-semibold">{money(invoice.totalAmount)}</dd>
          </div>
        </dl>
      </Section>

      {creditNotes.length > 0 && (
        <Section title={t("detail.creditNotes")} bordered gap="sm">
          <ul className="flex flex-col gap-2">
            {creditNotes.map((cn) => (
              <li key={cn.id} className="flex items-center justify-between gap-4 text-sm">
                <span>
                  {cn.creditNoteNumber ?? t("notYetIssued")} — <span lang="es">{cn.reason}</span>
                </span>
                <span className="font-medium">{money(-cn.totalAmount)}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {invoice.documentHash && (
        <p className="text-xs text-foreground/40">
          {t("detail.documentReference", { hash: invoice.documentHash.slice(0, 16) })}
        </p>
      )}
    </PageContainer>
  );
}
