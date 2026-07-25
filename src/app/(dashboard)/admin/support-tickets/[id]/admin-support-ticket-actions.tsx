"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { changeSupportTicketStatusAction, closeSupportTicketAction, resolveSupportTicketAction } from "../actions";

const NEXT_STATUSES: Record<string, string[]> = {
  OPEN: ["IN_PROGRESS"],
  IN_PROGRESS: ["WAITING_FOR_USER"],
  WAITING_FOR_USER: ["IN_PROGRESS"],
};

export function AdminSupportTicketActions({ ticketId, status }: { ticketId: string; status: string }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function run(action: () => Promise<{ success: boolean; error?: string }>) {
    setIsSubmitting(true);
    setError(null);
    const result = await action();
    setIsSubmitting(false);
    if (!result.success) {
      setError(result.error ?? "Something went wrong.");
      return;
    }
    router.refresh();
  }

  const nextStatuses = NEXT_STATUSES[status] ?? [];
  const canResolve = status !== "CLOSED" && status !== "RESOLVED";
  const canClose = status === "RESOLVED";

  return (
    <div className="flex flex-col gap-4 rounded-md border border-border p-4">
      <h2 className="text-sm font-semibold">Admin actions</h2>
      {nextStatuses.length > 0 && (
        <div className="flex gap-2">
          {nextStatuses.map((s) => (
            <Button key={s} type="button" variant="ghost" disabled={isSubmitting} onClick={() => run(() => changeSupportTicketStatusAction(ticketId, s))}>
              Move to {s}
            </Button>
          ))}
        </div>
      )}
      {canResolve && (
        <div className="flex flex-col gap-2">
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Resolution note" className="rounded-md border border-border px-3 py-2 text-sm" />
          <Button type="button" disabled={isSubmitting || note.trim().length === 0} onClick={() => run(() => resolveSupportTicketAction(ticketId, note))}>
            Resolve
          </Button>
        </div>
      )}
      {canClose && (
        <Button type="button" disabled={isSubmitting} onClick={() => run(() => closeSupportTicketAction(ticketId))}>
          Close ticket
        </Button>
      )}
      {error && (
        <p role="alert" className="rounded-md bg-red-100 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
