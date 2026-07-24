import type { AppointmentNotifier } from "@/application/ports/appointment-notifier";
import { NullNotificationCreator } from "@/application/ports/notification-creator";
import type { NotificationCreator } from "@/application/ports/notification-creator";
import { NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import type { AppointmentDetailRecord, AppointmentRepository } from "@/domain/repositories/appointment-repository";
import type { CustomerProfileRepository } from "@/domain/repositories/customer-profile-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { ServiceRequestRepository } from "@/domain/repositories/service-request-repository";
import { isConfirmableStatus } from "@/domain/services/appointment-state";
import { notifyOtherAppointmentParty } from "./notify-appointment-party";
import { resolveAppointmentActor } from "./resolve-appointment-actor";

/**
 * Booking & Scheduling module (Module 10): the *other* party confirms the
 * currently-proposed time, making it authoritative. This is the highest-
 * risk concurrency operation in the module — the actual conflict check and
 * race-safe write happen inside AppointmentRepository.confirm (see
 * PrismaAppointmentRepository.confirm's extensive doc comment for the
 * full three-layer protection story); this use case only handles
 * authorization and the "who proposed vs. who's confirming" business
 * rule, both of which are pure pre-checks — the repository's own
 * transaction is the authoritative check, exactly like
 * AcceptQuoteUseCase/QuoteAcceptanceRepository.
 *
 * Business rule: whoever last proposed the time cannot also be the one who
 * confirms it — confirmation must come from the other side. This isn't a
 * given from Appointment.status alone (both parties could otherwise no-op
 * "confirm their own proposal" back to back), so it's checked explicitly
 * here via `proposedByUserId`.
 */
export class ConfirmAppointmentUseCase {
  constructor(
    private readonly appointments: AppointmentRepository,
    private readonly customerProfiles: CustomerProfileRepository,
    private readonly professionals: ProfessionalRepository,
    private readonly serviceRequests: ServiceRequestRepository,
    private readonly notifier: AppointmentNotifier,
    private readonly notifications: NotificationCreator = new NullNotificationCreator(),
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

    if (!isConfirmableStatus(appointment.status)) {
      throw new ValidationError("There is no proposed time to confirm.");
    }
    if (appointment.proposedByUserId === userId) {
      throw new ValidationError("The other party needs to confirm this proposed time.");
    }

    // The authoritative status + conflict re-check happens inside this
    // call, in one transaction — see its doc comment.
    const confirmed = await this.appointments.confirm(appointmentId, ["PROPOSED"]);

    try {
      await this.notifier.notify({
        serviceRequestId: appointment.serviceRequestId,
        professionalProfileId: appointment.professionalProfileId,
        companyProfileId: appointment.companyProfileId,
        type: "CONFIRMED",
        actorUserId: userId,
        message:
          actor.role === "customer"
            ? "The customer confirmed the appointment time."
            : "The professional confirmed the appointment time.",
      });
    } catch (error) {
      console.error("Failed to post appointment-confirmed chat notice", error);
    }

    await notifyOtherAppointmentParty({
      appointment: confirmed,
      actor,
      type: "APPOINTMENT_CONFIRMED",
      title: "Appointment time confirmed",
      message:
        actor.role === "customer"
          ? "The customer confirmed the appointment time."
          : "The professional confirmed the appointment time.",
      customerProfiles: this.customerProfiles,
      professionals: this.professionals,
      serviceRequests: this.serviceRequests,
      notifications: this.notifications,
    });

    return confirmed;
  }
}
