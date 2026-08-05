import { CalendarDays } from "lucide-react";

import { makeListAppointmentsForCustomerUseCase } from "@/application/use-cases/booking/compose";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { PageHeader } from "@/components/dashboard/page-header";
import { AppointmentCard } from "@/components/dashboard/cards/appointment-card";
import { ButtonLink } from "@/components/ui/button-link";
import { EmptyState } from "@/components/ui/empty-state";
import { PageContainer } from "@/components/layout/page-container";
import { formatAppointmentWindow } from "@/shared/utils/format-appointment-window";

export const metadata = { title: "My appointments" };

export default async function AppointmentsPage() {
  const user = await requireAuth();
  // Never trust a client-supplied id — appointments are always looked up
  // for the authenticated session's own CustomerProfile, resolved inside
  // the use case itself.
  const appointments = await makeListAppointmentsForCustomerUseCase().execute(user.id, "upcoming");

  return (
    <PageContainer maxWidth="3xl" gap="sm">
      <PageHeader title="My appointments" subtitle="Appointments created from quotes you've accepted." />

      {appointments.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title="No upcoming appointments"
          description="Appointments appear here once you accept a quote from a professional."
          action={<ButtonLink href="/requests">View my requests</ButtonLink>}
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
                  "No time proposed yet",
                )}
              />
            </li>
          ))}
        </ul>
      )}
    </PageContainer>
  );
}
