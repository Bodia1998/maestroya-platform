import type { AppointmentNotifier } from "@/application/ports/appointment-notifier";
import { NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import type {
  AppointmentRepository,
  RescheduleAppointmentResult,
} from "@/domain/repositories/appointment-repository";
import type { CustomerProfileRepository } from "@/domain/repositories/customer-profile-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { ServiceRequestRepository } from "@/domain/repositories/service-request-repository";
import { RESCHEDULABLE_STATUSES, isReschedulableStatus } from "@/domain/services/appointment-state";
import { hasMinimumNotice, isValidWindow } from "@/domain/services/scheduling-rules";
import { resolveAppointmentActor } from "./resolve-appointment-actor";

/**
 * Booking & Scheduling module (Module 10): moves an already proposed or
 * confirmed appointment to a new time, non-destructively. The existing
 * Appointment row transitions to RESCHEDULED (terminal, its full
 * proposal/confirmation/cancellation history preserved forever) and a
 * brand-new Appointment row is created — linked via `rescheduledFromId`,
 * carrying over the same quote/service-request/address/ownership — which
 * starts at PROPOSED with the newly requested time. It still requires the
 * other party's confirmation via ConfirmAppointmentUseCase, so this never
 * bypasses the same conflict-checked confirm path a fresh proposal would
 * (see AppointmentRepository.reschedule's doc comment).
 *
 * Either party may request a reschedule of an appointment they're part of,
 * as long as it's still PROPOSED or CONFIRMED (not yet
 * PENDING_SCHEDULE — nothing exists to move yet, use
 * ProposeAppointmentTimeUseCase for the initial proposal — and not a
 * terminal appointment).
 */
export class RescheduleAppointmentUseCase {
  constructor(
    private readonly appointments: AppointmentRepository,
    private readonly customerProfiles: CustomerProfileRepository,
    private readonly professionals: ProfessionalRepository,
    private readonly serviceRequests: ServiceRequestRepository,
    private readonly notifier: AppointmentNotifier,
  ) {}

  async execute(
    userId: string,
    appointmentId: string,
    proposedStart: Date,
    proposedEnd: Date,
  ): Promise<RescheduleAppointmentResult> {
    const appointment = await this.appointments.findById(appointmentId);
    if (!appointment) {
      throw new NotFoundError("Appointment", appointmentId);
    }

    const actor = await resolveAppointmentActor(userId, appointment, {
      customerProfiles: this.customerProfiles,
      professionals: this.professionals,
      serviceRequests: this.serviceRequests,
    });

    if (!isReschedulableStatus(appointment.status)) {
      throw new ValidationError("This appointment can no longer be rescheduled.");
    }
    if (!isValidWindow(proposedStart, proposedEnd)) {
      throw new ValidationError("Enter a valid appointment window (30 minutes to 12 hours long).");
    }
    if (!hasMinimumNotice(proposedStart)) {
      throw new ValidationError("Proposed times must be at least 2 hours from now.");
    }

    const result = await this.appointments.reschedule({
      appointmentId,
      proposedStart,
      proposedEnd,
      proposedByUserId: userId,
      expectedStatuses: RESCHEDULABLE_STATUSES,
    });

    try {
      await this.notifier.notify({
        serviceRequestId: appointment.serviceRequestId,
        professionalProfileId: appointment.professionalProfileId,
        companyProfileId: appointment.companyProfileId,
        type: "RESCHEDULED",
        actorUserId: userId,
        message:
          actor.role === "customer"
            ? "The customer requested to reschedule this appointment."
            : "The professional requested to reschedule this appointment.",
      });
    } catch (error) {
      console.error("Failed to post appointment-rescheduled chat notice", error);
    }

    return result;
  }
}
