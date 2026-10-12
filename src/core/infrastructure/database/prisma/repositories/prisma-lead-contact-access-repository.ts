import { prisma } from "@/infrastructure/database/prisma/client";
import type {
  LeadContactAuthorizationReader,
  LeadContactReader,
  LeadContactRecord,
} from "@/application/ports/lead-contact-access";
import type { LeadContactAuthorizationFacts } from "@/domain/services/lead-contact-access-policy";
import { LEAD_FLOW_VERSION } from "@/domain/services/lead";
import { toLeadContactGrantState, type LeadPurchaseStatus } from "@/domain/services/lead-purchase";
import { decideContactSharing, isLeadContactSharingBasis, type LeadContactSharingEvidence, type LeadPrivacyPolicy } from "@/domain/services/lead-privacy";
import { loadLeadPrivacyConfig } from "@/infrastructure/config/lead-privacy-config";

type ContactSharingPolicyProvider = () => Pick<LeadPrivacyPolicy, "contactSharingBasis">;
const defaultPolicyProvider: ContactSharingPolicyProvider = () => loadLeadPrivacyConfig().policy;

/**
 * Module 158 — the recorded contact-sharing choice of a lead as domain evidence (ids / basis / version / times only), or null.
 * Shared by the authorization side and the contact side so both apply the SAME rule (decideContactSharing).
 */
async function readSharingEvidence(leadId: string): Promise<LeadContactSharingEvidence | null> {
  const row = await prisma.leadContactSharingRecord.findUnique({
    where: { leadId },
    select: { basis: true, noticeVersion: true, recordedAt: true, withdrawnAt: true },
  });
  if (!row || !isLeadContactSharingBasis(row.basis)) return null;
  return { basis: row.basis, noticeVersion: row.noticeVersion, recordedAt: row.recordedAt, withdrawnAt: row.withdrawnAt };
}

/**
 * Module 138 — Prisma adapters for Module 122's contact ports.
 *
 * Contact unlock is DERIVED, never stored: the authorization fact is the
 * CURRENT persisted `LeadPurchase.status`, read fresh on every call. There is
 * no "contactUnlocked" column, so a CONFIRMED -> REFUNDED/REVOKED transition
 * removes access immediately and nothing stale can survive it.
 *
 * Two classes, two ports, deliberately separate:
 *  - authorization side: explicit select, NO customer contact column
 *    (customer/address `userId` are selected only to compare them for the
 *    ownership-chain check and never leave this file);
 *  - contact side: explicit-column projection, only ever called by
 *    GetLeadContactUseCase AFTER the policy allowed access.
 */
export class PrismaLeadContactAuthorizationReader implements LeadContactAuthorizationReader {
  constructor(private readonly policyProvider: ContactSharingPolicyProvider = defaultPolicyProvider) {}

  async findFacts(leadId: string, professionalProfileId: string): Promise<LeadContactAuthorizationFacts | null> {
    // Every lookup dimension is in the query itself: lead id, the (session-derived)
    // professional profile id, and the CONFIRMED status. Another professional's
    // purchase can never be returned by this query.
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        id: true,
        serviceRequest: {
          select: {
            flowVersion: true,
            deletedAt: true,
            customer: { select: { userId: true, deletedAt: true, user: { select: { personalDataErasedAt: true } } } },
            address: { select: { userId: true } },
          },
        },
        purchases: {
          where: { professionalProfileId, status: "CONFIRMED" },
          select: { professionalProfileId: true },
          take: 1,
        },
      },
    });
    if (!lead) return null;

    const request = lead.serviceRequest;
    const confirmed = lead.purchases[0];

    let grant: LeadContactAuthorizationFacts["grant"] = null;
    let suspendedByDispute = false;
    if (confirmed) {
      grant = { state: "CONFIRMED", professionalProfileId: confirmed.professionalProfileId };
    } else {
      // Denial path only (diagnostics): the professional's own latest purchase,
      // mapped through the M123 contract. Never CONFIRMED here.
      const latest = await prisma.leadPurchase.findFirst({
        where: { leadId, professionalProfileId },
        orderBy: { createdAt: "desc" },
        select: { professionalProfileId: true, status: true },
      });
      if (latest) {
        grant = {
          state: toLeadContactGrantState(latest.status as LeadPurchaseStatus),
          professionalProfileId: latest.professionalProfileId,
        };
        // Module 155: a purchase with an open chargeback is DISPUTED (never CONFIRMED, so the grant above already denies); it is
        // additionally surfaced as `blocked` so the precise denial reason is "BLOCKED" in the server log (the caller still sees the
        // one uniform error).
        suspendedByDispute = latest.status === "DISPUTED";
      }
    }

    // Module 158: contact becomes unavailable when the customer's personal data was erased, when the recorded consent was withdrawn,
    // or (policy basis CONSENT) when no consent was ever recorded. Same fact, same denial path as the M155 dispute suspension: the
    // buyer's CONFIRMED grant stays untouched in the database and is simply not honoured (derived, never stored).
    const customerErased = request.customer.user.personalDataErasedAt !== null;
    const sharing = decideContactSharing(this.policyProvider(), await readSharingEvidence(leadId));

    return {
      leadExists: true,
      flowVersion: request.flowVersion,
      grant,
      blocked:
        request.deletedAt !== null || request.customer.deletedAt !== null || suspendedByDispute || customerErased || !sharing.allowed,
      contactOwnershipConsistent: request.address.userId === request.customer.userId,
    };
  }
}

export class PrismaLeadContactReader implements LeadContactReader {
  constructor(private readonly policyProvider: ContactSharingPolicyProvider = defaultPolicyProvider) {}

  async readContact(leadId: string): Promise<LeadContactRecord | null> {
    const lead = await prisma.lead.findFirst({
      where: { id: leadId, serviceRequest: { flowVersion: LEAD_FLOW_VERSION, deletedAt: null } },
      select: {
        serviceRequest: {
          select: {
            customer: {
              select: {
                userId: true,
                deletedAt: true,
                user: { select: { name: true, email: true, phone: true, personalDataErasedAt: true } },
              },
            },
            address: { select: { userId: true, line1: true, line2: true, postalCode: true, city: true, province: true } },
          },
        },
      },
    });
    if (!lead) return null;

    const { customer, address } = lead.serviceRequest;
    // Defense in depth: the address must belong to the request's own customer.
    if (customer.deletedAt !== null || address.userId !== customer.userId) return null;

    // Module 158 defense in depth (the authorization side already denied): never read out an erased customer's remnants, nor contact
    // data whose sharing was withdrawn / was never consented to under a CONSENT policy. `null` = "contact unavailable" to the caller.
    if (customer.user.personalDataErasedAt !== null) return null;
    if (!decideContactSharing(this.policyProvider(), await readSharingEvidence(leadId)).allowed) return null;

    return {
      customerDisplayName: customer.user.name,
      email: customer.user.email,
      phone: customer.user.phone,
      addressLine1: address.line1,
      addressLine2: address.line2,
      postalCode: address.postalCode,
      city: address.city,
      province: address.province,
    };
  }
}
