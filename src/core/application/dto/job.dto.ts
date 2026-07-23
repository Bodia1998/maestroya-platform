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
  jobId: z.string().uuid("Invalid job."),
});
export type StartJobInput = z.infer<typeof startJobSchema>;

export const completeJobSchema = z.object({
  jobId: z.string().uuid("Invalid job."),
});
export type CompleteJobInput = z.infer<typeof completeJobSchema>;

export const MAX_JOB_CANCELLATION_NOTE_LENGTH = 1000;

export const cancelJobSchema = z.object({
  jobId: z.string().uuid("Invalid job."),
  reason: z.enum(["CUSTOMER_REQUEST", "PROFESSIONAL_UNABLE_TO_COMPLETE", "SERVICE_REQUEST_ISSUE", "OTHER"], {
    errorMap: () => ({ message: "Choose a cancellation reason." }),
  }),
  note: z
    .string()
    .trim()
    .max(MAX_JOB_CANCELLATION_NOTE_LENGTH, `Notes must be ${MAX_JOB_CANCELLATION_NOTE_LENGTH} characters or fewer.`)
    .optional()
    .or(z.literal("")),
});
export type CancelJobInput = z.infer<typeof cancelJobSchema>;

export const listJobsSchema = z.object({
  filter: z.enum(["active", "completed", "cancelled"]).optional(),
});
export type ListJobsInput = z.infer<typeof listJobsSchema>;
