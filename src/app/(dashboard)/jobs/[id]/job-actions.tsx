"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cancelJobAction, completeJobAction, startJobAction } from "../actions";

const CANCELLATION_REASONS = [
  { value: "CUSTOMER_REQUEST", label: "Customer request" },
  { value: "PROFESSIONAL_UNABLE_TO_COMPLETE", label: "Professional unable to complete" },
  { value: "SERVICE_REQUEST_ISSUE", label: "Issue with the service request" },
  { value: "OTHER", label: "Other" },
];

function ActionButton({
  label,
  submittingLabel,
  onSubmit,
  jobId,
}: {
  label: string;
  submittingLabel: string;
  onSubmit: (jobId: string) => Promise<{ success: boolean; error?: string }>;
  jobId: string;
}) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setIsSubmitting(true);
    setError(null);
    const result = await onSubmit(jobId);
    setIsSubmitting(false);
    if (!result.success) {
      setError(result.error ?? "Something went wrong.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2">
      <Button type="button" disabled={isSubmitting} onClick={handleClick}>
        {isSubmitting ? submittingLabel : label}
      </Button>
      {error && (
        <p role="alert" className="rounded-md bg-red-100 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

function CancelJobDialog({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [reason, setReason] = useState<string>(CANCELLATION_REASONS[0]?.value ?? "OTHER");
  const [note, setNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCancel() {
    setIsSubmitting(true);
    setError(null);
    const result = await cancelJobAction(jobId, reason, note);
    setIsSubmitting(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    setIsOpen(false);
    router.refresh();
  }

  if (!isOpen) {
    return (
      <Button type="button" variant="ghost" onClick={() => setIsOpen(true)}>
        Cancel job
      </Button>
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="cancel-job-title"
      className="flex flex-col gap-3 rounded-md border border-border bg-black/5 p-4"
    >
      <h3 id="cancel-job-title" className="text-sm font-semibold">
        Cancel this job?
      </h3>
      <label className="flex flex-col gap-1 text-sm">
        Reason
        <select
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="rounded-md border border-border px-3 py-2 text-sm"
        >
          {CANCELLATION_REASONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Note (optional)
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          className="rounded-md border border-border px-3 py-2 text-sm"
        />
      </label>
      {error && (
        <p role="alert" className="rounded-md bg-red-100 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="button" disabled={isSubmitting} onClick={handleCancel}>
          {isSubmitting ? "Cancelling…" : "Yes, cancel"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setIsOpen(false)}>
          Not now
        </Button>
      </div>
    </div>
  );
}

/**
 * Order / Job Lifecycle module (Module 11). Renders exactly the actions
 * valid for the Job's current status and the caller's own side (see
 * domain/services/job-state.ts and the module's "Authorization" doc) — a
 * UX convenience only; every action is re-validated server-side by its own
 * use case regardless of what this component decides to show.
 *
 * "Start work" / "Mark job completed" are professional-only — never shown
 * on the customer side. "Cancel job" is available to either side while the
 * Job is non-terminal.
 *
 * Job completion never silently auto-completes outstanding Appointments
 * (see JobRepository.complete's doc comment): if any Appointment on this
 * Job is still non-terminal, "Mark job completed" is blocked and
 * `completeJobAction` returns the repository's own explanatory error
 * ("This job still has an unresolved appointment…"), which `ActionButton`
 * renders in place rather than failing silently — so a warning banner is
 * always shown up front rather than only discovered after a failed click.
 */
export function JobActions({
  jobId,
  status,
  viewerRole,
  hasOpenAppointments,
}: {
  jobId: string;
  status: string;
  viewerRole: "customer" | "professional";
  hasOpenAppointments: boolean;
}) {
  const isProfessional = viewerRole === "professional";
  const cancellable = status === "CREATED" || status === "IN_PROGRESS";

  return (
    <div className="flex flex-col gap-4">
      {isProfessional && status === "CREATED" && (
        <ActionButton label="Start work" submittingLabel="Starting…" onSubmit={startJobAction} jobId={jobId} />
      )}
      {isProfessional && status === "IN_PROGRESS" && (
        <div className="flex flex-col gap-2">
          {hasOpenAppointments && (
            <p className="rounded-md bg-black/5 px-3 py-2 text-sm text-foreground/70">
              This job still has an unresolved appointment. Confirm and complete (or cancel) every appointment on
              this job before marking it completed.
            </p>
          )}
          <ActionButton
            label="Mark job completed"
            submittingLabel="Completing…"
            onSubmit={completeJobAction}
            jobId={jobId}
          />
        </div>
      )}
      {cancellable && <CancelJobDialog jobId={jobId} />}
    </div>
  );
}
