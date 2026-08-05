import { notFound } from "next/navigation";

import {
  makeGetJobUseCase,
} from "@/application/use-cases/job/compose";
import {
  makeListAppointmentsForCustomerUseCase,
  makeListAppointmentsForProfessionalUseCase,
} from "@/application/use-cases/booking/compose";
import { NotFoundError } from "@/domain/errors/domain-error";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { PageHeader } from "@/components/dashboard/page-header";
import { AppointmentStatusBadge } from "@/app/(dashboard)/appointments/appointment-status-badge";
import { JobStatusBadge } from "../job-status-badge";
import { JobActions } from "./job-actions";

export const metadata = { title: "Job" };

const APPOINTMENT_NON_TERMINAL = ["PENDING_SCHEDULE", "PROPOSED", "CONFIRMED"];

function formatDate(date: Date | null): string {
  return date ? date.toLocaleString() : "—";
}

/**
 * Order / Job Lifecycle module (Module 11): shared customer/professional
 * detail page — GetJobUseCase accepts either side of the Job (see
 * resolveJobActor) and reports back which side the caller is on, the same
 * "shared page, use case decides who's allowed" pattern
 * appointments/[id]/page.tsx already uses. A Job that exists but isn't the
 * caller's own surfaces as the same 404 a nonexistent id would.
 */
export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireAuth();

  let job;
  let viewerRole: "customer" | "professional";
  try {
    const result = await makeGetJobUseCase().execute(user.id, id);
    job = result.job;
    // resolveJobActor's "company" role (Module 28 — Workflow Completion) is
    // only reachable when a caller passes `companyMembers` in its deps —
    // GetJobUseCase's own compose.ts never does, so this page can never
    // actually observe "company" here; the cast just narrows back to this
    // page's pre-existing two-role UI (customer vs. professional).
    viewerRole = result.viewerRole as "customer" | "professional";
  } catch (error) {
    if (error instanceof NotFoundError) {
      notFound();
    }
    throw error;
  }

  // Every Appointment belonging to this Job shares its serviceRequestId
  // (see prisma/schema.prisma's Job doc comment — a ServiceRequest has at
  // most one accepted Quote, hence at most one Job) — used here only to
  // decide whether "Mark job completed" should show its blocked-by-open-
  // appointment explanation up front; the authoritative check happens
  // inside JobRepository.complete regardless of what this page displays.
  const appointments =
    viewerRole === "customer"
      ? await makeListAppointmentsForCustomerUseCase().execute(user.id, undefined, { limit: 50 })
      : await makeListAppointmentsForProfessionalUseCase().execute(user.id, undefined, { limit: 50 });
  const jobAppointments = appointments.filter((a) => a.serviceRequestId === job.serviceRequestId);
  const hasOpenAppointments = jobAppointments.some((a) => APPOINTMENT_NON_TERMINAL.includes(a.status));

  const backHref = viewerRole === "customer" ? "/jobs" : "/dashboard/professional/jobs";

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <PageHeader
        title="Job"
        breadcrumbs={[{ label: "My jobs", href: backHref }, { label: "Job" }]}
        actions={<JobStatusBadge status={job.status} />}
      />

      <dl className="grid grid-cols-1 gap-3 rounded-md border border-border p-4 text-sm sm:grid-cols-2">
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
      </dl>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Appointments on this job</h2>
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
      </section>

      <JobActions jobId={job.id} status={job.status} viewerRole={viewerRole} hasOpenAppointments={hasOpenAppointments} />
    </div>
  );
}
