import { z } from "zod";

import {
  MAX_REVIEW_REASON_LENGTH,
  MIN_REVIEW_REASON_LENGTH,
  PROFESSIONAL_VERIFICATION_STATUS_VALUES,
  VERIFICATION_DOCUMENT_TYPE_VALUES,
} from "@/domain/services/professional-verification-rules";

/**
 * Professional Verification module (Module 17). Same convention as
 * admin.dto.ts / portfolio.dto.ts: one schema shared by the client-facing
 * Server Action boundary and the composed use case it calls.
 *
 * Deliberately absent from every professional-facing schema here:
 * `professionalProfileId` / any owner id — ownership is always derived
 * server-side from the authenticated session (see the use cases), never
 * accepted as client input. On admin schemas, `verificationId` identifies
 * which case the action *targets*, never a claim of privilege over it (the
 * ADMIN/SUPER_ADMIN check is done independently via `requireRole()`).
 */

export const ALLOWED_VERIFICATION_DOCUMENT_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;
export const MAX_VERIFICATION_DOCUMENT_BYTES = 10 * 1024 * 1024; // 10MB

const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const documentTypeSchema = z.enum(VERIFICATION_DOCUMENT_TYPE_VALUES);
export type DocumentTypeInput = z.infer<typeof documentTypeSchema>;

export const uploadVerificationDocumentSchema = z.object({
  type: documentTypeSchema,
});
export type UploadVerificationDocumentInput = z.infer<typeof uploadVerificationDocumentSchema>;

export const verificationDocumentIdSchema = z.object({
  documentId: z.string().uuid("Invalid document."),
});
export type VerificationDocumentIdInput = z.infer<typeof verificationDocumentIdSchema>;

// --- Admin schemas ---

export const listAdminVerificationsSchema = paginationSchema.extend({
  status: z.enum(PROFESSIONAL_VERIFICATION_STATUS_VALUES).optional(),
});
export type ListAdminVerificationsInput = z.infer<typeof listAdminVerificationsSchema>;

export const adminVerificationIdSchema = z.object({
  verificationId: z.string().uuid("Invalid verification."),
});
export type AdminVerificationIdInput = z.infer<typeof adminVerificationIdSchema>;

const reviewReasonSchema = z
  .string()
  .trim()
  .min(MIN_REVIEW_REASON_LENGTH, `Reason must be at least ${MIN_REVIEW_REASON_LENGTH} characters.`)
  .max(MAX_REVIEW_REASON_LENGTH, `Reason must be ${MAX_REVIEW_REASON_LENGTH} characters or fewer.`);

export const rejectVerificationSchema = z.object({
  verificationId: z.string().uuid("Invalid verification."),
  reason: reviewReasonSchema,
});
export type RejectVerificationInput = z.infer<typeof rejectVerificationSchema>;

export const requestVerificationResubmissionSchema = z.object({
  verificationId: z.string().uuid("Invalid verification."),
  reason: reviewReasonSchema,
});
export type RequestVerificationResubmissionInput = z.infer<typeof requestVerificationResubmissionSchema>;

// --- Module 59 — Professional Verification (Persona) ---

/**
 * No client-supplied identity fields on purpose: `fullName`/`countryCode`
 * (`StartVerificationRequest` on the `VerificationProvider` port) must
 * always be resolved server-side — `fullName` from the authenticated
 * session's own `User.name`, never a value the professional could type
 * into a form and have sent on to the KYC provider as-is, which would
 * defeat the point of an identity check. This schema exists only to
 * validate the one field a caller may legitimately choose: which country's
 * document format they intend to present (`ES` for DNI/NIE, any other
 * ISO 3166-1 alpha-2 for a foreign passport).
 */
export const startProviderVerificationSchema = z.object({
  countryCode: z
    .string()
    .trim()
    .length(2, "Country code must be a 2-letter ISO 3166-1 code.")
    .toUpperCase()
    .default("ES"),
});
export type StartProviderVerificationInput = z.infer<typeof startProviderVerificationSchema>;
