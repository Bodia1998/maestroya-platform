import { prisma } from "@/infrastructure/database/prisma/client";
import type {
  LeadContactAuthorizationReader,
  LeadContactReader,
  LeadContactRecord,
} from "@/application/ports/lead-contact-access";
import type { LeadContactAuthorizationFacts } from "@/domain/services/lead-contact-access-policy";
import { LEAD_FLOW_VERSION } from "@/domain/services/lead";
import { toLeadContactGrantState, type LeadPurchaseStatus } from "@/domain/services/lead-purchase";

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
            customer: { select: { userId: true, deletedAt: true } },
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
      }
    }

    return {
      leadExists: true,
      flowVersion: request.flowVersion,
      grant,
      blocked: request.deletedAt !== null || request.customer.deletedAt !== null,
      contactOwnershipConsistent: request.address.userId === request.customer.userId,
    };
  }
}

export class PrismaLeadContactReader implements LeadContactReader {
  async readContact(leadId: string): Promise<LeadContactRecord | null> {
    const lead = await prisma.lead.findFirst({
      where: { id: leadId, serviceRequest: { flowVersion: LEAD_FLOW_VERSION, deletedAt: null } },
      select: {
        serviceRequest: {
          select: {
            customer: { select: { userId: true, deletedAt: true, user: { select: { name: true, email: true, phone: true } } } },
            address: { select: { userId: true, line1: true, line2: true, postalCode: true, city: true, province: true } },
          },
        },
      },
    });
    if (!lead) return null;

    const { customer, address } = lead.serviceRequest;
    // Defense in depth: the address must belong to the request's own customer.
    if (customer.deletedAt !== null || address.userId !== customer.userId) return null;

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
