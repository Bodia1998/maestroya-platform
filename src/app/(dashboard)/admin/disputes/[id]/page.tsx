import { notFound } from "next/navigation";

import { getAdminDisputeAction } from "../actions";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Section } from "@/components/layout/section";
import { ResponsiveGrid } from "@/components/layout/responsive-grid";
import { AdminDisputeActions } from "./admin-dispute-actions";

export const metadata = { title: "Admin — Dispute" };

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

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={dispute.title}
        subtitle={dispute.caseNumber}
        breadcrumbs={[{ label: "Disputes", href: "/admin/disputes" }, { label: dispute.caseNumber }]}
        actions={<StatusBadge status={dispute.status} />}
      />

      <ResponsiveGrid cols="2" gap="md" bordered aria-label="Dispute details" className="sm:grid-cols-3">
        <div>
          <p className="text-foreground/60">Priority</p>
          <p className="font-medium">{dispute.priority}</p>
        </div>
        <div>
          <p className="text-foreground/60">Reason</p>
          <p className="font-medium">{dispute.reason}</p>
        </div>
        <div>
          <p className="text-foreground/60">Assigned to</p>
          <p className="font-medium">{dispute.assignedAdminUserId ?? "Unassigned"}</p>
        </div>
      </ResponsiveGrid>

      <p className="whitespace-pre-wrap text-sm">{dispute.description}</p>

      {dispute.resolution && (
        <Section title="Resolution" bordered className="bg-black/5">
          <p className="text-sm font-medium">{dispute.resolution}</p>
          {dispute.resolutionNote && <p className="mt-1 text-sm">{dispute.resolutionNote}</p>}
        </Section>
      )}

      <Section title={`Evidence (${evidence.length})`}>
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
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </li>
          ))}
          {evidence.length === 0 && <p className="text-sm text-foreground/70">No evidence submitted.</p>}
        </ul>
      </Section>

      <Section title="Thread (including internal notes)">
        <ul className="flex flex-col gap-2">
          {messages.map((m) => (
            <li
              key={m.id}
              className={`rounded-md border p-3 text-sm ${m.isInternalNote ? "border-amber-400 bg-amber-50" : "border-border"}`}
            >
              {m.isInternalNote && <p className="mb-1 text-xs font-semibold uppercase text-amber-700">Internal note</p>}
              <p className="whitespace-pre-wrap">{m.body}</p>
              <p className="mt-1 text-xs text-foreground/50">{new Date(m.createdAt).toLocaleString()}</p>
            </li>
          ))}
          {messages.length === 0 && <p className="text-sm text-foreground/70">No messages yet.</p>}
        </ul>
      </Section>

      <AdminDisputeActions disputeId={dispute.id} status={dispute.status} />
    </div>
  );
}
