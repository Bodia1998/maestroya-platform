import { prisma } from "@/infrastructure/database/prisma/client";
import type { LeadPricingContextReader } from "@/application/ports/lead-pricing-context-reader";
import type { LeadPricingContext } from "@/domain/services/lead-pricing";

/**
 * Module 128 — Prisma adapter for the pricing-only context.
 *
 * Explicit select: flow, urgency and the category slugs ONLY. Never add
 * customer, address, contact or budget columns. `budgetMin/budgetMax` are the
 * CUSTOMER's budget, not an estimate of the service value, and are
 * deliberately not read.
 *
 * `estimatedServiceValue` is always null: no job-value estimate exists in the
 * schema yet (the future Job Pricing module). Until one does, every Lead is
 * UNPRICED and cannot be purchased — fail closed, never a guessed value.
 */
export class PrismaLeadPricingContextReader implements LeadPricingContextReader {
  async findByLeadId(leadId: string): Promise<LeadPricingContext | null> {
    const row = await prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        serviceRequest: {
          select: {
            flowVersion: true,
            urgency: true,
            category: { select: { slug: true, parent: { select: { slug: true } } } },
          },
        },
      },
    });
    if (!row) return null;
    const request = row.serviceRequest;
    return {
      flowVersion: request.flowVersion,
      categorySlug: request.category.slug,
      parentCategorySlug: request.category.parent?.slug ?? null,
      urgency: request.urgency,
      estimatedServiceValue: null,
    };
  }
}
