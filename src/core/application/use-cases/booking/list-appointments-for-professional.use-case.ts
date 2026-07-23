import { ValidationError } from "@/domain/errors/domain-error";
import type { AppointmentRepository, AppointmentSummary } from "@/domain/repositories/appointment-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

/**
 * Booking & Scheduling module (Module 10): "my appointments" for the
 * signed-in solo professional — mirrors ListAppointmentsForCustomerUseCase.
 * `userId` is resolved to the caller's own ProfessionalProfile; a
 * signed-in user with no ProfessionalProfile simply has no appointments.
 * Company-owned appointments are out of scope for this list (see the
 * module's "Future Extensions" note — no CompanyMember-aware listing yet).
 */
export class ListAppointmentsForProfessionalUseCase {
  constructor(
    private readonly appointments: AppointmentRepository,
    private readonly professionals: ProfessionalRepository,
  ) {}

  async execute(
    userId: string,
    filter: "upcoming" | "past" | "cancelled" | undefined,
    page: { limit?: number; offset?: number } = {},
  ): Promise<AppointmentSummary[]> {
    const limit = page.limit ?? DEFAULT_PAGE_SIZE;
    const offset = page.offset ?? 0;
    if (limit < 1 || limit > MAX_PAGE_SIZE) {
      throw new ValidationError(`limit must be between 1 and ${MAX_PAGE_SIZE}.`);
    }
    if (offset < 0) {
      throw new ValidationError("offset cannot be negative.");
    }

    const professional = await this.professionals.findByUserId(userId);
    if (!professional) {
      return [];
    }

    return this.appointments.listForProfessional(professional.id, { filter, limit, offset });
  }
}
