import { CalendarDays } from "lucide-react";

import { makeListAppointmentsForProfessionalUseCase } from "@/application/use-cases/booking/compose";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { PageHeader } from "@/components/dashboard/page-header";
import { AppointmentCard } from "@/components/dashboard/cards/appointment-card";
import { EmptyState } from "@/components/ui/empty-state";
import { formatAppointmentWindow } from "@/shared/utils/format-appointment-window";

export const metadata = { title: "My appointments" };

export default async function ProfessionalAppointmentsPage() {
  const user = await requireAuth();
  // Never trust a client-supplied id — resolved to the caller's own
  // ProfessionalProfile inside the use case, same convention as the
  // customer-side list.
  const appointments = await makeListAppointmentsForProfessionalUseCase().execute(user.id, "upcoming");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="My appointments" subtitle="Appointments from quotes your customers have accepted." />

      {appointments.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title="No upcoming appointments"
          description="Appointments appear here once a customer accepts one of your quotes."
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
    </div>
  );
}
