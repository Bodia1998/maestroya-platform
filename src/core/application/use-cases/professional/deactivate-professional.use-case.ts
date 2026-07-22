import { NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";

/**
 * Deactivates the *authenticated* user's own professional profile
 * (status -> INACTIVE). Looked up by session userId, never by a
 * client-supplied professionalId. Deactivating is idempotent-ish but an
 * already-deactivated profile is surfaced as a validation error rather
 * than silently succeeding, so the UI can give clear feedback instead of
 * a misleading "success".
 */
export class DeactivateProfessionalUseCase {
  constructor(private readonly professionals: ProfessionalRepository) {}

  async execute(userId: string): Promise<void> {
    const existing = await this.professionals.findByUserId(userId);
    if (!existing) {
      throw new NotFoundError("ProfessionalProfile", userId);
    }
    if (existing.status === "INACTIVE") {
      throw new ValidationError("This professional profile is already deactivated.");
    }

    await this.professionals.updateStatus(existing.id, "INACTIVE");
  }
}
