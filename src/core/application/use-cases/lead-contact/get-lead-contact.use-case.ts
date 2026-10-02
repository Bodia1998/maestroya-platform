import type { LeadContactDTO } from "@/application/dto/lead-contact.dto";
import { toLeadContactDto } from "@/application/dto/lead-contact.dto";
import type { LeadContactAuthorizationReader, LeadContactReader } from "@/application/ports/lead-contact-access";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { UserRepository } from "@/domain/repositories/user-repository";
import {
  LeadContactAccessDeniedError,
  canProfessionalAccessLeadContact,
  type LeadContactDenialReason,
} from "@/domain/services/lead-contact-access-policy";
import { logger } from "@/infrastructure/observability/logger";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Module 122 — the single application-level path to private lead contact
 * data. Order is the security invariant:
 *
 *   1. validate input            (malformed -> denied)
 *   2. resolve actor             (active user + active professional profile)
 *   3. read authorization facts  (NO customer contact columns)
 *   4. policy decision           (deny by default)
 *   5. ONLY NOW read contact     (explicit-column projection)
 *   6. map through whitelist DTO
 *
 * Every failure throws the identical LeadContactAccessDeniedError; the real
 * reason is logged (ids only, no PII). `userId` must come from the
 * server-side session (requireRole), never from the request.
 *
 * Nothing is wired to this class yet: Lead/LeadPurchase adapters arrive in
 * Module 123, which also adds the composition root and server action.
 */
export class GetLeadContactUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly professionals: ProfessionalRepository,
    private readonly authorization: LeadContactAuthorizationReader,
    private readonly contacts: LeadContactReader,
  ) {}

  async execute(userId: string, leadId: string): Promise<LeadContactDTO> {
    if (typeof userId !== "string" || userId === "" || typeof leadId !== "string" || !UUID.test(leadId)) {
      this.deny("MALFORMED_REQUEST");
    }

    const user = await this.users.findById(userId);
    if (!user || user.status !== "ACTIVE") this.deny("USER_NOT_ACTIVE");

    const professional = await this.professionals.findByUserId(userId);
    if (!professional || professional.status !== "ACTIVE") this.deny("NOT_A_PROFESSIONAL");

    const facts = await this.authorization.findFacts(leadId, professional.id);
    const decision = canProfessionalAccessLeadContact(facts, professional.id);
    if (!decision.allowed) this.deny(decision.reason);

    const record = await this.contacts.readContact(leadId);
    if (!record) this.deny("CONTACT_MISSING");

    return toLeadContactDto(leadId, record);
  }

  private deny(reason: LeadContactDenialReason | "MALFORMED_REQUEST" | "USER_NOT_ACTIVE" | "NOT_A_PROFESSIONAL" | "CONTACT_MISSING"): never {
    logger.warn("lead_contact_access.denied", { reason });
    throw new LeadContactAccessDeniedError();
  }
}
