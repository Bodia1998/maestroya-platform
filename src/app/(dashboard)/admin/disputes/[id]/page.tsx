import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";

import { getAdminDisputeAction } from "../actions";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Section } from "@/components/layout/section";
import { ResponsiveGrid } from "@/components/layout/responsive-grid";
import { AdminDisputeActions } from "./admin-dispute-actions";

export async function generateMetadata() {
  const t = await getTranslations("admin");
  return { title: t("common.metaTitle", { page: t("disputesPage.detail.metaTitle") }) };
}

/** Module 21 — Disputes & Support: admin dispute detail — shows the full
 *  thread INCLUDING internal notes (see GetAdminDisputeUseCase's own doc
 *  comment) plus the admin workflow actions (assign, status change,
 *  internal note, resolve, reject, close). */
export default async function AdminDisputeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getAdminDisputeAction(id);
  if (!result.success) {
    notFound();
  }
  const { dispute, messages, evidence } = result.data;
  const t = await getTranslations("admin");
  const format = await getFormatter();
  const enumLabel = (group: string, value: string) =>
    t.has(`${group}.${value}` as never) ? t(`${group}.${value}` as never) : value;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={dispute.title}
        subtitle={dispute.caseNumber}
        breadcrumbs={[{ label: t("disputesPage.title"), href: "/admin/disputes" }, { label: dispute.caseNumber }]}
        actions={<StatusBadge status={dispute.status} />}
      />

      <ResponsiveGrid cols="2" gap="md" bordered aria-label={t("disputesPage.detail.details")} className="sm:grid-cols-3">
        <div>
          <p className="text-foreground/60">{t("disputesPage.detail.priority")}</p>
          <p className="font-medium">{enumLabel("priority", dispute.priority)}</p>
        </div>
        <div>
          <p className="text-foreground/60">{t("disputesPage.detail.reason")}</p>
          <p className="font-medium">{enumLabel("disputesPage.reason", dispute.reason)}</p>
        </div>
        <div>
          <p className="text-foreground/60">{t("disputesPage.detail.assignedTo")}</p>
          <p className="font-medium">{dispute.assignedAdminUserId ?? t("disputesPage.detail.unassigned")}</p>
        </div>
      </ResponsiveGrid>

      <p className="whitespace-pre-wrap text-sm">{dispute.description}</p>

      {dispute.resolution && (
        <Section title={t("disputesPage.detail.resolution")} bordered className="bg-black/5">
          <p className="text-sm font-medium">{enumLabel("disputesPage.resolution", dispute.resolution)}</p>
          {dispute.resolutionNote && <p className="mt-1 text-sm">{dispute.resolutionNote}</p>}
        </Section>
      )}

      <Section title={t("disputesPage.detail.evidence", { count: evidence.length })}>
        <ul className="flex flex-col gap-2">
          {evidence.map((e) => (
            <li key={e.id} className="rounded-md border border-border p-3 text-sm">
              <a
                href={e.fileUrl}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
              >
                {e.fileName ?? e.fileUrl}
                <span className="sr-only">{t("disputesPage.detail.opensInNewTab")}</span>
              </a>
            </li>
          ))}
          {evidence.length === 0 && <p className="text-sm text-foreground/70">{t("disputesPage.detail.noEvidence")}</p>}
        </ul>
      </Section>

      <Section title={t("disputesPage.detail.thread")}>
        <ul className="flex flex-col gap-2">
          {messages.map((m) => (
            <li
              key={m.id}
              className={`rounded-md border p-3 text-sm ${m.isInternalNote ? "border-amber-400 bg-amber-50" : "border-border"}`}
            >
              {m.isInternalNote && <p className="mb-1 text-xs font-semibold uppercase text-amber-700">{t("disputesPage.detail.internalNote")}</p>}
              <p className="whitespace-pre-wrap">{m.body}</p>
              <p className="mt-1 text-xs text-foreground/50">{format.dateTime(new Date(m.createdAt), { dateStyle: "medium", timeStyle: "short" })}</p>
            </li>
          ))}
          {messages.length === 0 && <p className="text-sm text-foreground/70">{t("disputesPage.detail.noMessages")}</p>}
        </ul>
      </Section>

      <AdminDisputeActions disputeId={dispute.id} status={dispute.status} />
    </div>
  );
}
