import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { CustomerProfileRepository } from "@/domain/repositories/customer-profile-repository";
import type { LeadContactSharingRepository } from "@/domain/repositories/lead-privacy-repository";
import type { LeadRepository } from "@/domain/repositories/lead-repository";
import type { ServiceRequestRepository } from "@/domain/repositories/service-request-repository";
import { isTerminalLeadStatus } from "@/domain/services/lead";
import {
  LEAD_CONTACT_SHARING_PURPOSE,
  LeadContactSharingNotApplicableError,
  LeadContactSharingRecordNotFoundError,
  canWithdrawContactSharing,
} from "@/domain/services/lead-privacy";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";
import { resolveOwnedLead } from "@/application/use-cases/lead-privacy/resolve-owned-lead";

export interface WithdrawLeadContactSharingResult {
  /** `false` for an idempotent repeat. */
  changed: boolean;
  /** The lead is no longer on offer (cancelled by this call or already terminal). */
  leadOffMarket: boolean;
}

/**
 * Module 158 — the customer withdraws their CONSENT to share this lead's contact data. Effective for FUTURE processing:
 *
 *   1. the record is stamped withdrawn (write-once) — from that instant the contact-access path denies every buyer, including a
 *      professional whose purchase is already CONFIRMED (the grant is derived, never stored; see PrismaLeadContactAuthorizationReader);
 *   2. the request is cancelled through the existing central status write, which cancels the lead in the same transaction, so nobody
 *      new can buy it.
 *
 * Both steps are idempotent, so a retry after a crash between them completes the withdrawal. Contact data a professional already
 * received cannot be recalled by this system, and the fee consequences for an already CONFIRMED purchase (refund / credit) are a
 * separate decision (M153 / roadmap D12) that this use case deliberately does NOT take.
 *
 * Only a record whose basis is CONSENT can be withdrawn: a notice under another lawful basis is not a consent
 * (`LeadContactSharingNotApplicableError`) — the customer's remedy there is the erasure / objection route, not this one.
 * Audit: `GDPR_CONSENT_WITHDRAWN` with ids + purpose + version only.
 */
export class WithdrawLeadContactSharingUseCase {
  constructor(
    private readonly deps: {
      leads: LeadRepository;
      serviceRequests: ServiceRequestRepository;
      customerProfiles: CustomerProfileRepository;
      sharing: LeadContactSharingRepository;
      auditLog: AdminAuditLogRepository;
    },
    private readonly failureReporter: FailureReporter = new NullFailureReporter(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(userId: string, leadId: string): Promise<WithdrawLeadContactSharingResult> {
    const { lead, request } = await resolveOwnedLead(this.deps, userId, leadId);

    const existing = await this.deps.sharing.findByLeadId(lead.id);
    if (!existing) throw new LeadContactSharingRecordNotFoundError();
    if (!canWithdrawContactSharing(existing)) throw new LeadContactSharingNotApplicableError();

    const { record, changed } = await this.deps.sharing.withdraw(lead.id, this.now());

    // Re-read: the lead may have moved on since resolveOwnedLead (concurrent expiry / cancel).
    const current = (await this.deps.leads.findById(lead.id)) ?? lead;
    let leadOffMarket = isTerminalLeadStatus(current.status);
    if (!leadOffMarket) {
      await this.deps.serviceRequests.updateStatus(request.id, "CANCELLED");
      leadOffMarket = true;
    }

    if (changed && record) {
      try {
        await this.deps.auditLog.record({
          adminUserId: userId,
          action: "GDPR_CONSENT_WITHDRAWN",
          targetType: "Lead",
          targetId: lead.id,
          metadata: { purpose: LEAD_CONTACT_SHARING_PURPOSE, basis: record.basis, noticeVersion: record.noticeVersion },
        });
      } catch (error) {
        this.failureReporter.report(error, { operation: "lead_contact_sharing_audit", leadId: lead.id });
      }
    }

    return { changed, leadOffMarket };
  }
}
