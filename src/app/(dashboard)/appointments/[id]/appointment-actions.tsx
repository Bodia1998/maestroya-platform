"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  cancelAppointmentAction,
  confirmAppointmentAction,
  proposeAppointmentTimeAction,
  rescheduleAppointmentAction,
} from "../actions";

const CANCELLABLE = ["PENDING_SCHEDULE", "PROPOSED", "CONFIRMED"];
const PROPOSABLE = ["PENDING_SCHEDULE", "PROPOSED"];
const RESCHEDULABLE = ["PROPOSED", "CONFIRMED"];

const CANCELLATION_REASONS = [
  { value: "CUSTOMER_REQUEST", label: "Customer request" },
  { value: "PROFESSIONAL_UNAVAILABLE", label: "Professional unavailable" },
  { value: "SCHEDULING_CONFLICT", label: "Scheduling conflict" },
  { value: "OTHER", label: "Other" },
];

/** Converts a Date to the value a <input type="datetime-local"> expects,
 *  in the browser's local time — the input itself has no timezone
 *  concept, and the server converts back to a UTC instant on submit (see
 *  schema.prisma's Appointment.scheduledStart doc comment for the
 *  timezone decision this UI relies on). */
function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function TimeWindowForm({
  appointmentId,
  submitLabel,
  onSubmit,
}: {
  appointmentId: string;
  submitLabel: string;
  onSubmit: typeof proposeAppointmentTimeAction;
}) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const defaultStart = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const defaultEnd = new Date(defaultStart.getTime() + 60 * 60 * 1000);
  const [start, setStart] = useState(toLocalInputValue(defaultStart));
  const [end, setEnd] = useState(toLocalInputValue(defaultEnd));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    const result = await onSubmit(appointmentId, new Date(start), new Date(end));
    setIsSubmitting(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-md border border-border p-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="flex flex-1 flex-col gap-1 text-sm">
          Start
          <input
            type="datetime-local"
            required
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="rounded-md border border-border px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1 text-sm">
          End
          <input
            type="datetime-local"
            required
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className="rounded-md border border-border px-3 py-2 text-sm"
          />
        </label>
      </div>
      {error && (
        <p role="alert" className="rounded-md bg-red-100 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Saving…" : submitLabel}
      </Button>
    </form>
  );
}

function ConfirmButton({ appointmentId }: { appointmentId: string }) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setIsSubmitting(true);
    setError(null);
    const result = await confirmAppointmentAction(appointmentId);
    setIsSubmitting(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2">
      <Button type="button" disabled={isSubmitting} onClick={handleConfirm}>
        {isSubmitting ? "Confirming…" : "Confirm this time"}
      </Button>
      {error && (
        <p role="alert" className="rounded-md bg-red-100 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

function CancelDialog({ appointmentId }: { appointmentId: string }) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [reason, setReason] = useState<string>(CANCELLATION_REASONS[0]?.value ?? "OTHER");
  const [note, setNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCancel() {
    setIsSubmitting(true);
    setError(null);
    const result = await cancelAppointmentAction(appointmentId, reason, note);
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
        Cancel appointment
      </Button>
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="cancel-appointment-title"
      className="flex flex-col gap-3 rounded-md border border-border bg-black/5 p-4"
    >
      <h3 id="cancel-appointment-title" className="text-sm font-semibold">
        Cancel this appointment?
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
 * Booking & Scheduling module (Module 10). Renders exactly the actions
 * valid for the appointment's current status (see
 * domain/services/appointment-state.ts) — this is a UX convenience only;
 * every action is re-validated server-side by its own use case regardless
 * of what this component decides to show, so it can never itself be a
 * source of an authorization bypass.
 *
 * `canConfirm` is passed in from the server component (computed there as
 * `appointment.proposedByUserId !== session.user.id`) rather than
 * recomputed here, since this component has no access to the session.
 */
export function AppointmentActions({
  appointmentId,
  status,
  canConfirm,
}: {
  appointmentId: string;
  status: string;
  canConfirm: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      {PROPOSABLE.includes(status) && (
        <TimeWindowForm
          appointmentId={appointmentId}
          submitLabel={status === "PROPOSED" ? "Propose a different time" : "Propose a time"}
          onSubmit={proposeAppointmentTimeAction}
        />
      )}
      {status === "PROPOSED" && canConfirm && <ConfirmButton appointmentId={appointmentId} />}
      {RESCHEDULABLE.includes(status) && status === "CONFIRMED" && (
        <TimeWindowForm appointmentId={appointmentId} submitLabel="Reschedule" onSubmit={rescheduleAppointmentAction} />
      )}
      {CANCELLABLE.includes(status) && <CancelDialog appointmentId={appointmentId} />}
    </div>
  );
}
