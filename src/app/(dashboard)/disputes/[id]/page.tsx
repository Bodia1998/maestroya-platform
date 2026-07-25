import { notFound } from "next/navigation";

import { getDisputeAction } from "../actions";
import { DisputeMessageForm } from "./dispute-message-form";

export const metadata = { title: "Dispute" };

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

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-10">
      <div>
        <p className="font-mono text-xs text-foreground/60">{dispute.caseNumber}</p>
        <h1 className="text-2xl font-semibold">{dispute.title}</h1>
        <div className="mt-2 flex gap-3 text-xs text-foreground/70">
          <span>Status: {dispute.status}</span>
          <span>Priority: {dispute.priority}</span>
          <span>Reason: {dispute.reason}</span>
        </div>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase text-foreground/60">Description</h2>
        <p className="whitespace-pre-wrap text-sm">{dispute.description}</p>
      </section>

      {dispute.resolution && (
        <section className="rounded-md border border-border bg-black/5 p-4">
          <h2 className="mb-1 text-sm font-semibold uppercase text-foreground/60">Resolution</h2>
          <p className="text-sm font-medium">{dispute.resolution}</p>
          {dispute.resolutionNote && <p className="mt-1 text-sm">{dispute.resolutionNote}</p>}
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase text-foreground/60">Evidence</h2>
        {evidence.length === 0 ? (
          <p className="text-sm text-foreground/70">No evidence attached.</p>
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
        <h2 className="mb-2 text-sm font-semibold uppercase text-foreground/60">Messages</h2>
        <ul className="flex flex-col gap-2">
          {messages.map((m) => (
            <li key={m.id} className="rounded-md border border-border p-3 text-sm">
              <p className="whitespace-pre-wrap">{m.body}</p>
              <p className="mt-1 text-xs text-foreground/50">{new Date(m.createdAt).toLocaleString()}</p>
            </li>
          ))}
          {messages.length === 0 && <p className="text-sm text-foreground/70">No messages yet.</p>}
        </ul>
        <div className="mt-4">
          <DisputeMessageForm disputeId={dispute.id} />
        </div>
      </section>
    </div>
  );
}
