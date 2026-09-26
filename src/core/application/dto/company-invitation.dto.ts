import { z } from "zod";

/**
 * Module 18 — Company Professional: Zod schemas for the invitation
 * workflow. Scope: existing MaestroYa users only, invited by email (the
 * invitation resolves to an existing account server-side — see
 * CreateCompanyInvitationUseCase); email invitations to non-existing users
 * are deferred (see docs/MODULE_18_COMPANY_PROFESSIONAL.md).
 */

export const createCompanyInvitationSchema = z.object({
  email: z.string().trim().toLowerCase().email("email"),
  role: z.enum(["ADMIN", "MANAGER", "MEMBER"], {
    errorMap: () => ({ message: "dto.membership.roleInvalid" }),
  }),
});
export type CreateCompanyInvitationInput = z.infer<typeof createCompanyInvitationSchema>;

export const companyInvitationIdSchema = z.object({
  invitationId: z.string().uuid("dto.ids.invitation"),
});
export type CompanyInvitationIdInput = z.infer<typeof companyInvitationIdSchema>;

/** The raw token from the invitation link — never the invitation's id or
 *  its stored hash. Hashed server-side inside the use case before any
 *  database lookup. */
export const acceptCompanyInvitationSchema = z.object({
  token: z.string().trim().min(32, "dto.invitation.linkInvalid").max(256),
});
export type AcceptCompanyInvitationInput = z.infer<typeof acceptCompanyInvitationSchema>;

export const declineCompanyInvitationSchema = acceptCompanyInvitationSchema;
export type DeclineCompanyInvitationInput = z.infer<typeof declineCompanyInvitationSchema>;
