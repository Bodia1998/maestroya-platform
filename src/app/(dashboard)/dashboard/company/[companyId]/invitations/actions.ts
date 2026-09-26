"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";

import { companyInvitationIdSchema, createCompanyInvitationSchema } from "@/application/dto/company-invitation.dto";
import {
  makeCancelCompanyInvitationUseCase,
  makeCreateCompanyInvitationUseCase,
  makeListCompanyInvitationsUseCase,
} from "@/application/use-cases/company-invitation/compose";
import type { CompanyInvitationRecord } from "@/domain/repositories/company-invitation-repository";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { localizeActionError, localizeZodError } from "@/presentation/i18n/server";

/** Module 18 — Company Professional: invitation management Server Actions. */

export type ActionResult<T = undefined> = { success: true; data: T } | { success: false; error: string };

async function fromDomainError<T>(error: unknown, fallback: string): Promise<ActionResult<T>> {
  return { success: false, error: await localizeActionError(error, fallback) };
}

export async function listCompanyInvitationsAction(companyId: string): Promise<ActionResult<CompanyInvitationRecord[]>> {
  const user = await requireAuth();
  try {
    const invitations = await makeListCompanyInvitationsUseCase().execute(user.id, companyId);
    return { success: true, data: invitations };
  } catch (error) {
    const t = await getTranslations("company.invitations.errors");
    return fromDomainError(error, t("loadFailed"));
  }
}

export async function createCompanyInvitationAction(
  companyId: string,
  formData: FormData,
): Promise<ActionResult<{ invitationId: string; token: string }>> {
  const user = await requireAuth();
  const parsed = createCompanyInvitationSchema.safeParse({
    email: formData.get("email"),
    role: formData.get("role"),
  });
  if (!parsed.success) {
    const t = await getTranslations("company.invitations.errors");
    return { success: false, error: await localizeZodError(parsed.error, t("invalid")) };
  }
  try {
    const { invitation, token } = await makeCreateCompanyInvitationUseCase().execute(user.id, companyId, parsed.data);
    revalidatePath(`/dashboard/company/${companyId}/invitations`);
    return { success: true, data: { invitationId: invitation.id, token } };
  } catch (error) {
    const t = await getTranslations("company.invitations.errors");
    return fromDomainError(error, t("createFailed"));
  }
}

export async function cancelCompanyInvitationAction(companyId: string, invitationId: string): Promise<ActionResult> {
  const user = await requireAuth();
  const parsed = companyInvitationIdSchema.safeParse({ invitationId });
  if (!parsed.success) {
    const t = await getTranslations("company.invitations.errors");
    return { success: false, error: await localizeZodError(parsed.error, t("invalid")) };
  }
  try {
    await makeCancelCompanyInvitationUseCase().execute(user.id, companyId, parsed.data.invitationId);
    revalidatePath(`/dashboard/company/${companyId}/invitations`);
    return { success: true, data: undefined };
  } catch (error) {
    const t = await getTranslations("company.invitations.errors");
    return fromDomainError(error, t("cancelFailed"));
  }
}

// --- Form-bindable wrappers ---

export async function createCompanyInvitationFormAction(companyId: string, formData: FormData): Promise<void> {
  await createCompanyInvitationAction(companyId, formData);
}

export async function cancelCompanyInvitationFormAction(companyId: string, invitationId: string): Promise<void> {
  await cancelCompanyInvitationAction(companyId, invitationId);
}
