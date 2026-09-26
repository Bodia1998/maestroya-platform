import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";

import { makeGetAppointmentUseCase } from "@/application/use-cases/booking/compose";
import { NotFoundError } from "@/domain/errors/domain-error";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { AppointmentStatusBadge } from "@/app/(dashboard)/appointments/appointment-status-badge";
import { AppointmentActions } from "@/app/(dashboard)/appointments/[id]/appointment-actions";
import { PageHeader } from "@/components/dashboard/page-header";
import { ResponsiveGrid } from "@/components/layout/responsive-grid";
import { StatusTimeline } from "@/components/dashboard/status-timeline";
import { getAppointmentTimelineSteps } from "@/components/dashboard/appointment-timeline-steps";
import { formatAppointmentWindowLocalized } from "../appointment-window";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("professional.appointments.detail");
  return { title: t("metaTitle") };
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

  const [t, tAppointments, tList, format] = await Promise.all([
    getTranslations("professional.appointments.detail"),
    getTranslations("professional.appointments"),
    getTranslations("professional.appointments.list"),
    getFormatter(),
  ]);
  const windowLabel = (start: Date | null, end: Date | null) =>
    formatAppointmentWindowLocalized(format, (values) => tAppointments("window", values), start, end, t("notSet"));
  const reasonKey = `cancellationReasons.${appointment.cancellationReason ?? ""}`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("title")}
        breadcrumbs={[{ label: tList("title"), href: "/dashboard/professional/appointments" }, { label: t("title") }]}
        actions={<AppointmentStatusBadge status={appointment.status} />}
      />

      <StatusTimeline steps={getAppointmentTimelineSteps(appointment.status)} />

      <ResponsiveGrid as="dl" cols="1-2" gap="sm" bordered>
        <div>
          <dt className="text-foreground/60">{t("confirmedTime")}</dt>
          <dd>{windowLabel(appointment.scheduledStart, appointment.scheduledEnd)}</dd>
        </div>
        <div>
          <dt className="text-foreground/60">{t("proposedTime")}</dt>
          <dd>{windowLabel(appointment.proposedStart, appointment.proposedEnd)}</dd>
        </div>
        {appointment.status === "CANCELLED" && (
          <div className="sm:col-span-2">
            <dt className="text-foreground/60">{t("cancellationReason")}</dt>
            <dd>
              {appointment.cancellationReason && t.has(reasonKey as never)
                ? t(reasonKey as never)
                : appointment.cancellationReason}
              {appointment.cancellationNote ? ` — ${appointment.cancellationNote}` : ""}
            </dd>
          </div>
        )}
      </ResponsiveGrid>

      <AppointmentActions appointmentId={appointment.id} status={appointment.status} canConfirm={canConfirm} />
    </div>
  );
}
