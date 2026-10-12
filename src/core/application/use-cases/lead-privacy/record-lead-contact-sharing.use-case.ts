import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { CustomerProfileRepository } from "@/domain/repositories/customer-profile-repository";
import type { LeadContactSharingRepository } from "@/domain/repositories/lead-privacy-repository";
import type { LeadRepository } from "@/domain/repositories/lead-repository";
import type { ServiceRequestRepository } from "@/domain/repositories/service-request-repository";
import { NotFoundError } from "@/domain/errors/domain-error";
import { isTerminalLeadStatus } from "@/domain/services/lead";
import {
  LEAD_CONTACT_SHARING_PURPOSE,
  LeadPrivacyPolicyNotConfiguredError,
  isValidNoticeVersion,
  type LeadContactSharingBasis,
  type LeadPrivacyPolicy,
} from "@/domain/services/lead-privacy";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";
import { resolveOwnedLead } from "@/application/use-cases/lead-privacy/resolve-owned-lead";

export interface RecordLeadContactSharingResult {
  /** `false` for an idempotent repeat: the original evidence stands, nothing was rewritten. */
  created: boolean;
  basis: LeadContactSharingBasis;
  noticeVersion: string;
}

/**
 * Module 158 — records the customer's contact-sharing choice for ONE of their own leads (purpose LEAD_CONTACT_SHARING).
 *
 * The basis and notice version come from the server-side POLICY, never from the client: a caller cannot claim "consent" under a
 * policy that relies on another basis, nor pick the notice text version. With no policy configured (D19 undecided) the use case
 * refuses (`LeadPrivacyPolicyNotConfiguredError`) instead of inventing a basis. One record per lead, never rewritten: a repeated
 * call keeps the original evidence, and a withdrawn consent is NOT revived by calling this again (a new choice needs a new request).
 *
 * Evidence = lead id, user id, basis, notice version, timestamp. No IP, no user agent, no contact data (data minimization).
 * Only a CONSENT record is audited (`GDPR_CONSENT_GRANTED`, ids + version, no personal data); a notice-only record is itself an
 * immutable, timestamped row and needs no second trail.
 */
export class RecordLeadContactSharingUseCase {
  constructor(
    private readonly deps: {
      leads: LeadRepository;
      serviceRequests: ServiceRequestRepository;
      customerProfiles: CustomerProfileRepository;
      sharing: LeadContactSharingRepository;
      auditLog: AdminAuditLogRepository;
    },
    private readonly policy: LeadPrivacyPolicy,
    private readonly failureReporter: FailureReporter = new NullFailureReporter(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(userId: string, leadId: string): Promise<RecordLeadContactSharingResult> {
    const { contactSharingBasis: basis, noticeVersion } = this.policy;
    if (basis === null || noticeVersion === null || !isValidNoticeVersion(noticeVersion)) {
      throw new LeadPrivacyPolicyNotConfiguredError();
    }

    const { lead } = await resolveOwnedLead(this.deps, userId, leadId);
    // A choice is only recorded for a lead that can still be offered; a terminal lead is not shared any more.
    if (isTerminalLeadStatus(lead.status)) throw new NotFoundError("Lead", "requested");

    const { record, created } = await this.deps.sharing.record({
      leadId: lead.id,
      userId,
      basis,
      noticeVersion,
      recordedAt: this.now(),
    });

    if (created && record.basis === "CONSENT") {
      try {
        await this.deps.auditLog.record({
          adminUserId: userId,
          action: "GDPR_CONSENT_GRANTED",
          targetType: "Lead",
          targetId: lead.id,
          metadata: { purpose: LEAD_CONTACT_SHARING_PURPOSE, basis: record.basis, noticeVersion: record.noticeVersion },
        });
      } catch (error) {
        // The evidence row is already durable; an audit-trail failure is surfaced to operators, never to the customer.
        this.failureReporter.report(error, { operation: "lead_contact_sharing_audit", leadId: lead.id });
      }
    }

    return { created, basis: record.basis, noticeVersion: record.noticeVersion };
  }
}
