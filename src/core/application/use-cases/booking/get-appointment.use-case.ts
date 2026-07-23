import { NotFoundError } from "@/domain/errors/domain-error";
import type { AppointmentDetailRecord, AppointmentRepository } from "@/domain/repositories/appointment-repository";
import type { CustomerProfileRepository } from "@/domain/repositories/customer-profile-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { ServiceRequestRepository } from "@/domain/repositories/service-request-repository";
import { resolveAppointmentActor } from "./resolve-appointment-actor";

/**
 * Booking & Scheduling module (Module 10): fetches one Appointment's full
 * detail for its detail page, authorized the same way every other
 * Appointment use case is — see resolveAppointmentActor's doc comment.
 */
export class GetAppointmentUseCase {
  constructor(
    private readonly appointments: AppointmentRepository,
    private readonly customerProfiles: CustomerProfileRepository,
    private readonly professionals: ProfessionalRepository,
    private readonly serviceRequests: ServiceRequestRepository,
  ) {}

  async execute(userId: string, appointmentId: string): Promise<AppointmentDetailRecord> {
    const appointment = await this.appointments.findById(appointmentId);
    if (!appointment) {
      throw new NotFoundError("Appointment", appointmentId);
    }

    await resolveAppointmentActor(userId, appointment, {
      customerProfiles: this.customerProfiles,
      professionals: this.professionals,
      serviceRequests: this.serviceRequests,
    });

    return appointment;
  }
}
