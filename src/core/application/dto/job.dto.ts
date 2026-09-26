import { z } from "zod";

/**
 * Order / Job Lifecycle module (Module 11). Same convention as
 * booking.dto.ts/quote.dto.ts: one schema shared by the client form/action
 * caller and the Server Action that receives it.
 *
 * Deliberately absent from every schema here: `userId`, `customerId`,
 * `professionalProfileId`, `companyProfileId` — ownership is always
 * derived from the authenticated session (see resolveJobActor and every
 * Job use case's own doc comment), never accepted as client input.
 *
 * `jobId` itself *is* accepted here (and re-verified server-side against
 * the caller's session by every use case) — same as `appointmentId` in
 * booking.dto.ts: it identifies which resource the action targets, not a
 * claim of ownership over it.
 */

export const startJobSchema = z.object({
  jobId: z.string().uuid("dto.ids.job"),
});
export type StartJobInput = z.infer<typeof startJobSchema>;

export const completeJobSchema = z.object({
  jobId: z.string().uuid("dto.ids.job"),
});
export type CompleteJobInput = z.infer<typeof completeJobSchema>;

export const MAX_JOB_CANCELLATION_NOTE_LENGTH = 1000;

export const cancelJobSchema = z.object({
  jobId: z.string().uuid("dto.ids.job"),
  reason: z.enum(["CUSTOMER_REQUEST", "PROFESSIONAL_UNABLE_TO_COMPLETE", "SERVICE_REQUEST_ISSUE", "OTHER"], {
    errorMap: () => ({ message: "dto.common.cancellationReasonRequired" }),
  }),
  note: z
    .string()
    .trim()
    .max(MAX_JOB_CANCELLATION_NOTE_LENGTH, "maxLength")
    .optional()
    .or(z.literal("")),
});
export type CancelJobInput = z.infer<typeof cancelJobSchema>;

export const listJobsSchema = z.object({
  filter: z.enum(["active", "completed", "cancelled"]).optional(),
});
export type ListJobsInput = z.infer<typeof listJobsSchema>;

// --- Module 66 — Job Completion & Payment Release Protection ---

export const confirmJobCompletionSchema = z.object({
  jobId: z.string().uuid("dto.ids.job"),
});
export type ConfirmJobCompletionInput = z.infer<typeof confirmJobCompletionSchema>;

export const MAX_DISPUTE_JOB_COMPLETION_DESCRIPTION_LENGTH = 5000;

export const disputeJobCompletionSchema = z.object({
  jobId: z.string().uuid("dto.ids.job"),
  reason: z.enum(
    [
      "SERVICE_NOT_COMPLETED",
      "SERVICE_QUALITY",
      "PROPERTY_DAMAGE",
      "PROFESSIONAL_NO_SHOW",
      "CUSTOMER_NO_SHOW",
      "PRICE_DISAGREEMENT",
      "SCOPE_OF_WORK",
      "COMMUNICATION_ISSUE",
      "OTHER",
    ],
    { errorMap: () => ({ message: "dto.job.reasonRequired" }) },
  ),
  title: z.string().trim().min(5, "minLength").max(150, "maxLength"),
  description: z
    .string()
    .trim()
    .min(20, "dto.job.describeProblem")
    .max(MAX_DISPUTE_JOB_COMPLETION_DESCRIPTION_LENGTH, "maxLength"),
});
export type DisputeJobCompletionInput = z.infer<typeof disputeJobCompletionSchema>;

export const adminResolvePaymentReleaseSchema = z.object({
  jobId: z.string().uuid("dto.ids.job"),
  decision: z.enum(["APPROVE", "HOLD"], { errorMap: () => ({ message: "dto.job.decisionRequired" }) }),
  note: z.string().trim().max(2000, "maxLength").optional().or(z.literal("")),
});
export type AdminResolvePaymentReleaseInput = z.infer<typeof adminResolvePaymentReleaseSchema>;
