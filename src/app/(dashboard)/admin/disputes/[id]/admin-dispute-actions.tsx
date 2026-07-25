"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  addDisputeInternalNoteAction,
  changeDisputeStatusAction,
  closeDisputeAction,
  rejectDisputeAction,
  resolveDisputeAction,
} from "../actions";

const RESOLUTIONS = [
  "NO_ACTION",
  "CUSTOMER_FAVOR",
  "PROFESSIONAL_FAVOR",
  "PARTIAL_RESOLUTION",
  "FINANCIAL_ADJUSTMENT_REQUIRED",
  "ESCALATED_EXTERNALLY",
];

const NEXT_STATUSES: Record<string, string[]> = {
  OPEN: ["UNDER_REVIEW"],
  UNDER_REVIEW: ["WAITING_FOR_CUSTOMER", "WAITING_FOR_PROFESSIONAL"],
  WAITING_FOR_CUSTOMER: ["UNDER_REVIEW"],
  WAITING_FOR_PROFESSIONAL: ["UNDER_REVIEW"],
};

/** Module 21 — Disputes & Support: admin workflow actions for a dispute —
 *  status transitions, internal notes, resolve/reject/close. Every action
 *  here is re-validated server-side by its own use case (see
 *  admin/disputes/actions.ts) — this component only decides what's worth
 *  showing given the current status. */
export function AdminDisputeActions({ disputeId, status }: { disputeId: string; status: string }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [resolution, setResolution] = useState<string>(RESOLUTIONS[0] ?? "NO_ACTION");
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
  const canResolveOrReject = status !== "CLOSED" && status !== "RESOLVED" && status !== "REJECTED";
  const canClose = status === "RESOLVED" || status === "REJECTED";

  return (
    <div className="flex flex-col gap-4 rounded-md border border-border p-4">
      <h2 className="text-sm font-semibold">Admin actions</h2>

      {nextStatuses.length > 0 && (
        <div className="flex gap-2">
          {nextStatuses.map((s) => (
            <Button key={s} type="button" variant="ghost" disabled={isSubmitting} onClick={() => run(() => changeDisputeStatusAction(disputeId, s))}>
              Move to {s}
            </Button>
          ))}
        </div>
      )}

      <label className="flex flex-col gap-1 text-sm">
        Internal note (never visible to customer/professional)
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="rounded-md border border-border px-3 py-2 text-sm" />
      </label>
      <Button
        type="button"
        variant="ghost"
        disabled={isSubmitting || note.trim().length === 0}
        onClick={() => run(() => addDisputeInternalNoteAction(disputeId, note)).then(() => setNote(""))}
      >
        Add internal note
      </Button>

      {canResolveOrReject && (
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <label className="flex flex-col gap-1 text-sm">
            Resolution
            <select value={resolution} onChange={(e) => setResolution(e.target.value)} className="rounded-md border border-border px-3 py-2 text-sm">
              {RESOLUTIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <div className="flex gap-2">
            <Button type="button" disabled={isSubmitting || note.trim().length === 0} onClick={() => run(() => resolveDisputeAction(disputeId, resolution, note))}>
              Resolve
            </Button>
            <Button type="button" variant="ghost" disabled={isSubmitting || note.trim().length === 0} onClick={() => run(() => rejectDisputeAction(disputeId, note))}>
              Reject
            </Button>
          </div>
        </div>
      )}

      {canClose && (
        <Button type="button" disabled={isSubmitting} onClick={() => run(() => closeDisputeAction(disputeId))}>
          Close case
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
