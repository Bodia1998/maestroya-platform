import { notFound } from "next/navigation";

import { makeGetAppointmentUseCase } from "@/application/use-cases/booking/compose";
import { NotFoundError } from "@/domain/errors/domain-error";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { AppointmentStatusBadge } from "@/app/(dashboard)/appointments/appointment-status-badge";
import { AppointmentActions } from "@/app/(dashboard)/appointments/[id]/appointment-actions";
import { PageHeader } from "@/components/dashboard/page-header";
import { ResponsiveGrid } from "@/components/layout/responsive-grid";

export const metadata = { title: "Appointment" };

function formatWindow(start: Date | null, end: Date | null): string {
  if (!start || !end) return "Not set";
  return `${start.toLocaleString()} – ${end.toLocaleTimeString()}`;
}

/**
 * Professional-side mirror of appointments/[id]/page.tsx — same
 * GetAppointmentUseCase (authorization inside it accepts either the
 * customer or the professional side of the appointment, see
 * resolveAppointmentActor), same AppointmentActions component. Kept as a
 * separate route (under the professional dashboard) rather than one
 * "smart" shared page, matching this app's existing convention of
 * separate customer-facing vs. professional-facing routes for the same
 * underlying entity (compare /requests/[id] vs.
 * /dashboard/professional/requests/[id]).
 */
export default async function ProfessionalAppointmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireAuth();

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
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Appointment"
        breadcrumbs={[{ label: "My appointments", href: "/dashboard/professional/appointments" }, { label: "Appointment" }]}
        actions={<AppointmentStatusBadge status={appointment.status} />}
      />

      <ResponsiveGrid as="dl" cols="1-2" gap="sm" bordered>
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
      </ResponsiveGrid>

      <AppointmentActions appointmentId={appointment.id} status={appointment.status} canConfirm={canConfirm} />
    </div>
  );
}
