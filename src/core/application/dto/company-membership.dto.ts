import { z } from "zod";

/**
 * Module 18 — Company Professional: Zod schemas for company-membership
 * mutations (role changes, removal, ownership transfer). Deliberately
 * absent: any field naming the acting user's own role/permission — the
 * caller's authority is always re-derived server-side from their own
 * CompanyMember row inside the use case, never accepted as client input.
 * `memberId`/`companyId` identify the *target*, not a claim of privilege
 * over it.
 */

export const companyMemberIdSchema = z.object({
  memberId: z.string().uuid("Invalid member."),
});
export type CompanyMemberIdInput = z.infer<typeof companyMemberIdSchema>;

export const changeCompanyMemberRoleSchema = z.object({
  memberId: z.string().uuid("Invalid member."),
  role: z.enum(["ADMIN", "MANAGER", "MEMBER"], {
    errorMap: () => ({ message: "Select a valid role." }),
  }),
});
export type ChangeCompanyMemberRoleInput = z.infer<typeof changeCompanyMemberRoleSchema>;

export const transferCompanyOwnershipSchema = z.object({
  newOwnerMemberId: z.string().uuid("Invalid member."),
  confirmationText: z.literal("TRANSFER", {
    errorMap: () => ({ message: 'Type "TRANSFER" to confirm.' }),
  }),
});
export type TransferCompanyOwnershipInput = z.infer<typeof transferCompanyOwnershipSchema>;
