import { prisma } from "@/infrastructure/database/prisma/client";
import type { JobValueEstimationContextReader } from "@/application/ports/job-value-estimation-context-reader";
import type { JobValueEstimationContext } from "@/domain/services/job-value-estimation";

/**
 * Module 129 — Prisma adapter for the estimation-only context.
 *
 * Explicit select: flow, urgency and the category slugs ONLY. Never add
 * customer, address, contact, free-text or budget columns: the customer's
 * budget is not an estimate of the service value and is deliberately not read.
 */
export class PrismaJobValueEstimationContextReader implements JobValueEstimationContextReader {
  async findByLeadId(leadId: string): Promise<JobValueEstimationContext | null> {
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
    };
  }
}
