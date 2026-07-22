import { NotFoundError } from "@/domain/errors/domain-error";
import type {
  ProfessionalDiscoveryRepository,
  ProfessionalPublicProfileRecord,
} from "@/domain/repositories/professional-discovery-repository";

/**
 * Fetches the safe, public-facing view of a professional's profile for a
 * customer browsing search results. Deliberately a plain lookup by id with
 * no ownership check (anyone, signed in or not, can view a public
 * professional profile) — unlike GetProfessionalByUserIdUseCase, this
 * never trusts or requires a session.
 *
 * The repository itself is what enforces "only ACTIVE, non-deleted
 * professionals are publicly visible" and "only safe fields are exposed" —
 * this use case just translates "not found" into the standard domain
 * error.
 */
export class GetProfessionalPublicProfileUseCase {
  constructor(private readonly discovery: ProfessionalDiscoveryRepository) {}

  async execute(professionalId: string): Promise<ProfessionalPublicProfileRecord> {
    const profile = await this.discovery.findPublicProfileById(professionalId);
    if (!profile) {
      throw new NotFoundError("ProfessionalProfile", professionalId);
    }
    return profile;
  }
}
