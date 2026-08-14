import { z } from "zod";

/**
 * Module 65 — Trust & Integrity System. Same convention as every other
 * `*.dto.ts` in this codebase: zod schemas shared by a Server Action's
 * input validation and (where useful) a client form. No UI/Server Action
 * consumes these yet (out of this module's scope — see the module brief's
 * "DO NOT create API routes/Server Actions") but the schemas are defined
 * here so the next module that adds an admin surface for this system has
 * ready-made, validated input contracts, matching how every other module
 * in this codebase defines its DTOs ahead of any UI.
 */

export const MAX_APPEAL_STATEMENT_LENGTH = 5000;
export const MAX_REVIEW_NOTES_LENGTH = 2000;
export const MAX_MANUAL_REVIEW_SUMMARY_LENGTH = 2000;
export const MAX_DETECTION_TEXT_LENGTH = 20000;

export const detectOffPlatformCommunicationSchema = z.object({
  userId: z.string().uuid("Invalid user."),
  text: z.string().min(1).max(MAX_DETECTION_TEXT_LENGTH),
  sourceType: z.enum(["MESSAGE", "QUOTE", "REVIEW", "SERVICE_REQUEST"]),
  sourceId: z.string().min(1),
});
export type DetectOffPlatformCommunicationInput = z.infer<typeof detectOffPlatformCommunicationSchema>;

export const openManualReviewCaseSchema = z.object({
  userId: z.string().uuid("Invalid user."),
  reason: z.string().min(1),
  summary: z.string().min(1).max(MAX_MANUAL_REVIEW_SUMMARY_LENGTH),
});
export type OpenManualReviewCaseInput = z.infer<typeof openManualReviewCaseSchema>;

export const manualReviewTransitionTargetSchema = z.enum(["UNDER_REVIEW", "ESCALATED", "RESOLVED", "REJECTED"]);

export const transitionManualReviewCaseSchema = z.object({
  manualReviewCaseId: z.string().uuid("Invalid case."),
  targetState: manualReviewTransitionTargetSchema,
  actingAdminUserId: z.string().uuid("Invalid admin user."),
  resolutionNotes: z.string().max(MAX_REVIEW_NOTES_LENGTH).optional(),
});
export type TransitionManualReviewCaseInput = z.infer<typeof transitionManualReviewCaseSchema>;

export const submitAppealSchema = z.object({
  userId: z.string().uuid("Invalid user."),
  automatedActionId: z.string().uuid("Invalid action."),
  userStatement: z.string().min(1).max(MAX_APPEAL_STATEMENT_LENGTH),
});
export type SubmitAppealInput = z.infer<typeof submitAppealSchema>;

export const reviewAppealDecisionSchema = z.enum(["APPROVED", "REJECTED"]);

export const reviewAppealSchema = z.object({
  appealId: z.string().uuid("Invalid appeal."),
  decision: reviewAppealDecisionSchema,
  reviewedByUserId: z.string().uuid("Invalid reviewer."),
  reviewNotes: z.string().max(MAX_REVIEW_NOTES_LENGTH).optional(),
});
export type ReviewAppealInput = z.infer<typeof reviewAppealSchema>;

export const getUserTrustProfileSchema = z.object({
  userId: z.string().uuid("Invalid user."),
});
export type GetUserTrustProfileInput = z.infer<typeof getUserTrustProfileSchema>;
