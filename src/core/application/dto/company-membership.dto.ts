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
  memberId: z.string().uuid("dto.ids.member"),
});
export type CompanyMemberIdInput = z.infer<typeof companyMemberIdSchema>;

export const changeCompanyMemberRoleSchema = z.object({
  memberId: z.string().uuid("dto.ids.member"),
  role: z.enum(["ADMIN", "MANAGER", "MEMBER"], {
    errorMap: () => ({ message: "dto.membership.roleInvalid" }),
  }),
});
export type ChangeCompanyMemberRoleInput = z.infer<typeof changeCompanyMemberRoleSchema>;

export const transferCompanyOwnershipSchema = z.object({
  newOwnerMemberId: z.string().uuid("dto.ids.member"),
  confirmationText: z.literal("TRANSFER", {
    errorMap: () => ({ message: "dto.membership.transferConfirm" }),
  }),
});
export type TransferCompanyOwnershipInput = z.infer<typeof transferCompanyOwnershipSchema>;
