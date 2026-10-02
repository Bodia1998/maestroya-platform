import type { RequestUrgencyValue } from "@/domain/repositories/service-request-repository";
import type { LeadContactRecord } from "@/application/ports/lead-contact-access";

/**
 * Module 122 — the DTO boundary between what a professional may see before
 * paying for a lead (LeadPreviewDTO) and the private contact data released
 * only after server-side authorization (LeadContactDTO).
 *
 * Both mappers build their output from an explicit field whitelist, so an
 * over-fetched source object (e.g. a Prisma row that accidentally carried a
 * `customer` relation) can never leak through spreading or serialization.
 */

/** Keys that must never appear — at any nesting depth — in a preview or in
 *  any response served to a caller without contact authorization. */
export const PRIVATE_CONTACT_FIELD_NAMES = [
  "email",
  "contactEmail",
  "phone",
  "contactPhone",
  "whatsapp",
  "telegram",
  "messengerId",
  "customer",
  "customerId",
  "customerUserId",
  "userId",
  "customerName",
  "customerDisplayName",
  "addressLine1",
  "addressLine2",
  "line1",
  "line2",
  "postalCode",
  "address",
  "latitude",
  "longitude",
  "passwordHash",
] as const;

export interface LeadPreviewSource {
  leadId: string;
  title: string;
  description: string;
  categoryId: string;
  categoryName: string;
  urgency: RequestUrgencyValue;
  city: string;
  province: string | null;
  distanceKm?: number | null;
  createdAt: Date;
}

/** Safe fields only — same coarse-location level the legacy professional
 *  feed already exposes (city/province, never street or coordinates). */
export interface LeadPreviewDTO {
  leadId: string;
  title: string;
  description: string;
  categoryId: string;
  categoryName: string;
  urgency: RequestUrgencyValue;
  city: string;
  province: string | null;
  distanceKm: number | null;
  createdAt: Date;
}

export function toLeadPreviewDto(source: LeadPreviewSource): LeadPreviewDTO {
  return {
    leadId: source.leadId,
    title: source.title,
    description: source.description,
    categoryId: source.categoryId,
    categoryName: source.categoryName,
    urgency: source.urgency,
    city: source.city,
    province: source.province,
    distanceKm: source.distanceKm ?? null,
    createdAt: source.createdAt,
  };
}

/** Private contact. Exact street address is included (needed to do the
 *  job); raw coordinates are deliberately not. */
export interface LeadContactDTO {
  leadId: string;
  customerDisplayName: string | null;
  email: string | null;
  phone: string | null;
  address: {
    line1: string;
    line2: string | null;
    postalCode: string;
    city: string;
    province: string | null;
  };
}

export function toLeadContactDto(leadId: string, record: LeadContactRecord): LeadContactDTO {
  return {
    leadId,
    customerDisplayName: record.customerDisplayName,
    email: record.email,
    phone: record.phone,
    address: {
      line1: record.addressLine1,
      line2: record.addressLine2,
      postalCode: record.postalCode,
      city: record.city,
      province: record.province,
    },
  };
}
