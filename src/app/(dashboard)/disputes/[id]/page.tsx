import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/dashboard/page-header";
import { getDisputeAction } from "../actions";
import { DisputeMessageForm } from "./dispute-message-form";

export async function generateMetadata() {
  const t = await getTranslations("customer.disputes");
  return { title: t("detail.metaTitle") };
}

/**
 * Module 21 — Disputes & Support: minimal dispute detail page for a
 * customer/professional/company participant — shows the case, its public
 * thread (never internal notes — see GetDisputeByIdUseCase's own doc
 * comment), and its evidence, plus a form to post a new message.
 */
export default async function DisputeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getDisputeAction(id);
  if (!result.success) {
    notFound();
  }
  const { dispute, messages, evidence } = result.data;
  const [t, tStatus, format] = await Promise.all([
    getTranslations("customer.disputes"),
    getTranslations("enums.status"),
    getFormatter(),
  ]);
  const label = (group: "status" | "priority" | "reason" | "resolution", value: string): string => {
    if (group === "status" && tStatus.has(value as never)) return tStatus(value as never);
    return t.has(`${group}.${value}` as never) ? t(`${group}.${value}` as never) : value;
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={dispute.title}
        subtitle={t("detail.subtitle", {
          caseNumber: dispute.caseNumber,
          status: label("status", dispute.status),
          priority: label("priority", dispute.priority),
          reason: label("reason", dispute.reason),
        })}
        breadcrumbs={[{ label: t("list.metaTitle"), href: "/disputes" }, { label: dispute.title }]}
      />

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase text-foreground/60">{t("detail.description")}</h2>
        <p className="whitespace-pre-wrap text-sm">{dispute.description}</p>
      </section>

      {dispute.resolution && (
        <section className="rounded-md border border-border bg-black/5 p-4">
          <h2 className="mb-1 text-sm font-semibold uppercase text-foreground/60">{t("detail.resolution")}</h2>
          <p className="text-sm font-medium">{label("resolution", dispute.resolution)}</p>
          {dispute.resolutionNote && <p className="mt-1 text-sm">{dispute.resolutionNote}</p>}
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase text-foreground/60">{t("detail.evidence")}</h2>
        {evidence.length === 0 ? (
          <p className="text-sm text-foreground/70">{t("detail.noEvidence")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {evidence.map((e) => (
              <li key={e.id} className="rounded-md border border-border p-3 text-sm">
                <a href={e.fileUrl} target="_blank" rel="noreferrer" className="underline">
                  {e.fileName ?? e.fileUrl}
                </a>
                {e.description && <p className="mt-1 text-foreground/70">{e.description}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase text-foreground/60">{t("detail.messages")}</h2>
        <ul className="flex flex-col gap-2">
          {messages.map((m) => (
            <li key={m.id} className="rounded-md border border-border p-3 text-sm">
              <p className="whitespace-pre-wrap">{m.body}</p>
              <p className="mt-1 text-xs text-foreground/50">{format.dateTime(new Date(m.createdAt), { dateStyle: "medium", timeStyle: "short" })}</p>
            </li>
          ))}
          {messages.length === 0 && <p className="text-sm text-foreground/70">{t("detail.noMessages")}</p>}
        </ul>
        <div className="mt-4">
          <DisputeMessageForm disputeId={dispute.id} />
        </div>
      </section>
    </div>
  );
}
