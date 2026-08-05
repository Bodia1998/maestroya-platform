"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Section } from "@/components/layout/section";
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
    <Section title="Admin actions" bordered aria-busy={isSubmitting}>
      {nextStatuses.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {nextStatuses.map((s) => (
            <Button key={s} type="button" variant="ghost" disabled={isSubmitting} onClick={() => run(() => changeDisputeStatusAction(disputeId, s))}>
              Move to {s}
            </Button>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-1">
        <Label htmlFor="dispute-internal-note">Internal note (never visible to customer/professional)</Label>
        <Textarea id="dispute-internal-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
      </div>
      <Button
        type="button"
        variant="ghost"
        className="w-fit"
        disabled={isSubmitting || note.trim().length === 0}
        onClick={() => run(() => addDisputeInternalNoteAction(disputeId, note)).then(() => setNote(""))}
      >
        Add internal note
      </Button>

      {canResolveOrReject && (
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor="dispute-resolution">Resolution</Label>
            <Select id="dispute-resolution" value={resolution} onChange={(e) => setResolution(e.target.value)} className="w-auto">
              {RESOLUTIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={isSubmitting || note.trim().length === 0} onClick={() => run(() => resolveDisputeAction(disputeId, resolution, note))}>
              Resolve
            </Button>
            <Button type="button" variant="danger" disabled={isSubmitting || note.trim().length === 0} onClick={() => run(() => rejectDisputeAction(disputeId, note))}>
              Reject
            </Button>
          </div>
        </div>
      )}

      {canClose && (
        <Button type="button" onClick={() => run(() => closeDisputeAction(disputeId))} disabled={isSubmitting} className="w-fit">
          Close case
        </Button>
      )}

      <div role="alert" aria-live="assertive">
        {error && <p className="rounded-md bg-red-100 px-3 py-2 text-sm text-red-700">{error}</p>}
      </div>
    </Section>
  );
}
