import { notFound } from "next/navigation";

import { makeGetAppointmentUseCase } from "@/application/use-cases/booking/compose";
import { NotFoundError } from "@/domain/errors/domain-error";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { PageHeader } from "@/components/dashboard/page-header";
import { PageContainer } from "@/components/layout/page-container";
import { ResponsiveGrid } from "@/components/layout/responsive-grid";
import { StatusTimeline } from "@/components/dashboard/status-timeline";
import { getAppointmentTimelineSteps } from "@/components/dashboard/appointment-timeline-steps";
import { formatAppointmentWindow } from "@/shared/utils/format-appointment-window";
import { AppointmentStatusBadge } from "../appointment-status-badge";
import { AppointmentActions } from "./appointment-actions";

export const metadata = { title: "Appointment" };

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
    <PageContainer gap="sm">
      <PageHeader
        title="Appointment"
        breadcrumbs={[{ label: "My appointments", href: "/appointments" }, { label: "Appointment" }]}
        actions={<AppointmentStatusBadge status={appointment.status} />}
      />

      <StatusTimeline steps={getAppointmentTimelineSteps(appointment.status)} />

      <ResponsiveGrid as="dl" cols="1-2" gap="sm" bordered>
        <div>
          <dt className="text-foreground/60">Confirmed time</dt>
          <dd>{formatAppointmentWindow(appointment.scheduledStart, appointment.scheduledEnd)}</dd>
        </div>
        <div>
          <dt className="text-foreground/60">Proposed time</dt>
          <dd>{formatAppointmentWindow(appointment.proposedStart, appointment.proposedEnd)}</dd>
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
    </PageContainer>
  );
}
