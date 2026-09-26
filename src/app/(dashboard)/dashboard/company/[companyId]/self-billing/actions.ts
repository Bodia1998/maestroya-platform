"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";

import {
  makeGrantMySelfBillingAuthorizationUseCase,
  makeRevokeMySelfBillingAuthorizationUseCase,
} from "@/application/use-cases/invoicing/compose";
import { CURRENT_SELF_BILLING_AGREEMENT_VERSION } from "@/domain/services/self-billing-agreement";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { localizeActionError } from "@/presentation/i18n/server";

/**
 * Module 99 — Self-Billing Authorization Entry Point & Financial Document
 * Access.
 *
 * Company-side companion to dashboard/professional/self-billing/actions.ts.
 * `companyId` is passed through to the composed use cases, which re-verify
 * the caller's OWNER/ADMIN membership server-side via `resolveCompanyActor`
 * (see `GrantMySelfBillingAuthorizationUseCase`/
 * `RevokeMySelfBillingAuthorizationUseCase`'s own doc comments) — this
 * action never trusts the caller's role, only their authenticated identity.
 */

export type ActionResult = { success: true } | { success: false; error: string };

async function fromDomainError(error: unknown, fallback: string): Promise<ActionResult> {
  return { success: false, error: await localizeActionError(error, fallback) };
}

function path(companyId: string) {
  return `/dashboard/company/${companyId}/self-billing`;
}

export async function grantCompanySelfBillingAuthorizationAction(companyId: string): Promise<ActionResult> {
  const user = await requireAuth();
  const t = await getTranslations("company.selfBilling.errors");
  if (!companyId) {
    return { success: false, error: t("invalidCompany") };
  }

  let ip: string | null = null;
  let userAgent: string | null = null;
  try {
    const h = await headers();
    ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    userAgent = h.get("user-agent");
  } catch {
    // headers() unavailable in this context — acceptance still proceeds.
  }

  try {
    await makeGrantMySelfBillingAuthorizationUseCase().execute({
      userId: user.id,
      companyId,
      agreementVersion: CURRENT_SELF_BILLING_AGREEMENT_VERSION,
      acceptanceIpAddress: ip,
      acceptanceUserAgent: userAgent,
    });
    revalidatePath(path(companyId));
    return { success: true };
  } catch (error) {
    return fromDomainError(error, t("grantFailed"));
  }
}

export async function revokeCompanySelfBillingAuthorizationAction(companyId: string): Promise<ActionResult> {
  const user = await requireAuth();
  const t = await getTranslations("company.selfBilling.errors");
  if (!companyId) {
    return { success: false, error: t("invalidCompany") };
  }

  try {
    await makeRevokeMySelfBillingAuthorizationUseCase().execute({ userId: user.id, companyId });
    revalidatePath(path(companyId));
    return { success: true };
  } catch (error) {
    return fromDomainError(error, t("revokeFailed"));
  }
}

// ---------------------------------------------------------------------------
// Form-bindable wrappers
// ---------------------------------------------------------------------------

export async function grantCompanySelfBillingAuthorizationFormAction(companyId: string): Promise<void> {
  await grantCompanySelfBillingAuthorizationAction(companyId);
}

export async function revokeCompanySelfBillingAuthorizationFormAction(companyId: string): Promise<void> {
  await revokeCompanySelfBillingAuthorizationAction(companyId);
}
