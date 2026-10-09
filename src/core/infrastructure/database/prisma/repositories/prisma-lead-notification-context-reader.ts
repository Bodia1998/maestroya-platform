import { prisma } from "@/infrastructure/database/prisma/client";
import type {
  LeadNotificationContext,
  LeadNotificationContextReader,
  LeadPurchaseNotificationContext,
} from "@/domain/repositories/lead-notification-context-reader";
import { LEAD_FLOW_VERSION } from "@/domain/services/lead";
import type { LeadPurchaseStatus } from "@/domain/services/lead-purchase";

/** The ServiceRequest facts a notification may use: owner, flow, public-granularity city. NEVER title/description/address lines/phone/email. */
const REQUEST_SELECT = {
  select: {
    id: true,
    flowVersion: true,
    address: { select: { city: true } },
    customer: { select: { userId: true } },
  },
} as const;

type RequestRow = {
  id: string;
  flowVersion: string;
  address: { city: string };
  customer: { userId: string };
};

function toContext(leadId: string, request: RequestRow): LeadNotificationContext {
  return {
    leadId,
    serviceRequestId: request.id,
    customerUserId: request.customer.userId,
    city: request.address.city,
  };
}

/**
 * Module 145 — Prisma adapter for `LeadNotificationContextReader`. Read-only.
 *
 * Recipients come exclusively from persisted relations
 * (LeadPurchase -> Lead -> ServiceRequest -> CustomerProfile -> User.id and
 * LeadPurchase -> ProfessionalProfile -> User.id). Both lookups return `null` for any
 * lead whose ServiceRequest is not `LEAD_V1`, so a legacy quote/payment record can never
 * yield a LEAD_V1 notification context.
 */
export class PrismaLeadNotificationContextReader implements LeadNotificationContextReader {
  async findForLead(leadId: string): Promise<(LeadNotificationContext & { leadStatus: string }) | null> {
    const row = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { id: true, status: true, serviceRequest: REQUEST_SELECT },
    });
    if (!row || row.serviceRequest.flowVersion !== LEAD_FLOW_VERSION) return null;
    return { ...toContext(row.id, row.serviceRequest), leadStatus: row.status };
  }

  async findForPurchase(purchaseId: string): Promise<LeadPurchaseNotificationContext | null> {
    const row = await prisma.leadPurchase.findUnique({
      where: { id: purchaseId },
      select: {
        status: true,
        professional: { select: { userId: true } },
        lead: { select: { id: true, serviceRequest: REQUEST_SELECT } },
      },
    });
    if (!row || row.lead.serviceRequest.flowVersion !== LEAD_FLOW_VERSION) return null;
    return {
      ...toContext(row.lead.id, row.lead.serviceRequest),
      professionalUserId: row.professional.userId,
      purchaseStatus: row.status as LeadPurchaseStatus,
    };
  }
}
