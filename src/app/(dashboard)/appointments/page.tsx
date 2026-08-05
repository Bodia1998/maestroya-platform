import Link from "next/link";
import { CalendarDays } from "lucide-react";

import { makeListAppointmentsForCustomerUseCase } from "@/application/use-cases/booking/compose";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { AppointmentStatusBadge } from "./appointment-status-badge";

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
        <EmptyState icon={CalendarDays} title="No upcoming appointments" description="You have no upcoming appointments." />
      ) : (
        <ul className="flex flex-col gap-3">
          {appointments.map((appointment) => (
            <li key={appointment.id}>
              <Link
                href={`/appointments/${appointment.id}`}
                className="flex flex-col gap-2 rounded-md border border-border p-4 hover:bg-black/5"
              >
                <div className="flex items-center justify-between gap-4">
                  <h2 className="font-medium">{appointment.serviceRequestTitle}</h2>
                  <AppointmentStatusBadge status={appointment.status} />
                </div>
                {appointment.counterpartyName && (
                  <p className="text-sm text-foreground/70">with {appointment.counterpartyName}</p>
                )}
                <p className="text-sm text-foreground/70">
                  {formatWindow(appointment.scheduledStart, appointment.scheduledEnd)}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
