import { CalendarDays } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";

import { makeListAppointmentsForCustomerUseCase } from "@/application/use-cases/booking/compose";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { PageHeader } from "@/components/dashboard/page-header";
import { AppointmentCard } from "@/components/dashboard/cards/appointment-card";
import { ButtonLink } from "@/components/ui/button-link";
import { EmptyState } from "@/components/ui/empty-state";
import { PageContainer } from "@/components/layout/page-container";
import { formatAppointmentWindow } from "@/shared/utils/format-appointment-window";

export async function generateMetadata() {
  const t = await getTranslations("customer.appointments");
  return { title: t("list.title") };
}

export default async function AppointmentsPage() {
  const user = await requireAuth();
  // Never trust a client-supplied id — appointments are always looked up
  // for the authenticated session's own CustomerProfile, resolved inside
  // the use case itself.
  const [appointments, t, format] = await Promise.all([
    makeListAppointmentsForCustomerUseCase().execute(user.id, "upcoming"),
    getTranslations("customer.appointments"),
    getFormatter(),
  ]);

  return (
    <PageContainer maxWidth="3xl" gap="sm">
      <PageHeader title={t("list.title")} subtitle={t("list.subtitle")} />

      {appointments.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title={t("list.empty.title")}
          description={t("list.empty.description")}
          action={<ButtonLink href="/requests">{t("list.empty.action")}</ButtonLink>}
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {appointments.map((appointment) => (
            <li key={appointment.id}>
              <AppointmentCard
                href={`/appointments/${appointment.id}`}
                title={appointment.serviceRequestTitle}
                status={appointment.status}
                counterpartyName={appointment.counterpartyName}
                window={formatAppointmentWindow(
                  appointment.scheduledStart,
                  appointment.scheduledEnd,
                  t("noTimeProposed"),
                  format,
                )}
              />
            </li>
          ))}
        </ul>
      )}
    </PageContainer>
  );
}
