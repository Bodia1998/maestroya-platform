"use server";

import { revalidatePath } from "next/cache";

import { companyInvitationIdSchema, createCompanyInvitationSchema } from "@/application/dto/company-invitation.dto";
import {
  makeCancelCompanyInvitationUseCase,
  makeCreateCompanyInvitationUseCase,
  makeListCompanyInvitationsUseCase,
} from "@/application/use-cases/company-invitation/compose";
import { DomainError } from "@/domain/errors/domain-error";
import type { CompanyInvitationRecord } from "@/domain/repositories/company-invitation-repository";
import { requireAuth } from "@/infrastructure/auth/rbac";

/** Module 18 — Company Professional: invitation management Server Actions. */

export type ActionResult<T = undefined> = { success: true; data: T } | { success: false; error: string };

function fromDomainError<T>(error: unknown, fallback: string): ActionResult<T> {
  if (error instanceof DomainError) return { success: false, error: error.message };
  console.error(error);
  return { success: false, error: fallback };
}

export async function listCompanyInvitationsAction(companyId: string): Promise<ActionResult<CompanyInvitationRecord[]>> {
  const user = await requireAuth();
  try {
    const invitations = await makeListCompanyInvitationsUseCase().execute(user.id, companyId);
    return { success: true, data: invitations };
  } catch (error) {
    return fromDomainError(error, "Something went wrong loading invitations.");
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
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid invitation." };
  try {
    const { invitation, token } = await makeCreateCompanyInvitationUseCase().execute(user.id, companyId, parsed.data);
    revalidatePath(`/dashboard/company/${companyId}/invitations`);
    return { success: true, data: { invitationId: invitation.id, token } };
  } catch (error) {
    return fromDomainError(error, "Something went wrong creating the invitation.");
  }
}

export async function cancelCompanyInvitationAction(companyId: string, invitationId: string): Promise<ActionResult> {
  const user = await requireAuth();
  const parsed = companyInvitationIdSchema.safeParse({ invitationId });
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid invitation." };
  try {
    await makeCancelCompanyInvitationUseCase().execute(user.id, companyId, parsed.data.invitationId);
    revalidatePath(`/dashboard/company/${companyId}/invitations`);
    return { success: true, data: undefined };
  } catch (error) {
    return fromDomainError(error, "Something went wrong cancelling this invitation.");
  }
}

// --- Form-bindable wrappers ---

export async function createCompanyInvitationFormAction(companyId: string, formData: FormData): Promise<void> {
  await createCompanyInvitationAction(companyId, formData);
}

export async function cancelCompanyInvitationFormAction(companyId: string, invitationId: string): Promise<void> {
  await cancelCompanyInvitationAction(companyId, invitationId);
}
