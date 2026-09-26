"use server";

import { acceptCompanyInvitationSchema, declineCompanyInvitationSchema } from "@/application/dto/company-invitation.dto";
import {
  makeAcceptCompanyInvitationUseCase,
  makeDeclineCompanyInvitationUseCase,
} from "@/application/use-cases/company-invitation/compose";
import { getTranslations } from "next-intl/server";

import { requireAuth } from "@/infrastructure/auth/rbac";
import { localizeActionError } from "@/presentation/i18n/server";

/**
 * Module 18 — Company Professional: accept/decline a company invitation by
 * its raw token. Security-critical: AcceptCompanyInvitationUseCase/
 * DeclineCompanyInvitationUseCase re-verify server-side that the invitation
 * belongs to the *authenticated* caller (by resolved invitedUserId, or by
 * matching email) — this page/action never trusts a companyId or role from
 * the client, only the token + the session.
 */
export type ActionResult = { success: true } | { success: false; error: string };

async function fromDomainError(error: unknown, fallback: string): Promise<ActionResult> {
  return { success: false, error: await localizeActionError(error, fallback) };
}

export async function acceptCompanyInvitationAction(token: string): Promise<ActionResult> {
  const user = await requireAuth();
  const t = await getTranslations("company.acceptInvitation");
  const parsed = acceptCompanyInvitationSchema.safeParse({ token });
  if (!parsed.success) return { success: false, error: t("invalidLink") };
  try {
    await makeAcceptCompanyInvitationUseCase().execute(user.id, parsed.data.token);
    return { success: true };
  } catch (error) {
    return fromDomainError(error, t("acceptFailed"));
  }
}

export async function declineCompanyInvitationAction(token: string): Promise<ActionResult> {
  const user = await requireAuth();
  const t = await getTranslations("company.acceptInvitation");
  const parsed = declineCompanyInvitationSchema.safeParse({ token });
  if (!parsed.success) return { success: false, error: t("invalidLink") };
  try {
    await makeDeclineCompanyInvitationUseCase().execute(user.id, parsed.data.token);
    return { success: true };
  } catch (error) {
    return fromDomainError(error, t("declineFailed"));
  }
}

export async function acceptCompanyInvitationFormAction(token: string): Promise<void> {
  await acceptCompanyInvitationAction(token);
}

export async function declineCompanyInvitationFormAction(token: string): Promise<void> {
  await declineCompanyInvitationAction(token);
}
