import type { AppointmentNotifier } from "@/application/ports/appointment-notifier";
import { NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import type { AppointmentDetailRecord, AppointmentRepository } from "@/domain/repositories/appointment-repository";
import type { CustomerProfileRepository } from "@/domain/repositories/customer-profile-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { ServiceRequestRepository } from "@/domain/repositories/service-request-repository";
import { isCompletableStatus } from "@/domain/services/appointment-state";
import { resolveAppointmentActor } from "./resolve-appointment-actor";

/**
 * Order / Job Lifecycle module (Module 11): CONFIRMED -> COMPLETED — marks
 * one visit/work session as done. This is Module 10's own unfinished
 * corner (AppointmentStatus.COMPLETED and appointment-state.ts's
 * isCompletableStatus() have existed since Module 10 shipped, but no use
 * case ever exercised the transition — see the module's audit report,
 * "Existing Functionality"), filled in here using Module 10's own
 * conventions verbatim: resolveAppointmentActor for authorization, the
 * `expectedStatuses` optimistic-concurrency pattern, and a best-effort
 * chat notification wrapped in try/catch.
 *
 * Deliberately separate from Job completion (CompleteJobUseCase, IN_PROGRESS
 * -> COMPLETED on the Job): Appointment COMPLETED means "this one visit is
 * done," Job COMPLETED means "the entire engagement is done" — this use
 * case never reads or writes Job.status. A multi-visit Job may have several
 * Appointments completed via this use case over time before the Job itself
 * is ever marked complete.
 *
 * Authorization: either the customer or the professional side may mark an
 * appointment completed (same "either party" convention as
 * CancelAppointmentUseCase) — there is no current requirement in this
 * codebase for two-sided completion confirmation (see the module's audit
 * report, "Authorization Model" — a customer-side confirmation step is
 * flagged there as a possible future product decision, not assumed here).
 */
export class CompleteAppointmentUseCase {
  constructor(
    private readonly appointments: AppointmentRepository,
    private readonly customerProfiles: CustomerProfileRepository,
    private readonly professionals: ProfessionalRepository,
    private readonly serviceRequests: ServiceRequestRepository,
    private readonly notifier: AppointmentNotifier,
  ) {}

  async execute(userId: string, appointmentId: string): Promise<AppointmentDetailRecord> {
    const appointment = await this.appointments.findById(appointmentId);
    if (!appointment) {
      throw new NotFoundError("Appointment", appointmentId);
    }

    const actor = await resolveAppointmentActor(userId, appointment, {
      customerProfiles: this.customerProfiles,
      professionals: this.professionals,
      serviceRequests: this.serviceRequests,
    });

    if (!isCompletableStatus(appointment.status)) {
      throw new ValidationError("Only a confirmed appointment can be marked completed.");
    }

    const completed = await this.appointments.complete({
      appointmentId,
      expectedStatuses: ["CONFIRMED"],
    });

    try {
      await this.notifier.notify({
        serviceRequestId: appointment.serviceRequestId,
        professionalProfileId: appointment.professionalProfileId,
        companyProfileId: appointment.companyProfileId,
        type: "COMPLETED",
        actorUserId: userId,
        message:
          actor.role === "customer"
            ? "The customer marked this appointment as completed."
            : "The professional marked this appointment as completed.",
      });
    } catch (error) {
      console.error("Failed to post appointment-completed chat notice", error);
    }

    return completed;
  }
}
