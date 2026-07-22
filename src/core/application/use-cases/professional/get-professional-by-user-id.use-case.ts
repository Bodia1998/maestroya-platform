import type { ProfessionalRecord, ProfessionalRepository } from "@/domain/repositories/professional-repository";

/**
 * Fetches the authenticated user's own professional profile, or null if
 * they haven't created one yet (a valid, expected state — this is not a
 * NotFoundError case, it's "show the create-profile form instead"). This
 * is the *only* way the dashboard should look up "my professional
 * profile" — `userId` must come from the server-side session, never a
 * client-supplied professionalId, so one user can never fetch another's
 * profile by guessing/passing an id.
 */
export class GetProfessionalByUserIdUseCase {
  constructor(private readonly professionals: ProfessionalRepository) {}

  async execute(userId: string): Promise<ProfessionalRecord | null> {
    return this.professionals.findByUserId(userId);
  }
}
