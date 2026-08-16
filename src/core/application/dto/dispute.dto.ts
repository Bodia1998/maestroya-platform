import { z } from "zod";

import {
  DEFAULT_PAGE_SIZE,
  MAX_DESCRIPTION_LENGTH,
  MAX_EVIDENCE_DESCRIPTION_LENGTH,
  MAX_MESSAGE_LENGTH,
  MAX_PAGE_SIZE,
  MAX_RESOLUTION_NOTE_LENGTH,
  MAX_TITLE_LENGTH,
  MIN_DESCRIPTION_LENGTH,
  MIN_TITLE_LENGTH,
} from "@/domain/services/dispute-rules";
import { isValidMediaUrl } from "@/domain/services/portfolio-rules";

/**
 * Module 21 — Disputes & Support. Same convention as review.dto.ts/
 * admin.dto.ts: one schema shared by the client-facing Server Action
 * boundary and the composed use case it calls.
 *
 * Deliberately absent from every schema here: `raisedByUserId`,
 * `respondentProfessionalProfileId`/`respondentCompanyProfileId`,
 * `serviceRequestId`, `assignedAdminUserId` (as a claim about the caller),
 * or any authorization signal — every one of those is always derived
 * server-side from the authenticated session + the Job record (see
 * CreateDisputeUseCase). `jobId`/`disputeId` *are* accepted — they identify
 * which resource an action targets, not a claim of ownership over it.
 */

const DISPUTE_REASON_VALUES = [
  "SERVICE_NOT_COMPLETED",
  "SERVICE_QUALITY",
  "PROPERTY_DAMAGE",
  "PROFESSIONAL_NO_SHOW",
  "CUSTOMER_NO_SHOW",
  "PRICE_DISAGREEMENT",
  "SCOPE_OF_WORK",
  "COMMUNICATION_ISSUE",
  "OTHER",
] as const;

const DISPUTE_STATUS_VALUES = [
  "OPEN",
  "UNDER_REVIEW",
  "WAITING_FOR_CUSTOMER",
  "WAITING_FOR_PROFESSIONAL",
  "RESOLVED",
  "REJECTED",
  "CLOSED",
] as const;

const DISPUTE_RESOLUTION_VALUES = [
  "NO_ACTION",
  "CUSTOMER_FAVOR",
  "PROFESSIONAL_FAVOR",
  "PARTIAL_RESOLUTION",
  "FINANCIAL_ADJUSTMENT_REQUIRED",
  "ESCALATED_EXTERNALLY",
] as const;

const DISPUTE_PRIORITY_VALUES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  offset: z.coerce.number().int().min(0).default(0),
});

export const createDisputeSchema = z.object({
  jobId: z.string().uuid("Invalid job."),
  reason: z.enum(DISPUTE_REASON_VALUES),
  title: z
    .string()
    .trim()
    .min(MIN_TITLE_LENGTH, `Title must be at least ${MIN_TITLE_LENGTH} characters.`)
    .max(MAX_TITLE_LENGTH, `Title must be ${MAX_TITLE_LENGTH} characters or fewer.`),
  description: z
    .string()
    .trim()
    .min(MIN_DESCRIPTION_LENGTH, `Description must be at least ${MIN_DESCRIPTION_LENGTH} characters.`)
    .max(MAX_DESCRIPTION_LENGTH, `Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer.`),
});
export type CreateDisputeInput = z.infer<typeof createDisputeSchema>;

export const getDisputeSchema = z.object({ disputeId: z.string().uuid("Invalid dispute.") });
export type GetDisputeInput = z.infer<typeof getDisputeSchema>;

export const listMyDisputesSchema = paginationSchema.extend({
  status: z.enum(DISPUTE_STATUS_VALUES).optional(),
});
export type ListMyDisputesInput = z.infer<typeof listMyDisputesSchema>;

export const listAdminDisputesSchema = paginationSchema.extend({
  status: z.enum(DISPUTE_STATUS_VALUES).optional(),
  priority: z.enum(DISPUTE_PRIORITY_VALUES).optional(),
  reason: z.enum(DISPUTE_REASON_VALUES).optional(),
  assignedAdminUserId: z.string().uuid().optional(),
  search: z.string().trim().max(100).optional(),
});
export type ListAdminDisputesInput = z.infer<typeof listAdminDisputesSchema>;

export const assignDisputeSchema = z.object({
  disputeId: z.string().uuid("Invalid dispute."),
  adminUserId: z.string().uuid("Invalid admin.").nullable(),
});
export type AssignDisputeInput = z.infer<typeof assignDisputeSchema>;

export const setDisputePrioritySchema = z.object({
  disputeId: z.string().uuid("Invalid dispute."),
  priority: z.enum(DISPUTE_PRIORITY_VALUES),
});
export type SetDisputePriorityInput = z.infer<typeof setDisputePrioritySchema>;

export const changeDisputeStatusSchema = z.object({
  disputeId: z.string().uuid("Invalid dispute."),
  status: z.enum(DISPUTE_STATUS_VALUES),
});
export type ChangeDisputeStatusInput = z.infer<typeof changeDisputeStatusSchema>;

export const addDisputeMessageSchema = z.object({
  disputeId: z.string().uuid("Invalid dispute."),
  body: z
    .string()
    .trim()
    .min(1, "Message cannot be empty.")
    .max(MAX_MESSAGE_LENGTH, `Message must be ${MAX_MESSAGE_LENGTH} characters or fewer.`),
});
export type AddDisputeMessageInput = z.infer<typeof addDisputeMessageSchema>;

export const addDisputeInternalNoteSchema = addDisputeMessageSchema;
export type AddDisputeInternalNoteInput = z.infer<typeof addDisputeInternalNoteSchema>;

export const addDisputeEvidenceSchema = z.object({
  disputeId: z.string().uuid("Invalid dispute."),
  // Module 33 — Security Hardening: `z.string().url()` alone accepts any
  // URL-shaped string the `URL` constructor parses, including
  // `javascript:...`/`data:...`/`vbscript:...` — every one of those is a
  // valid "URL" by that check. This field is later rendered as a plain
  // `<a href={fileUrl}>` on both the dispute participants' page and the
  // admin dispute page, so a `javascript:` value here would be a stored
  // XSS payload triggered whenever anyone clicks the "evidence" link.
  // `isValidMediaUrl` (already used for portfolio media URLs, the same
  // "user-submitted URL rendered as a link" shape) enforces http(s)-only,
  // which is the only scheme this platform's upload pipeline can ever
  // produce.
  fileUrl: z.string().url("Invalid file URL.").refine(isValidMediaUrl, "File URL must be an http(s) link."),
  fileName: z.string().trim().max(255).optional(),
  fileType: z.string().trim().max(100).optional(),
  fileSizeBytes: z.coerce.number().int().positive().optional(),
  description: z
    .string()
    .trim()
    .max(MAX_EVIDENCE_DESCRIPTION_LENGTH, `Description must be ${MAX_EVIDENCE_DESCRIPTION_LENGTH} characters or fewer.`)
    .optional()
    .or(z.literal("")),
});
export type AddDisputeEvidenceInput = z.infer<typeof addDisputeEvidenceSchema>;

export const resolveDisputeSchema = z.object({
  disputeId: z.string().uuid("Invalid dispute."),
  resolution: z.enum(DISPUTE_RESOLUTION_VALUES),
  resolutionNote: z
    .string()
    .trim()
    .min(1, "Resolution note is required.")
    .max(MAX_RESOLUTION_NOTE_LENGTH, `Resolution note must be ${MAX_RESOLUTION_NOTE_LENGTH} characters or fewer.`),
});
export type ResolveDisputeInput = z.infer<typeof resolveDisputeSchema>;

export const rejectDisputeSchema = z.object({
  disputeId: z.string().uuid("Invalid dispute."),
  resolutionNote: z
    .string()
    .trim()
    .min(1, "A reason is required.")
    .max(MAX_RESOLUTION_NOTE_LENGTH, `Reason must be ${MAX_RESOLUTION_NOTE_LENGTH} characters or fewer.`),
});
export type RejectDisputeInput = z.infer<typeof rejectDisputeSchema>;

export const closeDisputeSchema = z.object({ disputeId: z.string().uuid("Invalid dispute.") });
export type CloseDisputeInput = z.infer<typeof closeDisputeSchema>;

// Module 68 — Dispute Resolution & Financial Protection.

const FINANCIAL_ADJUSTMENT_TYPE_VALUES = [
  "FULL_REFUND",
  "PARTIAL_REFUND",
  "PROFESSIONAL_PAYOUT_REDUCTION",
  "PROFESSIONAL_PAYOUT_RELEASE",
  "CUSTOMER_COMPENSATION",
  "PLATFORM_FEE_REFUND",
  "COMMISSION_REVERSAL",
] as const;

/**
 * Same fields as `resolveDisputeSchema` plus the two extra, resolution-
 * dependent financial fields `decideDisputeFinancialOutcome`
 * (`domain/services/dispute-resolution-financial-outcome.ts`) requires for
 * `PARTIAL_RESOLUTION`/`FINANCIAL_ADJUSTMENT_REQUIRED` — validated as
 * present/absent per-resolution here at the boundary so a malformed
 * request never even reaches the use case. `requestedAmount` is a plain
 * decimal — never negative, never absurdly large (the use case's own pure
 * function separately checks it against the payment amount, which this
 * schema has no access to).
 */
export const resolveDisputeWithFinancialOutcomeSchema = z
  .object({
    disputeId: z.string().uuid("Invalid dispute."),
    resolution: z.enum(DISPUTE_RESOLUTION_VALUES),
    resolutionNote: z
      .string()
      .trim()
      .min(1, "Resolution note is required.")
      .max(MAX_RESOLUTION_NOTE_LENGTH, `Resolution note must be ${MAX_RESOLUTION_NOTE_LENGTH} characters or fewer.`),
    requestedAmount: z.coerce.number().positive("Amount must be positive.").max(1_000_000).optional(),
    requestedAdjustmentType: z.enum(FINANCIAL_ADJUSTMENT_TYPE_VALUES).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.resolution === "PARTIAL_RESOLUTION" && data.requestedAmount === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["requestedAmount"], message: "A refund amount is required for a partial resolution." });
    }
    if (data.resolution === "FINANCIAL_ADJUSTMENT_REQUIRED") {
      if (data.requestedAmount === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["requestedAmount"], message: "An amount is required for this resolution." });
      }
      if (data.requestedAdjustmentType === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["requestedAdjustmentType"], message: "An adjustment type is required for this resolution." });
      }
    }
  });
export type ResolveDisputeWithFinancialOutcomeInput = z.infer<typeof resolveDisputeWithFinancialOutcomeSchema>;
