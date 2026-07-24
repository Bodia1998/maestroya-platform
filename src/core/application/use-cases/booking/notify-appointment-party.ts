import type { NotificationCreator } from "@/application/ports/notification-creator";
import type { NotificationTypeValue } from "@/domain/repositories/notification-repository";
import type { AppointmentDetailRecord } from "@/domain/repositories/appointment-repository";
import type { CustomerProfileRepository } from "@/domain/repositories/customer-profile-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { ServiceRequestRepository } from "@/domain/repositories/service-request-repository";
import type { AppointmentActor } from "./resolve-appointment-actor";

/**
 * Notifications module (Module 15) integration point shared by
 * Propose/Confirm/CancelAppointmentUseCase: resolves the *other* party's
 * userId (relative to whichever side just acted) and fires an in-app
 * notification through the NotificationCreator port. Deliberately
 * best-effort — swallows and logs any error (mirrors ChatAppointmentNotifier's
 * own doc comment on why a notification-side failure must never surface
 * as a Booking failure or roll back a Booking transaction). Company-owned
 * appointments (`professionalProfileId: null`) are silently skipped, same
 * scope limit as ChatAppointmentNotifier.
 */
export async function notifyOtherAppointmentParty(params: {
  appointment: AppointmentDetailRecord;
  actor: AppointmentActor;
  type: NotificationTypeValue;
  title: string;
  message: string;
  customerProfiles: CustomerProfileRepository;
  professionals: ProfessionalRepository;
  serviceRequests: ServiceRequestRepository;
  notifications: NotificationCreator;
}): Promise<void> {
  try {
    if (!params.appointment.professionalProfileId) return;

    const serviceRequest = await params.serviceRequests.findById(params.appointment.serviceRequestId);
    if (!serviceRequest) return;

    if (params.actor.role === "customer") {
      const professional = await params.professionals.findById(params.appointment.professionalProfileId);
      if (!professional) return;
      await params.notifications.notify({
        userId: professional.userId,
        type: params.type,
        title: params.title,
        message: params.message,
        resourceType: "APPOINTMENT",
        resourceId: params.appointment.id,
        actionUrl: `/appointments/${params.appointment.id}`,
      });
    } else {
      const customer = await params.customerProfiles.findById(serviceRequest.customerId);
      if (!customer) return;
      await params.notifications.notify({
        userId: customer.userId,
        type: params.type,
        title: params.title,
        message: params.message,
        resourceType: "APPOINTMENT",
        resourceId: params.appointment.id,
        actionUrl: `/appointments/${params.appointment.id}`,
      });
    }
  } catch (error) {
    console.error("Failed to create appointment notification", error);
  }
}
