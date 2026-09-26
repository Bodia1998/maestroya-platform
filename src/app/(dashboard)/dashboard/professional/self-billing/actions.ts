"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { headers } from "next/headers";

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
 * Thin Server Action adapters for the professional's own self-billing
 * settings page. All ownership resolution, the OWNER/ADMIN company-role
 * check, and the actual grant/revoke persistence live inside
 * `GrantMySelfBillingAuthorizationUseCase`/`RevokeMySelfBillingAuthorizationUseCase`
 * (see those files' own doc comments) — this file never accepts a
 * professionalProfileId/companyProfileId/authorizationId from the client;
 * everything is re-derived server-side from the authenticated session.
 */

export type ActionResult = { success: true } | { success: false; error: string };

// Module 120 — errors are localised at the edge (`localizeActionError`):
// domain errors map to their catalog sentence, anything else is logged
// server-side and replaced with the localised fallback.
type FallbackKey =
  | "grantSelfBilling"
  | "revokeSelfBilling";

async function fromDomainError(error: unknown, fallbackKey: FallbackKey): Promise<ActionResult> {
  const t = await getTranslations("professional.errors");
  return { success: false, error: await localizeActionError(error, t(fallbackKey)) };
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
    return fromDomainError(error, "grantSelfBilling");
  }
}

export async function revokeMySelfBillingAuthorizationAction(): Promise<ActionResult> {
  const user = await requireAuth();

  try {
    await makeRevokeMySelfBillingAuthorizationUseCase().execute({ userId: user.id });
    revalidatePath(PATH);
    return { success: true };
  } catch (error) {
    return fromDomainError(error, "revokeSelfBilling");
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
