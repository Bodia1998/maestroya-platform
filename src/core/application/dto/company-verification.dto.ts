import { z } from "zod";

import {
  MAX_REVIEW_REASON_LENGTH,
  MIN_REVIEW_REASON_LENGTH,
  VERIFICATION_CASE_STATUS_VALUES,
  COMPANY_VERIFICATION_DOCUMENT_TYPE_VALUES,
} from "@/domain/services/company-verification-rules";

/**
 * Module 18 — Company Professional: Zod schemas for company verification —
 * mirrors verification.dto.ts (Module 17) exactly. Deliberately absent from
 * every company-facing schema: `companyProfileId` — always derived
 * server-side from the caller's own (OWNER/ADMIN) membership.
 */

export const ALLOWED_COMPANY_VERIFICATION_DOCUMENT_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;
export const MAX_COMPANY_VERIFICATION_DOCUMENT_BYTES = 10 * 1024 * 1024; // 10MB

const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const companyDocumentTypeSchema = z.enum(COMPANY_VERIFICATION_DOCUMENT_TYPE_VALUES);
export type CompanyDocumentTypeInput = z.infer<typeof companyDocumentTypeSchema>;

export const uploadCompanyVerificationDocumentSchema = z.object({
  type: companyDocumentTypeSchema,
});
export type UploadCompanyVerificationDocumentInput = z.infer<typeof uploadCompanyVerificationDocumentSchema>;

export const companyVerificationDocumentIdSchema = z.object({
  documentId: z.string().uuid("Invalid document."),
});
export type CompanyVerificationDocumentIdInput = z.infer<typeof companyVerificationDocumentIdSchema>;

// --- Admin schemas ---

export const listAdminCompanyVerificationsSchema = paginationSchema.extend({
  status: z.enum(VERIFICATION_CASE_STATUS_VALUES).optional(),
});
export type ListAdminCompanyVerificationsInput = z.infer<typeof listAdminCompanyVerificationsSchema>;

export const adminCompanyVerificationIdSchema = z.object({
  verificationId: z.string().uuid("Invalid verification."),
});
export type AdminCompanyVerificationIdInput = z.infer<typeof adminCompanyVerificationIdSchema>;

const reviewReasonSchema = z
  .string()
  .trim()
  .min(MIN_REVIEW_REASON_LENGTH, `Reason must be at least ${MIN_REVIEW_REASON_LENGTH} characters.`)
  .max(MAX_REVIEW_REASON_LENGTH, `Reason must be ${MAX_REVIEW_REASON_LENGTH} characters or fewer.`);

export const rejectCompanyVerificationSchema = z.object({
  verificationId: z.string().uuid("Invalid verification."),
  reason: reviewReasonSchema,
});
export type RejectCompanyVerificationInput = z.infer<typeof rejectCompanyVerificationSchema>;

export const requestCompanyVerificationResubmissionSchema = z.object({
  verificationId: z.string().uuid("Invalid verification."),
  reason: reviewReasonSchema,
});
export type RequestCompanyVerificationResubmissionInput = z.infer<
  typeof requestCompanyVerificationResubmissionSchema
>;
