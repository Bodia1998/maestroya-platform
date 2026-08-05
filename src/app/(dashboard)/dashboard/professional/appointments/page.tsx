import Link from "next/link";

import { makeListAppointmentsForProfessionalUseCase } from "@/application/use-cases/booking/compose";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { AppointmentStatusBadge } from "@/app/(dashboard)/appointments/appointment-status-badge";
import { PageHeader } from "@/components/dashboard/page-header";

export const metadata = { title: "My appointments" };

function formatWindow(start: Date | null, end: Date | null): string {
  if (!start || !end) return "No time proposed yet";
  return `${start.toLocaleString()} – ${end.toLocaleTimeString()}`;
}

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
        <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-foreground/70">
          You have no upcoming appointments.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {appointments.map((appointment) => (
            <li key={appointment.id}>
              <Link
                href={`/dashboard/professional/appointments/${appointment.id}`}
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
