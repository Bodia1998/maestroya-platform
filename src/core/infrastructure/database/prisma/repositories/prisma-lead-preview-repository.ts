import { prisma } from "@/infrastructure/database/prisma/client";
import type { LeadPreviewCandidate, LeadPreviewRepository } from "@/domain/repositories/lead-preview-repository";
import { LEAD_FLOW_VERSION } from "@/domain/services/lead";

/**
 * Module 124 — Prisma implementation of the Lead Marketplace read path.
 *
 * Explicit select ONLY. Never add the street address, postal code,
 * customer/user contact columns or `purchases` here: preview is not contact
 * access (Module 122's GetLeadContactUseCase is the only contact path).
 * `address` is selected for city/province/coordinates only; `customer` for
 * `userId` only (own-request exclusion).
 */
const SELECT = {
  id: true,
  createdAt: true,
  serviceRequest: {
    select: {
      title: true,
      description: true,
      categoryId: true,
      urgency: true,
      category: { select: { name: true } },
      address: { select: { city: true, province: true, latitude: true, longitude: true } },
      customer: { select: { userId: true } },
    },
  },
} as const;

type Row = {
  id: string;
  createdAt: Date;
  serviceRequest: {
    title: string;
    description: string;
    categoryId: string;
    urgency: string;
    category: { name: string };
    address: { city: string; province: string | null; latitude: number | null; longitude: number | null };
    customer: { userId: string };
  };
};

function toCandidate(row: Row): LeadPreviewCandidate {
  const request = row.serviceRequest;
  return {
    leadId: row.id,
    title: request.title,
    description: request.description,
    categoryId: request.categoryId,
    categoryName: request.category.name,
    urgency: request.urgency as LeadPreviewCandidate["urgency"],
    city: request.address.city,
    province: request.address.province,
    latitude: request.address.latitude,
    longitude: request.address.longitude,
    customerUserId: request.customer.userId,
    createdAt: row.createdAt,
  };
}

/** Visibility rule shared by both reads: PUBLISHED lead on an open,
 *  non-deleted LEAD_V1 request. DRAFT/CLOSED/EXPIRED/CANCELLED never match. */
const VISIBLE = {
  status: "PUBLISHED",
  serviceRequest: { flowVersion: LEAD_FLOW_VERSION, status: "PUBLISHED", deletedAt: null },
} as const;

export class PrismaLeadPreviewRepository implements LeadPreviewRepository {
  async findPublishedById(leadId: string): Promise<LeadPreviewCandidate | null> {
    const row = await prisma.lead.findFirst({ where: { id: leadId, ...VISIBLE }, select: SELECT });
    return row ? toCandidate(row) : null;
  }

  async findPublishedByCategoryIds(categoryIds: string[]): Promise<LeadPreviewCandidate[]> {
    if (categoryIds.length === 0) return [];
    const rows = await prisma.lead.findMany({
      where: {
        status: VISIBLE.status,
        serviceRequest: { ...VISIBLE.serviceRequest, categoryId: { in: categoryIds } },
      },
      select: SELECT,
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toCandidate);
  }
}
