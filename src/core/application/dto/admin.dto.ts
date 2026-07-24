import { z } from "zod";

import {
  DEFAULT_PAGE_SIZE,
  JOB_STATUS_VALUES,
  MAX_MODERATION_REASON_LENGTH,
  MAX_PAGE_SIZE,
  MAX_SEARCH_LENGTH,
  QUOTE_STATUS_VALUES,
  REVIEW_STATUS_VALUES,
  SERVICE_REQUEST_STATUS_VALUES,
} from "@/domain/services/admin-rules";
import { ROLES } from "@/infrastructure/auth/rbac";

/**
 * Admin Panel module (Module 16). Same convention as notification.dto.ts/
 * review.dto.ts/portfolio.dto.ts: one schema shared by the client-facing
 * Server Action boundary and the composed use case it calls.
 *
 * Deliberately absent from every schema here: `adminUserId`, `actorId`,
 * `isAdmin`, `role` (as a claim about the caller), or any other field that
 * could be mistaken for an authorization signal. The authenticated admin
 * actor is always resolved server-side via `requireRole()` — see every
 * action in `src/app/(dashboard)/admin/actions.ts`. Every id field below
 * (`userId`, `reviewId`, `portfolioItemId`, ...) identifies which resource
 * the action *targets*, never a claim of privilege over it.
 */

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  offset: z.coerce.number().int().min(0).default(0),
});
export type PaginationInput = z.infer<typeof paginationSchema>;

const searchSchema = z
  .string()
  .trim()
  .max(MAX_SEARCH_LENGTH, `Search must be ${MAX_SEARCH_LENGTH} characters or fewer.`)
  .optional();

export const listAdminUsersSchema = paginationSchema.extend({ search: searchSchema });
export type ListAdminUsersInput = z.infer<typeof listAdminUsersSchema>;

export const listAdminProfessionalsSchema = paginationSchema.extend({ search: searchSchema });
export type ListAdminProfessionalsInput = z.infer<typeof listAdminProfessionalsSchema>;

export const listAdminServiceRequestsSchema = paginationSchema.extend({
  status: z.enum(SERVICE_REQUEST_STATUS_VALUES).optional(),
});
export type ListAdminServiceRequestsInput = z.infer<typeof listAdminServiceRequestsSchema>;

export const listAdminQuotesSchema = paginationSchema.extend({
  status: z.enum(QUOTE_STATUS_VALUES).optional(),
});
export type ListAdminQuotesInput = z.infer<typeof listAdminQuotesSchema>;

export const listAdminJobsSchema = paginationSchema.extend({
  status: z.enum(JOB_STATUS_VALUES).optional(),
});
export type ListAdminJobsInput = z.infer<typeof listAdminJobsSchema>;

export const listAdminReviewsSchema = paginationSchema.extend({
  status: z.enum(REVIEW_STATUS_VALUES).optional(),
});
export type ListAdminReviewsInput = z.infer<typeof listAdminReviewsSchema>;

export const listAdminPortfolioItemsSchema = paginationSchema;
export type ListAdminPortfolioItemsInput = z.infer<typeof listAdminPortfolioItemsSchema>;

export const listAdminAuditLogsSchema = paginationSchema;
export type ListAdminAuditLogsInput = z.infer<typeof listAdminAuditLogsSchema>;

export const adminUserIdSchema = z.object({ userId: z.string().uuid("Invalid user.") });
export type AdminUserIdInput = z.infer<typeof adminUserIdSchema>;

export const adminProfessionalIdSchema = z.object({ professionalId: z.string().uuid("Invalid professional.") });
export type AdminProfessionalIdInput = z.infer<typeof adminProfessionalIdSchema>;

export const adminServiceRequestIdSchema = z.object({ serviceRequestId: z.string().uuid("Invalid service request.") });
export type AdminServiceRequestIdInput = z.infer<typeof adminServiceRequestIdSchema>;

export const adminQuoteIdSchema = z.object({ quoteId: z.string().uuid("Invalid quote.") });
export type AdminQuoteIdInput = z.infer<typeof adminQuoteIdSchema>;

export const adminJobIdSchema = z.object({ jobId: z.string().uuid("Invalid job.") });
export type AdminJobIdInput = z.infer<typeof adminJobIdSchema>;

export const adminReviewIdSchema = z.object({ reviewId: z.string().uuid("Invalid review.") });
export type AdminReviewIdInput = z.infer<typeof adminReviewIdSchema>;

export const adminPortfolioItemIdSchema = z.object({ portfolioItemId: z.string().uuid("Invalid portfolio item.") });
export type AdminPortfolioItemIdInput = z.infer<typeof adminPortfolioItemIdSchema>;

/**
 * Every platform role key currently seeded (see prisma/seed.ts) — validated
 * against the same `ROLES` constant `requireRole()` itself uses, so a
 * requested role change can never inject a value the RBAC layer doesn't
 * already recognize.
 */
const roleKeySchema = z.enum([ROLES.CUSTOMER, ROLES.PROVIDER, ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.SUPPORT, ROLES.MODERATOR]);

export const changeUserRoleSchema = z.object({
  userId: z.string().uuid("Invalid user."),
  roles: z.array(roleKeySchema).min(1, "At least one role is required."),
});
export type ChangeUserRoleInput = z.infer<typeof changeUserRoleSchema>;

const moderationReasonSchema = z
  .string()
  .trim()
  .max(MAX_MODERATION_REASON_LENGTH, `Reason must be ${MAX_MODERATION_REASON_LENGTH} characters or fewer.`)
  .optional()
  .or(z.literal(""));

export const moderateReviewSchema = z.object({
  reviewId: z.string().uuid("Invalid review."),
  reason: moderationReasonSchema,
});
export type ModerateReviewInput = z.infer<typeof moderateReviewSchema>;

export const restoreReviewSchema = adminReviewIdSchema;
export type RestoreReviewInput = z.infer<typeof restoreReviewSchema>;

export const moderatePortfolioItemSchema = z.object({
  portfolioItemId: z.string().uuid("Invalid portfolio item."),
  reason: moderationReasonSchema,
});
export type ModeratePortfolioItemInput = z.infer<typeof moderatePortfolioItemSchema>;

export const restorePortfolioItemSchema = adminPortfolioItemIdSchema;
export type RestorePortfolioItemInput = z.infer<typeof restorePortfolioItemSchema>;
