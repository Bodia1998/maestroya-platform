import type { LeadPurchaseCheckoutDTO } from "@/application/dto/lead-purchase-checkout.dto";
import { toLeadPurchaseCheckoutDto } from "@/application/dto/lead-purchase-checkout.dto";
import type { LeadPurchaseLatestReader } from "@/domain/repositories/lead-purchase-repository";
import type { LeadRepository } from "@/domain/repositories/lead-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import { LEAD_FLOW_VERSION } from "@/domain/services/lead";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Module 144 — read-only: the authoritative state of the CALLER's own purchase of a lead, for
 * the checkout page (initial render, reload recovery, and bounded status polling while the
 * Module 141 webhook confirms the payment).
 *
 * It is a pure read of the persisted `LeadPurchase`. It never creates, transitions, pays or
 * confirms anything and it NEVER reads or returns customer contact data (that stays behind
 * Module 138's `GetLeadContactUseCase`, which re-checks CONFIRMED itself).
 *
 * Trust boundary: `userId` is the server-session user; the professional profile is resolved
 * from it and is the lookup filter, so another professional's purchase of the same lead can
 * never be returned. `leadId` is only a lookup key.
 *
 * Every "nothing to show" outcome (malformed id, not an active professional, no purchase, a
 * purchase of someone else, a legacy / missing lead) is the same `null`: no existence or
 * ownership probing.
 */
export class GetLeadPurchaseCheckoutUseCase {
  constructor(
    private readonly professionals: ProfessionalRepository,
    private readonly leads: LeadRepository,
    private readonly purchases: LeadPurchaseLatestReader,
  ) {}

  async execute(userId: string, leadId: string): Promise<LeadPurchaseCheckoutDTO | null> {
    if (typeof userId !== "string" || userId === "" || typeof leadId !== "string" || !UUID.test(leadId)) return null;

    const professional = await this.professionals.findByUserId(userId);
    if (!professional || professional.status !== "ACTIVE") return null;

    const purchase = await this.purchases.findLatestByLeadAndProfessional(leadId, professional.id);
    if (!purchase || purchase.professionalProfileId !== professional.id || purchase.leadId !== leadId) return null;

    const lead = await this.leads.findById(purchase.leadId);
    if (!lead || lead.flowVersion !== LEAD_FLOW_VERSION) return null;

    return toLeadPurchaseCheckoutDto(purchase);
  }
}
