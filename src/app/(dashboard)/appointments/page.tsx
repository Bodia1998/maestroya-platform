import { CalendarDays } from "lucide-react";

import { makeListAppointmentsForCustomerUseCase } from "@/application/use-cases/booking/compose";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { PageHeader } from "@/components/dashboard/page-header";
import { AppointmentCard } from "@/components/dashboard/cards/appointment-card";
import { ButtonLink } from "@/components/ui/button-link";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata = { title: "My appointments" };

function formatWindow(start: Date | null, end: Date | null): string {
  if (!start || !end) return "No time proposed yet";
  return `${start.toLocaleString()} – ${end.toLocaleTimeString()}`;
}

export default async function AppointmentsPage() {
  const user = await requireAuth();
  // Never trust a client-supplied id — appointments are always looked up
  // for the authenticated session's own CustomerProfile, resolved inside
  // the use case itself.
  const appointments = await makeListAppointmentsForCustomerUseCase().execute(user.id, "upcoming");

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
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
                window={formatWindow(appointment.scheduledStart, appointment.scheduledEnd)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
