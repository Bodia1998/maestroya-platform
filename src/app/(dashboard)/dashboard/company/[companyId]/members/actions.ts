"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";

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
import type { CompanyMemberWithUser } from "@/domain/repositories/company-membership-repository";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { localizeActionError, localizeZodError } from "@/presentation/i18n/server";

/** Module 18 — Company Professional: company membership Server Actions.
 *  `companyId` scopes the target; the caller's own role is always
 *  re-derived server-side (resolveCompanyActor) — never trusted from the
 *  client. */

export type ActionResult<T = undefined> = { success: true; data: T } | { success: false; error: string };

async function fromDomainError<T>(error: unknown, fallback: string): Promise<ActionResult<T>> {
  return { success: false, error: await localizeActionError(error, fallback) };
}

export async function listCompanyMembersAction(companyId: string): Promise<ActionResult<CompanyMemberWithUser[]>> {
  const user = await requireAuth();
  try {
    const members = await makeListCompanyMembersUseCase().execute(user.id, companyId);
    return { success: true, data: members };
  } catch (error) {
    const t = await getTranslations("company.members.errors");
    return fromDomainError(error, t("loadFailed"));
  }
}

export async function changeCompanyMemberRoleAction(
  companyId: string,
  memberId: string,
  role: string,
): Promise<ActionResult> {
  const user = await requireAuth();
  const parsed = changeCompanyMemberRoleSchema.safeParse({ memberId, role });
  if (!parsed.success) {
    const t = await getTranslations("company.members.errors");
    return { success: false, error: await localizeZodError(parsed.error, t("invalidRole")) };
  }
  try {
    await makeChangeCompanyMemberRoleUseCase().execute(user.id, companyId, parsed.data.memberId, parsed.data.role);
    revalidatePath(`/dashboard/company/${companyId}/members`);
    return { success: true, data: undefined };
  } catch (error) {
    const t = await getTranslations("company.members.errors");
    return fromDomainError(error, t("changeRoleFailed"));
  }
}

export async function removeCompanyMemberAction(companyId: string, memberId: string): Promise<ActionResult> {
  const user = await requireAuth();
  const parsed = companyMemberIdSchema.safeParse({ memberId });
  if (!parsed.success) {
    const t = await getTranslations("company.members.errors");
    return { success: false, error: await localizeZodError(parsed.error, t("invalidMember")) };
  }
  try {
    await makeRemoveCompanyMemberUseCase().execute(user.id, companyId, parsed.data.memberId);
    revalidatePath(`/dashboard/company/${companyId}/members`);
    return { success: true, data: undefined };
  } catch (error) {
    const t = await getTranslations("company.members.errors");
    return fromDomainError(error, t("removeFailed"));
  }
}

export async function transferCompanyOwnershipAction(
  companyId: string,
  newOwnerMemberId: string,
  confirmationText: string,
): Promise<ActionResult> {
  const user = await requireAuth();
  const parsed = transferCompanyOwnershipSchema.safeParse({ newOwnerMemberId, confirmationText });
  if (!parsed.success) {
    const t = await getTranslations("company.members.errors");
    return { success: false, error: await localizeZodError(parsed.error, t("invalidRequest")) };
  }
  try {
    await makeTransferCompanyOwnershipUseCase().execute(user.id, companyId, parsed.data.newOwnerMemberId);
    revalidatePath(`/dashboard/company/${companyId}/members`);
    return { success: true, data: undefined };
  } catch (error) {
    const t = await getTranslations("company.members.errors");
    return fromDomainError(error, t("transferFailed"));
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
