import { notFound } from "next/navigation";

import { makeGetJobUseCase } from "@/application/use-cases/job/compose";
import {
  makeListAppointmentsForCustomerUseCase,
  makeListAppointmentsForProfessionalUseCase,
} from "@/application/use-cases/booking/compose";
import { NotFoundError } from "@/domain/errors/domain-error";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { AppointmentStatusBadge } from "@/app/(dashboard)/appointments/appointment-status-badge";
import { JobStatusBadge } from "@/app/(dashboard)/jobs/job-status-badge";
import { JobActions } from "@/app/(dashboard)/jobs/[id]/job-actions";
import { PageHeader } from "@/components/dashboard/page-header";
import { Section } from "@/components/layout/section";
import { ResponsiveGrid } from "@/components/layout/responsive-grid";

export const metadata = { title: "Job" };

const APPOINTMENT_NON_TERMINAL = ["PENDING_SCHEDULE", "PROPOSED", "CONFIRMED"];

function formatDate(date: Date | null): string {
  return date ? date.toLocaleString() : "—";
}

/**
 * Order / Job Lifecycle module (Module 11): professional-side mirror of
 * jobs/[id]/page.tsx — same GetJobUseCase (authorization inside it accepts
 * either side of the Job, see resolveJobActor), same JobActions component.
 * Kept as a separate route (under the professional dashboard) rather than
 * one "smart" shared page, matching this app's existing convention of
 * separate customer-facing vs. professional-facing routes for the same
 * underlying entity (compare appointments/[id] vs.
 * dashboard/professional/appointments/[id]).
 */
export default async function ProfessionalJobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireAuth();

  let job;
  let viewerRole: "customer" | "professional";
  try {
    const result = await makeGetJobUseCase().execute(user.id, id);
    job = result.job;
    // See the equivalent comment in jobs/[id]/page.tsx — GetJobUseCase's
    // compose.ts never wires resolveJobActor's optional `companyMembers`
    // dep, so its "company" role (Module 28 — Workflow Completion) can
    // never actually be observed here.
    viewerRole = result.viewerRole as "customer" | "professional";
  } catch (error) {
    if (error instanceof NotFoundError) {
      notFound();
    }
    throw error;
  }

  const appointments =
    viewerRole === "customer"
      ? await makeListAppointmentsForCustomerUseCase().execute(user.id, undefined, { limit: 50 })
      : await makeListAppointmentsForProfessionalUseCase().execute(user.id, undefined, { limit: 50 });
  const jobAppointments = appointments.filter((a) => a.serviceRequestId === job.serviceRequestId);
  const hasOpenAppointments = jobAppointments.some((a) => APPOINTMENT_NON_TERMINAL.includes(a.status));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Job"
        breadcrumbs={[{ label: "My jobs", href: "/dashboard/professional/jobs" }, { label: "Job" }]}
        actions={<JobStatusBadge status={job.status} />}
      />

      <ResponsiveGrid as="dl" cols="1-2" gap="sm" bordered>
        <div>
          <dt className="text-foreground/60">Started</dt>
          <dd>{formatDate(job.startedAt)}</dd>
        </div>
        <div>
          <dt className="text-foreground/60">Completed</dt>
          <dd>{formatDate(job.completedAt)}</dd>
        </div>
        {job.status === "CANCELLED" && (
          <div className="sm:col-span-2">
            <dt className="text-foreground/60">Cancellation reason</dt>
            <dd>
              {job.cancellationReason}
              {job.cancellationNote ? ` — ${job.cancellationNote}` : ""}
            </dd>
          </div>
        )}
      </ResponsiveGrid>

      <Section title="Appointments on this job">
        {jobAppointments.length === 0 ? (
          <p className="rounded-md border border-dashed border-border p-4 text-center text-sm text-foreground/70">
            No appointments yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {jobAppointments.map((appointment) => (
              <li
                key={appointment.id}
                className="flex items-center justify-between gap-4 rounded-md border border-border p-3"
              >
                <span className="text-sm">
                  {appointment.scheduledStart ? appointment.scheduledStart.toLocaleString() : "Not scheduled yet"}
                </span>
                <AppointmentStatusBadge status={appointment.status} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <JobActions jobId={job.id} status={job.status} viewerRole={viewerRole} hasOpenAppointments={hasOpenAppointments} />
    </div>
  );
}
