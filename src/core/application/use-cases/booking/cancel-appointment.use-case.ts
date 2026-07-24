import type { AppointmentNotifier } from "@/application/ports/appointment-notifier";
import { NullNotificationCreator } from "@/application/ports/notification-creator";
import type { NotificationCreator } from "@/application/ports/notification-creator";
import { NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import type {
  AppointmentCancellationReasonValue,
  AppointmentDetailRecord,
  AppointmentRepository,
} from "@/domain/repositories/appointment-repository";
import type { CustomerProfileRepository } from "@/domain/repositories/customer-profile-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { ServiceRequestRepository } from "@/domain/repositories/service-request-repository";
import { NON_TERMINAL_STATUSES, isCancellableStatus } from "@/domain/services/appointment-state";
import { notifyOtherAppointmentParty } from "./notify-appointment-party";
import { resolveAppointmentActor } from "./resolve-appointment-actor";

/**
 * Booking & Scheduling module (Module 10): either the customer or the
 * professional may cancel an appointment that hasn't reached a terminal
 * state yet (PENDING_SCHEDULE, PROPOSED, or CONFIRMED — see
 * appointment-state.ts). No asymmetric business rule beyond that in this
 * pass (e.g. no "customer can't cancel within 24h of a confirmed time" —
 * that kind of timing-sensitive policy is deferred, see the module's
 * audit; the *typed* `reason` this records is exactly what a future policy
 * or refund-eligibility rule would key off).
 *
 * Deliberately does not implement refunds or any Stripe interaction — see
 * the module spec. `cancelledByUserId`/`cancellationReason`/
 * `cancellationNote` are persisted precisely so a future Payment module
 * can react to a cancellation without Booking needing to change.
 */
export class CancelAppointmentUseCase {
  constructor(
    private readonly appointments: AppointmentRepository,
    private readonly customerProfiles: CustomerProfileRepository,
    private readonly professionals: ProfessionalRepository,
    private readonly serviceRequests: ServiceRequestRepository,
    private readonly notifier: AppointmentNotifier,
    private readonly notifications: NotificationCreator = new NullNotificationCreator(),
  ) {}

  async execute(
    userId: string,
    appointmentId: string,
    reason: AppointmentCancellationReasonValue,
    note: string | null,
  ): Promise<AppointmentDetailRecord> {
    const appointment = await this.appointments.findById(appointmentId);
    if (!appointment) {
      throw new NotFoundError("Appointment", appointmentId);
    }

    const actor = await resolveAppointmentActor(userId, appointment, {
      customerProfiles: this.customerProfiles,
      professionals: this.professionals,
      serviceRequests: this.serviceRequests,
    });

    if (!isCancellableStatus(appointment.status)) {
      throw new ValidationError("This appointment can no longer be cancelled.");
    }

    const cancelled = await this.appointments.cancel({
      appointmentId,
      cancelledByUserId: userId,
      reason,
      note,
      expectedStatuses: NON_TERMINAL_STATUSES,
    });

    try {
      await this.notifier.notify({
        serviceRequestId: appointment.serviceRequestId,
        professionalProfileId: appointment.professionalProfileId,
        companyProfileId: appointment.companyProfileId,
        type: "CANCELLED",
        actorUserId: userId,
        message:
          actor.role === "customer"
            ? "The customer cancelled this appointment."
            : "The professional cancelled this appointment.",
      });
    } catch (error) {
      console.error("Failed to post appointment-cancelled chat notice", error);
    }

    await notifyOtherAppointmentParty({
      appointment: cancelled,
      actor,
      type: "APPOINTMENT_CANCELLED",
      title: "Appointment cancelled",
      message:
        actor.role === "customer"
          ? "The customer cancelled this appointment."
          : "The professional cancelled this appointment.",
      customerProfiles: this.customerProfiles,
      professionals: this.professionals,
      serviceRequests: this.serviceRequests,
      notifications: this.notifications,
    });

    return cancelled;
  }
}
