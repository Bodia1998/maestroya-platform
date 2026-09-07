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
 * Thin Server Action adapters for the professional's own self-billing
 * settings page. All ownership resolution, the OWNER/ADMIN company-role
 * check, and the actual grant/revoke persistence live inside
 * `GrantMySelfBillingAuthorizationUseCase`/`RevokeMySelfBillingAuthorizationUseCase`
 * (see those files' own doc comments) — this file never accepts a
 * professionalProfileId/companyProfileId/authorizationId from the client;
 * everything is re-derived server-side from the authenticated session.
 */

export type ActionResult = { success: true } | { success: false; error: string };

function fromDomainError(error: unknown, fallback: string): ActionResult {
  if (error instanceof DomainError) {
    return { success: false, error: error.message };
  }
  console.error(error);
  return { success: false, error: fallback };
}

const PATH = "/dashboard/professional/self-billing";

export async function grantMySelfBillingAuthorizationAction(): Promise<ActionResult> {
  const user = await requireAuth();

  // Best-effort acceptance evidence only (IP/user-agent) — never claimed as
  // a qualified electronic signature. Same caveat as
  // SelfBillingAuthorizationRecord's own doc comment.
  let ip: string | null = null;
  let userAgent: string | null = null;
  try {
    const h = await headers();
    ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    userAgent = h.get("user-agent");
  } catch {
    // headers() unavailable in this context — acceptance still proceeds
    // without best-effort evidence rather than failing the whole action.
  }

  try {
    await makeGrantMySelfBillingAuthorizationUseCase().execute({
      userId: user.id,
      agreementVersion: CURRENT_SELF_BILLING_AGREEMENT_VERSION,
      acceptanceIpAddress: ip,
      acceptanceUserAgent: userAgent,
    });
    revalidatePath(PATH);
    return { success: true };
  } catch (error) {
    return fromDomainError(error, "Something went wrong granting self-billing authorization.");
  }
}

export async function revokeMySelfBillingAuthorizationAction(): Promise<ActionResult> {
  const user = await requireAuth();

  try {
    await makeRevokeMySelfBillingAuthorizationUseCase().execute({ userId: user.id });
    revalidatePath(PATH);
    return { success: true };
  } catch (error) {
    return fromDomainError(error, "Something went wrong revoking self-billing authorization.");
  }
}

// ---------------------------------------------------------------------------
// Form-bindable wrappers
// ---------------------------------------------------------------------------

export async function grantMySelfBillingAuthorizationFormAction(): Promise<void> {
  await grantMySelfBillingAuthorizationAction();
}

export async function revokeMySelfBillingAuthorizationFormAction(): Promise<void> {
  await revokeMySelfBillingAuthorizationAction();
}
