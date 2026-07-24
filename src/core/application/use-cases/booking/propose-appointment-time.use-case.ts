import type { AppointmentNotifier } from "@/application/ports/appointment-notifier";
import { NullNotificationCreator } from "@/application/ports/notification-creator";
import type { NotificationCreator } from "@/application/ports/notification-creator";
import { NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import type { AppointmentDetailRecord, AppointmentRepository } from "@/domain/repositories/appointment-repository";
import type { CustomerProfileRepository } from "@/domain/repositories/customer-profile-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { ServiceRequestRepository } from "@/domain/repositories/service-request-repository";
import { PROPOSABLE_STATUSES, isProposableStatus } from "@/domain/services/appointment-state";
import { hasMinimumNotice, isValidWindow } from "@/domain/services/scheduling-rules";
import { notifyOtherAppointmentParty } from "./notify-appointment-party";
import { resolveAppointmentActor } from "./resolve-appointment-actor";

/**
 * Booking & Scheduling module (Module 10): either party (customer or
 * professional) puts forward a `[proposedStart, proposedEnd)` window for
 * an Appointment that's PENDING_SCHEDULE (first proposal) or already
 * PROPOSED (counter-proposal). This never confirms anything — the
 * appointment moves to PROPOSED and stays there until the *other* party
 * calls ConfirmAppointmentUseCase (see appointment-state.ts).
 *
 * Authorization: `userId` comes from the server-side session; ownership is
 * re-derived via resolveAppointmentActor, never trusted from a
 * client-supplied id. Either side may propose, including proposing again
 * to counter-offer a different time than what the other side (or they
 * themselves) last put forward.
 */
export class ProposeAppointmentTimeUseCase {
  constructor(
    private readonly appointments: AppointmentRepository,
    private readonly customerProfiles: CustomerProfileRepository,
    private readonly professionals: ProfessionalRepository,
    private readonly serviceRequests: ServiceRequestRepository,
    private readonly notifier: AppointmentNotifier,
    // Notifications module (Module 15): optional, defaults to a no-op so
    // every pre-existing direct construction of this use case (this
    // codebase's own tests) keeps compiling and behaving exactly as
    // before — see NullNotificationCreator's own doc comment.
    private readonly notifications: NotificationCreator = new NullNotificationCreator(),
  ) {}

  async execute(
    userId: string,
    appointmentId: string,
    proposedStart: Date,
    proposedEnd: Date,
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

    if (!isProposableStatus(appointment.status)) {
      throw new ValidationError("This appointment can no longer be scheduled.");
    }
    if (!isValidWindow(proposedStart, proposedEnd)) {
      throw new ValidationError("Enter a valid appointment window (30 minutes to 12 hours long).");
    }
    if (!hasMinimumNotice(proposedStart)) {
      throw new ValidationError("Proposed times must be at least 2 hours from now.");
    }

    const updated = await this.appointments.proposeTime({
      appointmentId,
      proposedStart,
      proposedEnd,
      proposedByUserId: userId,
      expectedStatuses: PROPOSABLE_STATUSES,
    });

    try {
      await this.notifier.notify({
        serviceRequestId: appointment.serviceRequestId,
        professionalProfileId: appointment.professionalProfileId,
        companyProfileId: appointment.companyProfileId,
        type: "PROPOSED",
        actorUserId: userId,
        message:
          actor.role === "customer"
            ? "The customer proposed a new appointment time."
            : "The professional proposed a new appointment time.",
      });
    } catch (error) {
      // Best-effort — see ChatAppointmentNotifier's doc comment. A chat
      // notification failure must never undo or fail the scheduling action
      // itself.
      console.error("Failed to post appointment-proposed chat notice", error);
    }

    await notifyOtherAppointmentParty({
      appointment: updated,
      actor,
      type: "APPOINTMENT_PROPOSED",
      title: "New appointment time proposed",
      message:
        actor.role === "customer"
          ? "The customer proposed a new appointment time."
          : "The professional proposed a new appointment time.",
      customerProfiles: this.customerProfiles,
      professionals: this.professionals,
      serviceRequests: this.serviceRequests,
      notifications: this.notifications,
    });

    return updated;
  }
}
