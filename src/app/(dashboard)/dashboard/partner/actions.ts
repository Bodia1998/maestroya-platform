"use server";

import { revalidatePath } from "next/cache";

import {
  makeGeneratePartnerReferralLinkUseCase,
  makeGetPartnerByUserIdUseCase,
  makeSetReferralCodeActiveUseCase,
} from "@/application/use-cases/affiliate/compose";
import { makeAntiAbuseService } from "@/application/use-cases/security/compose";
import { DomainError, NotFoundError, UnauthorizedError } from "@/domain/errors/domain-error";
import type { ReferralCodeRecord } from "@/domain/repositories/referral-code-repository";
import { requireAuth } from "@/infrastructure/auth/rbac";

/**
 * Module 96 — Referral & Affiliate Production Wiring: partner-facing
 * Server Actions for campaign management (creating a new referral link,
 * activating/deactivating one already owned). Same `ActionResult`/
 * `fromDomainError` convention as `admin/partners/actions.ts`.
 *
 * Isolation: every action here resolves `partnerId` from the
 * authenticated session's own `userId` via `GetPartnerByUserIdUseCase` —
 * identical to `PartnerDashboardPage`'s own rule — never from a client-
 * supplied field, so one partner can never create or toggle a link under
 * another partner's account even by tampering with a hidden form field.
 */
export type ActionResult<T = undefined> = { success: true; data: T } | { success: false; error: string };

function fromDomainError<T>(error: unknown, fallback: string): ActionResult<T> {
  if (error instanceof DomainError) {
    return { success: false, error: error.message };
  }
  console.error(error);
  return { success: false, error: fallback };
}

async function requireOwnPartnerId(): Promise<string> {
  const user = await requireAuth();
  const partner = await makeGetPartnerByUserIdUseCase().execute(user.id);
  if (!partner) {
    throw new NotFoundError("Partner", user.id);
  }
  return partner.id;
}

export async function createReferralLinkAction(input: {
  code: string;
  label?: string;
  source?: string;
}): Promise<ActionResult<ReferralCodeRecord>> {
  try {
    const partnerId = await requireOwnPartnerId();
    await makeAntiAbuseService().enforceRateLimit("REFERRAL_LINK_CREATE_BY_USER", { userId: partnerId }, "RATE_LIMIT_TRIGGERED");
    const link = await makeGeneratePartnerReferralLinkUseCase().execute({
      partnerId,
      code: input.code,
      label: input.label,
      source: input.source ?? null,
    });
    revalidatePath("/dashboard/partner");
    return { success: true, data: link };
  } catch (error) {
    return fromDomainError(error, "Something went wrong creating this referral link.");
  }
}

export async function setReferralLinkActiveAction(referralCodeId: string, isActive: boolean): Promise<ActionResult> {
  try {
    const partnerId = await requireOwnPartnerId();
    await makeSetReferralCodeActiveUseCase().execute({ partnerId, referralCodeId, isActive });
    revalidatePath("/dashboard/partner");
    return { success: true, data: undefined };
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      // Never confirm to the caller whether the id belongs to someone
      // else vs. doesn't exist — same generic-failure convention as an
      // IDOR-adjacent check anywhere else in this codebase.
      return { success: false, error: "Something went wrong updating this referral link." };
    }
    return fromDomainError(error, "Something went wrong updating this referral link.");
  }
}
