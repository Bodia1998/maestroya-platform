import { z } from "zod";

import {
  BILLING_ENTITY_TYPES,
  BILLING_FIELD_LIMITS,
  BILLING_IDENTITY_REJECTION_REASONS,
  isCountryCode,
  isPlausiblePostalCode,
  isPlausibleTaxId,
  maskTaxId,
  normalizeCountryCode,
  normalizePostalCode,
  normalizeTaxId,
  normalizeText,
  type BillingEntityType,
  type BillingIdentityRejectionReason,
  type BillingIdentityState,
} from "@/domain/services/professional-billing-identity";
import type { ProfessionalBillingIdentityRecord } from "@/domain/repositories/professional-billing-identity-repository";
import { evaluateBillingIdentityReadiness } from "@/domain/services/professional-billing-identity";

/**
 * Module 146 — DTOs for the professional billing identity.
 *
 * Deliberately absent from the input schema: `verificationStatus`, any
 * verification/review timestamp or reviewer, `revision`, and any
 * professional/user/profile id. Zod strips unknown keys, so a client that sends
 * them gets them silently dropped; the target professional is always resolved
 * from the server-side session. Messages are validation keys, not prose
 * (docs/MODULE_120_LOCALIZATION_CONVENTIONS.md §4).
 */

const text = (max: number) =>
  z
    .string({ required_error: "required", invalid_type_error: "invalid" })
    .transform(normalizeText)
    .refine((value) => value.length > 0, "required")
    .refine((value) => value.length <= max, "invalid");

const optionalText = (max: number) =>
  z
    .string({ invalid_type_error: "invalid" })
    .nullish()
    .transform((value) => normalizeText(value ?? ""))
    .refine((value) => value.length <= max, "invalid")
    .transform((value) => (value === "" ? null : value));

const country = (message: string) =>
  z
    .string({ required_error: "required", invalid_type_error: "invalid" })
    .transform(normalizeCountryCode)
    .refine((value) => value.length > 0, "required")
    .refine(isCountryCode, message);

export const saveBillingIdentitySchema = z.object({
  entityType: z.enum(BILLING_ENTITY_TYPES, { errorMap: () => ({ message: "required" }) }),
  legalName: text(BILLING_FIELD_LIMITS.legalName),
  taxId: z
    .string({ required_error: "required", invalid_type_error: "invalid" })
    .transform(normalizeTaxId)
    .refine((value) => value.length > 0, "required")
    .refine(isPlausibleTaxId, "dto.billingIdentity.taxId"),
  taxCountry: country("dto.billingIdentity.country"),
  addressLine1: text(BILLING_FIELD_LIMITS.addressLine),
  addressLine2: optionalText(BILLING_FIELD_LIMITS.addressLine),
  city: text(BILLING_FIELD_LIMITS.city),
  region: optionalText(BILLING_FIELD_LIMITS.region),
  postalCode: z
    .string({ required_error: "required", invalid_type_error: "invalid" })
    .transform(normalizePostalCode)
    .refine((value) => value.length > 0, "required")
    .refine(isPlausiblePostalCode, "invalid"),
  country: country("dto.billingIdentity.country"),
});
export type SaveBillingIdentityInput = z.infer<typeof saveBillingIdentitySchema>;

const identityIdSchema = z.string().uuid("invalid");
const revisionSchema = z.number({ invalid_type_error: "invalid", required_error: "required" }).int("invalid").min(1, "invalid");

export const verifyBillingIdentitySchema = z.object({
  identityId: identityIdSchema,
  expectedRevision: revisionSchema,
});
export type VerifyBillingIdentityInput = z.infer<typeof verifyBillingIdentitySchema>;

export const rejectBillingIdentitySchema = z.object({
  identityId: identityIdSchema,
  expectedRevision: revisionSchema,
  reason: z.enum(BILLING_IDENTITY_REJECTION_REASONS, { errorMap: () => ({ message: "required" }) }),
  note: z
    .string({ invalid_type_error: "invalid" })
    .nullish()
    .transform((value) => normalizeText(value ?? ""))
    .refine((value) => value.length <= 1000, "invalid")
    .transform((value) => (value === "" ? null : value)),
});
export type RejectBillingIdentityInput = z.infer<typeof rejectBillingIdentitySchema>;

export const listPendingBillingIdentitiesSchema = z.object({
  limit: z.number().int("invalid").min(1, "invalid").max(100, "invalid").default(25),
  offset: z.number().int("invalid").min(0, "invalid").default(0),
});

export interface BillingIdentityDetailsView {
  entityType: BillingEntityType;
  legalName: string;
  taxId: string;
  taxCountry: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  region: string | null;
  postalCode: string;
  country: string;
}

/**
 * What the OWNING professional sees. No ids, no revision, no reviewer, no review
 * note, no review timestamps other than when it became verified. Dates are ISO
 * strings so the DTO crosses the server/client boundary unchanged.
 */
export interface ProfessionalBillingIdentityView {
  state: BillingIdentityState;
  details: BillingIdentityDetailsView | null;
  /** Closed reason code only (never the free-text admin note). */
  rejectionReason: BillingIdentityRejectionReason | null;
  verifiedAt: string | null;
}

export const EMPTY_BILLING_IDENTITY_VIEW: ProfessionalBillingIdentityView = Object.freeze({
  state: "MISSING",
  details: null,
  rejectionReason: null,
  verifiedAt: null,
});

function detailsView(record: ProfessionalBillingIdentityRecord): BillingIdentityDetailsView {
  return {
    entityType: record.entityType,
    legalName: record.legalName,
    taxId: record.taxId,
    taxCountry: record.taxCountry,
    addressLine1: record.addressLine1,
    addressLine2: record.addressLine2,
    city: record.city,
    region: record.region,
    postalCode: record.postalCode,
    country: record.country,
  };
}

export function toProfessionalBillingIdentityView(record: ProfessionalBillingIdentityRecord | null): ProfessionalBillingIdentityView {
  if (!record) return EMPTY_BILLING_IDENTITY_VIEW;
  const readiness = evaluateBillingIdentityReadiness(record);
  return {
    state: readiness.state,
    details: detailsView(record),
    rejectionReason: readiness.state === "NEEDS_CORRECTION" ? record.rejectionReason : null,
    verifiedAt: readiness.isVerified && record.verifiedAt ? record.verifiedAt.toISOString() : null,
  };
}

/** Administrator review view: the exact content a decision is bound to (`revision`). */
export interface AdminBillingIdentityView extends ProfessionalBillingIdentityView {
  id: string;
  professionalProfileId: string;
  revision: number;
  reviewNote: string | null;
  reviewedAt: string | null;
  updatedAt: string;
}

export function toAdminBillingIdentityView(record: ProfessionalBillingIdentityRecord): AdminBillingIdentityView {
  return {
    ...toProfessionalBillingIdentityView(record),
    id: record.id,
    professionalProfileId: record.professionalProfileId,
    revision: record.revision,
    reviewNote: record.reviewNote,
    reviewedAt: record.reviewedAt ? record.reviewedAt.toISOString() : null,
    updatedAt: record.updatedAt.toISOString(),
  };
}

/** Review-queue row: tax id masked, no address. */
export interface AdminBillingIdentityListItem {
  id: string;
  professionalProfileId: string;
  revision: number;
  entityType: BillingEntityType;
  legalName: string;
  taxIdMasked: string;
  taxCountry: string;
  country: string;
  updatedAt: string;
}

export function toAdminBillingIdentityListItem(record: ProfessionalBillingIdentityRecord): AdminBillingIdentityListItem {
  return {
    id: record.id,
    professionalProfileId: record.professionalProfileId,
    revision: record.revision,
    entityType: record.entityType,
    legalName: record.legalName,
    taxIdMasked: maskTaxId(record.taxId),
    taxCountry: record.taxCountry,
    country: record.country,
    updatedAt: record.updatedAt.toISOString(),
  };
}
