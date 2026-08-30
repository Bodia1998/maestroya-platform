import type { CompanyVerificationStatusChanged } from "@/domain/events/company-verification-status-changed";
import type { EventHandler } from "@/application/ports/event-bus";
import type { CompanyRepository } from "@/domain/repositories/company-repository";
import { canTransitionCompanyStatus } from "@/domain/services/company-rules";

/**
 * Module 83 — Professional Verification Enforcement (H11: "company
 * activation requires an awkward second manual step after verification
 * approval").
 *
 * Before this subscriber, `ApproveCompanyVerificationUseCase` only flipped
 * `CompanyProfile.isVerified` — an admin had to separately remember to
 * call `ReactivateCompanyUseCase` (a confusingly-named action for a
 * company that may never have been ACTIVE in the first place, e.g. a
 * brand-new PENDING company) to actually make the company discoverable.
 * This reacts to the same `CompanyVerificationStatusChanged` event
 * `RecordCompanyVerificationAuditLogSubscriber`/
 * `NotifyCompanyVerificationStatusChangeSubscriber` already react to, and
 * removes that second step entirely: an APPROVED verification
 * auto-activates a PENDING or SUSPENDED company.
 *
 * Deliberately does NOT touch a DEACTIVATED company — that status is the
 * owner's own deliberate choice (see `company-rules.ts`'s own doc comment
 * on why SUSPENDED/DEACTIVATED are kept as separate states), and a
 * verification approval must never silently override it. An already-ACTIVE
 * company is left alone (`canTransitionCompanyStatus` has no ACTIVE ->
 * ACTIVE self-transition, and there is nothing to do in that case anyway).
 *
 * Uses `CompanyRepository.updateStatus` directly rather than
 * `AdminRepository.setCompanyStatus` — this is a system-driven reaction to
 * a domain event, not an admin action, so it has no `adminUserId` and does
 * not belong on the Admin Panel's own repository.
 */
export class ActivateCompanyOnVerificationApprovedSubscriber
  implements EventHandler<CompanyVerificationStatusChanged>
{
  constructor(private readonly companies: CompanyRepository) {}

  async handle(event: CompanyVerificationStatusChanged): Promise<void> {
    if (event.newStatus !== "APPROVED") return;

    const company = await this.companies.findById(event.companyProfileId);
    if (!company) return;

    if (company.status !== "PENDING" && company.status !== "SUSPENDED") return;
    if (!canTransitionCompanyStatus(company.status, "ACTIVE")) return;

    await this.companies.updateStatus(company.id, "ACTIVE", null);
  }
}
