"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import {
  makeGrantMySelfBillingAuthorizationUseCase,
  makeRevokeMySelfBillingAuthorizationUseCase,
} from "@/application/use-cases/invoicing/compose";
import { CURRENT_SELF_BILLING_AGREEMENT_VERSION } from "@/domain/services/self-billing-agreement";
import { DomainError } from "@/domain/errors/domain-error";
import { requireAuth } from "@/infrastructure/auth/rbac";

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

function fromDomainError(error: unknown, fallback: string): ActionResult {
  if (error instanceof DomainError) {
    return { success: false, error: error.message };
  }
  console.error(error);
  return { success: false, error: fallback };
}

function path(companyId: string) {
  return `/dashboard/company/${companyId}/self-billing`;
}

export async function grantCompanySelfBillingAuthorizationAction(companyId: string): Promise<ActionResult> {
  const user = await requireAuth();
  if (!companyId) {
    return { success: false, error: "Invalid company." };
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
    return fromDomainError(error, "Something went wrong granting self-billing authorization.");
  }
}

export async function revokeCompanySelfBillingAuthorizationAction(companyId: string): Promise<ActionResult> {
  const user = await requireAuth();
  if (!companyId) {
    return { success: false, error: "Invalid company." };
  }

  try {
    await makeRevokeMySelfBillingAuthorizationUseCase().execute({ userId: user.id, companyId });
    revalidatePath(path(companyId));
    return { success: true };
  } catch (error) {
    return fromDomainError(error, "Something went wrong revoking self-billing authorization.");
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
