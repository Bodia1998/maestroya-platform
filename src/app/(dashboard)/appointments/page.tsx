import Link from "next/link";

import { makeListAppointmentsForCustomerUseCase } from "@/application/use-cases/booking/compose";
import { requireAuth } from "@/infrastructure/auth/rbac";
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
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10">
      <div>
        <h1 className="text-2xl font-semibold">My appointments</h1>
        <p className="mt-1 text-sm text-foreground/70">
          Appointments created from quotes you&apos;ve accepted.
        </p>
      </div>

      {appointments.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-foreground/70">
          You have no upcoming appointments.
        </p>
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
