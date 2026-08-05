import { notFound } from "next/navigation";

import { getAdminDisputeAction } from "../actions";
import { PageHeader } from "@/components/dashboard/page-header";
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
        actions={
          <div className="flex gap-3 text-xs text-foreground/70">
            <span>Status: {dispute.status}</span>
            <span>Priority: {dispute.priority}</span>
            <span>Reason: {dispute.reason}</span>
            <span>Assigned: {dispute.assignedAdminUserId ?? "unassigned"}</span>
          </div>
        }
      />

      <p className="whitespace-pre-wrap text-sm">{dispute.description}</p>

      {dispute.resolution && (
        <section className="rounded-md border border-border bg-black/5 p-4">
          <h2 className="mb-1 text-sm font-semibold uppercase text-foreground/60">Resolution</h2>
          <p className="text-sm font-medium">{dispute.resolution}</p>
          {dispute.resolutionNote && <p className="mt-1 text-sm">{dispute.resolutionNote}</p>}
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase text-foreground/60">Evidence ({evidence.length})</h2>
        <ul className="flex flex-col gap-2">
          {evidence.map((e) => (
            <li key={e.id} className="rounded-md border border-border p-3 text-sm">
              <a href={e.fileUrl} target="_blank" rel="noreferrer" className="underline">
                {e.fileName ?? e.fileUrl}
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase text-foreground/60">Thread (including internal notes)</h2>
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
      </section>

      <AdminDisputeActions disputeId={dispute.id} status={dispute.status} />
    </div>
  );
}
