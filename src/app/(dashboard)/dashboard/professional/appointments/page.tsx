import { CalendarDays } from "lucide-react";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";

import { makeListAppointmentsForProfessionalUseCase } from "@/application/use-cases/booking/compose";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { PageHeader } from "@/components/dashboard/page-header";
import { AppointmentCard } from "@/components/dashboard/cards/appointment-card";
import { EmptyState } from "@/components/ui/empty-state";
import { formatAppointmentWindowLocalized } from "./appointment-window";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("professional.appointments.list");
  return { title: t("metaTitle") };
}

export default async function ProfessionalAppointmentsPage() {
  const user = await requireAuth();
  // Never trust a client-supplied id — resolved to the caller's own
  // ProfessionalProfile inside the use case, same convention as the
  // customer-side list.
  const [appointments, t, tAppointments, format] = await Promise.all([
    makeListAppointmentsForProfessionalUseCase().execute(user.id, "upcoming"),
    getTranslations("professional.appointments.list"),
    getTranslations("professional.appointments"),
    getFormatter(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      {appointments.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {appointments.map((appointment) => (
            <li key={appointment.id}>
              <AppointmentCard
                href={`/dashboard/professional/appointments/${appointment.id}`}
                title={appointment.serviceRequestTitle}
                status={appointment.status}
                counterpartyName={appointment.counterpartyName}
                window={formatAppointmentWindowLocalized(
                  format,
                  (values) => tAppointments("window", values),
                  appointment.scheduledStart,
                  appointment.scheduledEnd,
                  t("noTimeProposed"),
                )}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
