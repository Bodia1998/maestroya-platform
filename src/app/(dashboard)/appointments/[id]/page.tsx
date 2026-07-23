import { notFound } from "next/navigation";

import { makeGetAppointmentUseCase } from "@/application/use-cases/booking/compose";
import { NotFoundError } from "@/domain/errors/domain-error";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { AppointmentStatusBadge } from "../appointment-status-badge";
import { AppointmentActions } from "./appointment-actions";

export const metadata = { title: "Appointment" };

function formatWindow(start: Date | null, end: Date | null): string {
  if (!start || !end) return "Not set";
  return `${start.toLocaleString()} – ${end.toLocaleTimeString()}`;
}

export default async function AppointmentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireAuth();

  // GetAppointmentUseCase re-derives whether the caller is actually a
  // participant in this appointment from the session — an id that exists
  // but isn't the caller's own surfaces as the same "not found" a
  // nonexistent id would (see resolveAppointmentActor's doc comment), so
  // this never leaks whether some other appointment id is valid.
  let appointment;
  try {
    appointment = await makeGetAppointmentUseCase().execute(user.id, id);
  } catch (error) {
    if (error instanceof NotFoundError) {
      notFound();
    }
    throw error;
  }

  const canConfirm = appointment.status === "PROPOSED" && appointment.proposedByUserId !== user.id;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-10">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Appointment</h1>
        <AppointmentStatusBadge status={appointment.status} />
      </div>

      <dl className="grid grid-cols-1 gap-3 rounded-md border border-border p-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-foreground/60">Confirmed time</dt>
          <dd>{formatWindow(appointment.scheduledStart, appointment.scheduledEnd)}</dd>
        </div>
        <div>
          <dt className="text-foreground/60">Proposed time</dt>
          <dd>{formatWindow(appointment.proposedStart, appointment.proposedEnd)}</dd>
        </div>
        {appointment.status === "CANCELLED" && (
          <div className="sm:col-span-2">
            <dt className="text-foreground/60">Cancellation reason</dt>
            <dd>
              {appointment.cancellationReason}
              {appointment.cancellationNote ? ` — ${appointment.cancellationNote}` : ""}
            </dd>
          </div>
        )}
      </dl>

      <AppointmentActions appointmentId={appointment.id} status={appointment.status} canConfirm={canConfirm} />
    </div>
  );
}
