import { prisma } from "@/infrastructure/database/prisma/client";
import type { LeadPricingRegionReader } from "@/application/ports/lead-pricing-region-reader";
import { deriveLeadPricingRegion, type LeadPricingRegion } from "@/domain/services/spain-pricing-territory";

/**
 * Module 164 — Prisma adapter for WHERE a Lead's request is, as a two-digit province code only.
 *
 * Explicit select of the request address's `country` and `postalCode` ONLY — never the street, the city, free-text province,
 * coordinates, the customer or contact data. The postal code is consumed here and only the derived province code (or the fact
 * that no region could be resolved) leaves this class. Read-only.
 */
export class PrismaLeadPricingRegionReader implements LeadPricingRegionReader {
  async findByLeadId(leadId: string): Promise<LeadPricingRegion | null> {
    const row = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { serviceRequest: { select: { address: { select: { country: true, postalCode: true } } } } },
    });
    if (!row) return null;
    return deriveLeadPricingRegion(row.serviceRequest.address);
  }
}
