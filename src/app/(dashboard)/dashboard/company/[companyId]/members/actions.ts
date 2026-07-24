"use server";

import { revalidatePath } from "next/cache";

import {
  changeCompanyMemberRoleSchema,
  companyMemberIdSchema,
  transferCompanyOwnershipSchema,
} from "@/application/dto/company-membership.dto";
import {
  makeChangeCompanyMemberRoleUseCase,
  makeListCompanyMembersUseCase,
  makeRemoveCompanyMemberUseCase,
  makeTransferCompanyOwnershipUseCase,
} from "@/application/use-cases/company-membership/compose";
import { DomainError } from "@/domain/errors/domain-error";
import type { CompanyMemberWithUser } from "@/domain/repositories/company-membership-repository";
import { requireAuth } from "@/infrastructure/auth/rbac";

/** Module 18 — Company Professional: company membership Server Actions.
 *  `companyId` scopes the target; the caller's own role is always
 *  re-derived server-side (resolveCompanyActor) — never trusted from the
 *  client. */

export type ActionResult<T = undefined> = { success: true; data: T } | { success: false; error: string };

function fromDomainError<T>(error: unknown, fallback: string): ActionResult<T> {
  if (error instanceof DomainError) return { success: false, error: error.message };
  console.error(error);
  return { success: false, error: fallback };
}

export async function listCompanyMembersAction(companyId: string): Promise<ActionResult<CompanyMemberWithUser[]>> {
  const user = await requireAuth();
  try {
    const members = await makeListCompanyMembersUseCase().execute(user.id, companyId);
    return { success: true, data: members };
  } catch (error) {
    return fromDomainError(error, "Something went wrong loading members.");
  }
}

export async function changeCompanyMemberRoleAction(
  companyId: string,
  memberId: string,
  role: string,
): Promise<ActionResult> {
  const user = await requireAuth();
  const parsed = changeCompanyMemberRoleSchema.safeParse({ memberId, role });
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid role." };
  try {
    await makeChangeCompanyMemberRoleUseCase().execute(user.id, companyId, parsed.data.memberId, parsed.data.role);
    revalidatePath(`/dashboard/company/${companyId}/members`);
    return { success: true, data: undefined };
  } catch (error) {
    return fromDomainError(error, "Something went wrong changing this member's role.");
  }
}

export async function removeCompanyMemberAction(companyId: string, memberId: string): Promise<ActionResult> {
  const user = await requireAuth();
  const parsed = companyMemberIdSchema.safeParse({ memberId });
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid member." };
  try {
    await makeRemoveCompanyMemberUseCase().execute(user.id, companyId, parsed.data.memberId);
    revalidatePath(`/dashboard/company/${companyId}/members`);
    return { success: true, data: undefined };
  } catch (error) {
    return fromDomainError(error, "Something went wrong removing this member.");
  }
}

export async function transferCompanyOwnershipAction(
  companyId: string,
  newOwnerMemberId: string,
  confirmationText: string,
): Promise<ActionResult> {
  const user = await requireAuth();
  const parsed = transferCompanyOwnershipSchema.safeParse({ newOwnerMemberId, confirmationText });
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
  try {
    await makeTransferCompanyOwnershipUseCase().execute(user.id, companyId, parsed.data.newOwnerMemberId);
    revalidatePath(`/dashboard/company/${companyId}/members`);
    return { success: true, data: undefined };
  } catch (error) {
    return fromDomainError(error, "Something went wrong transferring ownership.");
  }
}

// --- Form-bindable wrappers ---

export async function changeCompanyMemberRoleFormAction(
  companyId: string,
  memberId: string,
  formData: FormData,
): Promise<void> {
  await changeCompanyMemberRoleAction(companyId, memberId, String(formData.get("role") ?? ""));
}

export async function removeCompanyMemberFormAction(companyId: string, memberId: string): Promise<void> {
  await removeCompanyMemberAction(companyId, memberId);
}

export async function transferCompanyOwnershipFormAction(companyId: string, formData: FormData): Promise<void> {
  await transferCompanyOwnershipAction(
    companyId,
    String(formData.get("newOwnerMemberId") ?? ""),
    String(formData.get("confirmationText") ?? ""),
  );
}
