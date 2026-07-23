import { NotFoundError } from "@/domain/errors/domain-error";
import type { AppointmentDetailRecord } from "@/domain/repositories/appointment-repository";
import type { CustomerProfileRepository } from "@/domain/repositories/customer-profile-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { ServiceRequestRepository } from "@/domain/repositories/service-request-repository";

export type AppointmentActorRole = "customer" | "professional";

export interface AppointmentActor {
  role: AppointmentActorRole;
  userId: string;
}

/**
 * Booking & Scheduling module (Module 10): the single place every
 * Appointment-touching use case re-derives "is this authenticated user
 * actually a participant in this appointment, and on which side" —
 * shared rather than duplicated per use case because every propose/
 * confirm/cancel/reschedule/get use case needs the exact same check, and
 * this is the module's core IDOR defense.
 *
 * Same convention as AcceptQuoteUseCase/OpenConversationUseCase: `userId`
 * always comes from the server-side session, ownership is always
 * re-derived from it (never trusted from a client-supplied
 * customerId/professionalProfileId), and an appointment the caller has no
 * relationship to surfaces as the same NotFoundError as one that doesn't
 * exist — never a distinguishable "exists but isn't yours" response an
 * attacker could use to probe for valid appointment ids.
 *
 * Company-side ownership (Appointment.companyProfileId) is intentionally
 * not resolved here — this module's use cases only support solo
 * professionals for now (see the module's audit report, "Future
 * Extensions"); a company-owned Appointment can only be acted on by the
 * customer side until a CompanyMember-aware resolution is added.
 */
export async function resolveAppointmentActor(
  userId: string,
  appointment: AppointmentDetailRecord,
  deps: {
    customerProfiles: CustomerProfileRepository;
    professionals: ProfessionalRepository;
    serviceRequests: ServiceRequestRepository;
  },
): Promise<AppointmentActor> {
  const serviceRequest = await deps.serviceRequests.findById(appointment.serviceRequestId);
  if (!serviceRequest) {
    throw new NotFoundError("Appointment", appointment.id);
  }

  const [customer, professional] = await Promise.all([
    deps.customerProfiles.findByUserId(userId),
    deps.professionals.findByUserId(userId),
  ]);

  if (customer && customer.id === serviceRequest.customerId) {
    return { role: "customer", userId };
  }

  if (professional && appointment.professionalProfileId === professional.id) {
    return { role: "professional", userId };
  }

  throw new NotFoundError("Appointment", appointment.id);
}
