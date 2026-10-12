import { NotFoundError } from "@/domain/errors/domain-error";
import type { CustomerProfileRepository } from "@/domain/repositories/customer-profile-repository";
import type { LeadRecord, LeadRepository } from "@/domain/repositories/lead-repository";
import type { ServiceRequestRecord, ServiceRequestRepository } from "@/domain/repositories/service-request-repository";
import { LEAD_FLOW_VERSION } from "@/domain/services/lead";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface OwnedLead {
  lead: LeadRecord;
  request: ServiceRequestRecord;
}

/**
 * Module 158 — resolves a LEAD_V1 lead the SESSION user owns, or fails with ONE uniform NotFoundError (malformed id, missing lead,
 * someone else's lead, or a non-LEAD_V1 request are indistinguishable to the caller: no cross-user existence oracle).
 * `userId` must come from the server-side session.
 */
export async function resolveOwnedLead(
  deps: { leads: LeadRepository; serviceRequests: ServiceRequestRepository; customerProfiles: CustomerProfileRepository },
  userId: string,
  leadId: string,
): Promise<OwnedLead> {
  const notFound = () => new NotFoundError("Lead", "requested");
  if (typeof userId !== "string" || userId === "" || typeof leadId !== "string" || !UUID.test(leadId)) throw notFound();

  const lead = await deps.leads.findById(leadId);
  if (!lead || lead.flowVersion !== LEAD_FLOW_VERSION) throw notFound();
  const request = await deps.serviceRequests.findById(lead.serviceRequestId);
  if (!request) throw notFound();
  const customer = await deps.customerProfiles.findByUserId(userId);
  if (!customer || customer.id !== request.customerId) throw notFound();
  return { lead, request };
}
