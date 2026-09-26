import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";

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

export async function generateMetadata() {
  const t = await getTranslations("customer.appointments");
  return { title: t("detail.title") };
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
  const [t, format] = await Promise.all([getTranslations("customer.appointments"), getFormatter()]);
  const reason = appointment.cancellationReason;
  const reasonLabel =
    reason && t.has(`cancellationReason.${reason}` as never) ? t(`cancellationReason.${reason}` as never) : reason;

  return (
    <PageContainer gap="sm">
      <PageHeader
        title={t("detail.title")}
        breadcrumbs={[{ label: t("list.title"), href: "/appointments" }, { label: t("detail.title") }]}
        actions={<AppointmentStatusBadge status={appointment.status} />}
      />

      <StatusTimeline steps={getAppointmentTimelineSteps(appointment.status)} />

      <ResponsiveGrid as="dl" cols="1-2" gap="sm" bordered>
        <div>
          <dt className="text-foreground/60">{t("detail.confirmedTime")}</dt>
          <dd>{formatAppointmentWindow(appointment.scheduledStart, appointment.scheduledEnd, t("notSet"), format)}</dd>
        </div>
        <div>
          <dt className="text-foreground/60">{t("detail.proposedTime")}</dt>
          <dd>{formatAppointmentWindow(appointment.proposedStart, appointment.proposedEnd, t("notSet"), format)}</dd>
        </div>
        {appointment.status === "CANCELLED" && (
          <div className="sm:col-span-2">
            <dt className="text-foreground/60">{t("detail.cancellationReason")}</dt>
            <dd>
              {reasonLabel}
              {appointment.cancellationNote ? ` — ${appointment.cancellationNote}` : ""}
            </dd>
          </div>
        )}
      </ResponsiveGrid>

      <AppointmentActions appointmentId={appointment.id} status={appointment.status} canConfirm={canConfirm} />
    </PageContainer>
  );
}
