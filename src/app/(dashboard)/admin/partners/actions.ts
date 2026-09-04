"use server";

import { revalidatePath } from "next/cache";

import {
  makeApprovePartnerUseCase,
  makeBanPartnerUseCase,
  makeApproveAffiliateCommissionUseCase,
  makeCancelAffiliateCommissionUseCase,
  makeCreatePartnerPayoutUseCase,
  makeGetAdminPartnerAuditUseCase,
  makeListAdminPartnersUseCase,
  makeRejectPartnerUseCase,
  makeSuspendPartnerUseCase,
  getPartnerFraudFlagsRepository,
} from "@/application/use-cases/affiliate/compose";
import type { PartnerAudit } from "@/application/use-cases/affiliate/get-admin-partner-audit.use-case";
import type { PartnerPayoutRecord } from "@/domain/repositories/partner-payout-repository";
import { DomainError } from "@/domain/errors/domain-error";
import type { AffiliateCommissionRecord } from "@/domain/repositories/affiliate-commission-repository";
import type { PartnerFraudFlagRecord } from "@/domain/repositories/partner-fraud-flag-repository";
import type { PartnerRecord, PartnerStatusValue } from "@/domain/repositories/partner-repository";
import { ROLES, requireRole } from "@/infrastructure/auth/rbac";
import { makeAntiAbuseService } from "@/application/use-cases/security/compose";

/**
 * Module 96 — Referral & Affiliate Production Wiring: admin Server Action
 * adapters for the referral/affiliate domain — same "requireRole first,
 * business logic in the use case, actor id always session-derived" house
 * discipline as `admin/companies/actions.ts`/`admin/disputes/actions.ts`.
 *
 * Every action here is ADMIN/SUPER_ADMIN only (never SUPPORT) — these are
 * financial actions (approving/cancelling a commission, banning a
 * partner, resolving a fraud flag), and `requireRole` re-verifies the
 * caller's role against the database on every single call whenever an
 * admin-tier role is requested (see that function's own doc comment) —
 * never trusting the session/JWT role claim alone, per the module spec's
 * explicit requirement for privileged financial actions.
 */
export type ActionResult<T = undefined> = { success: true; data: T } | { success: false; error: string };

function fromDomainError<T>(error: unknown, fallback: string): ActionResult<T> {
  if (error instanceof DomainError) {
    return { success: false, error: error.message };
  }
  console.error(error);
  return { success: false, error: fallback };
}

export async function listAdminPartnersAction(status?: PartnerStatusValue): Promise<ActionResult<PartnerRecord[]>> {
  await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
  try {
    const partners = await makeListAdminPartnersUseCase().execute(status ? { status } : undefined);
    return { success: true, data: partners };
  } catch (error) {
    return fromDomainError(error, "Something went wrong loading partners.");
  }
}

export async function getAdminPartnerAuditAction(partnerId: string): Promise<ActionResult<PartnerAudit>> {
  await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
  try {
    const audit = await makeGetAdminPartnerAuditUseCase().execute(partnerId);
    return { success: true, data: audit };
  } catch (error) {
    return fromDomainError(error, "Something went wrong loading this partner.");
  }
}

export async function approvePartnerAction(partnerId: string): Promise<ActionResult<PartnerRecord>> {
  const admin = await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
  try {
    await makeAntiAbuseService().enforceRateLimit("ADMIN_PARTNER_MUTATION_BY_USER", { userId: admin.id }, "RATE_LIMIT_TRIGGERED");
    const partner = await makeApprovePartnerUseCase().execute({ partnerId, adminUserId: admin.id });
    revalidatePath("/admin/partners");
    revalidatePath(`/admin/partners/${partnerId}`);
    return { success: true, data: partner };
  } catch (error) {
    return fromDomainError(error, "Something went wrong approving this partner.");
  }
}

export async function rejectPartnerAction(partnerId: string, reason: string): Promise<ActionResult<PartnerRecord>> {
  const admin = await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
  try {
    await makeAntiAbuseService().enforceRateLimit("ADMIN_PARTNER_MUTATION_BY_USER", { userId: admin.id }, "RATE_LIMIT_TRIGGERED");
    const partner = await makeRejectPartnerUseCase().execute({ partnerId, adminUserId: admin.id, reason });
    revalidatePath("/admin/partners");
    revalidatePath(`/admin/partners/${partnerId}`);
    return { success: true, data: partner };
  } catch (error) {
    return fromDomainError(error, "Something went wrong rejecting this partner.");
  }
}

export async function suspendPartnerAction(partnerId: string, reason: string): Promise<ActionResult<PartnerRecord>> {
  const admin = await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
  try {
    await makeAntiAbuseService().enforceRateLimit("ADMIN_PARTNER_MUTATION_BY_USER", { userId: admin.id }, "RATE_LIMIT_TRIGGERED");
    const partner = await makeSuspendPartnerUseCase().execute({ partnerId, adminUserId: admin.id, reason });
    revalidatePath("/admin/partners");
    revalidatePath(`/admin/partners/${partnerId}`);
    return { success: true, data: partner };
  } catch (error) {
    return fromDomainError(error, "Something went wrong suspending this partner.");
  }
}

export async function banPartnerAction(partnerId: string, reason: string): Promise<ActionResult<PartnerRecord>> {
  const admin = await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
  try {
    await makeAntiAbuseService().enforceRateLimit("ADMIN_PARTNER_MUTATION_BY_USER", { userId: admin.id }, "RATE_LIMIT_TRIGGERED");
    const partner = await makeBanPartnerUseCase().execute({ partnerId, adminUserId: admin.id, reason });
    revalidatePath("/admin/partners");
    revalidatePath(`/admin/partners/${partnerId}`);
    return { success: true, data: partner };
  } catch (error) {
    return fromDomainError(error, "Something went wrong banning this partner.");
  }
}

export async function approveAffiliateCommissionAction(
  commissionId: string,
  partnerId: string,
): Promise<ActionResult<AffiliateCommissionRecord>> {
  const admin = await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
  try {
    await makeAntiAbuseService().enforceRateLimit("ADMIN_PARTNER_MUTATION_BY_USER", { userId: admin.id }, "RATE_LIMIT_TRIGGERED");
    const commission = await makeApproveAffiliateCommissionUseCase().execute(commissionId);
    revalidatePath(`/admin/partners/${partnerId}`);
    return { success: true, data: commission };
  } catch (error) {
    return fromDomainError(error, "Something went wrong approving this commission.");
  }
}

export async function cancelAffiliateCommissionAction(
  commissionId: string,
  partnerId: string,
  reason: string,
): Promise<ActionResult<AffiliateCommissionRecord>> {
  const admin = await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
  try {
    await makeAntiAbuseService().enforceRateLimit("ADMIN_PARTNER_MUTATION_BY_USER", { userId: admin.id }, "RATE_LIMIT_TRIGGERED");
    const commission = await makeCancelAffiliateCommissionUseCase().execute({ id: commissionId, reason });
    revalidatePath(`/admin/partners/${partnerId}`);
    return { success: true, data: commission };
  } catch (error) {
    return fromDomainError(error, "Something went wrong cancelling this commission.");
  }
}

export async function createPartnerPayoutAction(
  partnerId: string,
  periodStart: string,
  periodEnd: string,
): Promise<ActionResult<PartnerPayoutRecord>> {
  const admin = await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
  try {
    // Module 96: its own, tighter budget — see PARTNER_PAYOUT_CREATE_BY_USER's
    // own doc comment (rate-limit-policies.ts) for why this is separate
    // from ADMIN_PARTNER_MUTATION_BY_USER.
    await makeAntiAbuseService().enforceRateLimit("PARTNER_PAYOUT_CREATE_BY_USER", { userId: admin.id }, "RATE_LIMIT_TRIGGERED");
    const start = new Date(periodStart);
    const end = new Date(periodEnd);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
      return { success: false, error: "Enter a valid payout period (start on or before end)." };
    }
    // partnerId is the only identifier this action ever passes to the use
    // case — the Stripe Connect destination it eventually transfers to is
    // resolved *inside* the use case exclusively from this partner's own
    // `payoutDetails`, never from anything supplied here, so there is no
    // parameter through which one partner's payout could be redirected to
    // another partner's account.
    const payout = await makeCreatePartnerPayoutUseCase().execute({ partnerId, periodStart: start, periodEnd: end });
    revalidatePath(`/admin/partners/${partnerId}`);
    return { success: true, data: payout };
  } catch (error) {
    return fromDomainError(error, "Something went wrong creating this payout.");
  }
}

export async function resolveFraudFlagAction(
  flagId: string,
  partnerId: string,
  status: "REVIEWED" | "DISMISSED" | "CONFIRMED",
  resolution: string,
): Promise<ActionResult<PartnerFraudFlagRecord>> {
  const admin = await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
  try {
    await makeAntiAbuseService().enforceRateLimit("ADMIN_PARTNER_MUTATION_BY_USER", { userId: admin.id }, "RATE_LIMIT_TRIGGERED");
    const flag = await getPartnerFraudFlagsRepository().resolve(flagId, { status, resolvedByUserId: admin.id, resolution });
    revalidatePath(`/admin/partners/${partnerId}`);
    return { success: true, data: flag };
  } catch (error) {
    return fromDomainError(error, "Something went wrong resolving this fraud flag.");
  }
}

// --- Form-bindable wrappers (see admin/companies/actions.ts for the rationale) ---

export async function approvePartnerFormAction(partnerId: string): Promise<void> {
  await approvePartnerAction(partnerId);
}

export async function rejectPartnerFormAction(partnerId: string, formData: FormData): Promise<void> {
  await rejectPartnerAction(partnerId, String(formData.get("reason") ?? ""));
}

export async function suspendPartnerFormAction(partnerId: string, formData: FormData): Promise<void> {
  await suspendPartnerAction(partnerId, String(formData.get("reason") ?? ""));
}

export async function banPartnerFormAction(partnerId: string, formData: FormData): Promise<void> {
  await banPartnerAction(partnerId, String(formData.get("reason") ?? ""));
}

export async function approveAffiliateCommissionFormAction(commissionId: string, partnerId: string): Promise<void> {
  await approveAffiliateCommissionAction(commissionId, partnerId);
}

export async function cancelAffiliateCommissionFormAction(
  commissionId: string,
  partnerId: string,
  formData: FormData,
): Promise<void> {
  await cancelAffiliateCommissionAction(commissionId, partnerId, String(formData.get("reason") ?? ""));
}

export async function createPartnerPayoutFormAction(partnerId: string, formData: FormData): Promise<void> {
  await createPartnerPayoutAction(partnerId, String(formData.get("periodStart") ?? ""), String(formData.get("periodEnd") ?? ""));
}

export async function resolveFraudFlagFormAction(
  flagId: string,
  partnerId: string,
  status: "REVIEWED" | "DISMISSED" | "CONFIRMED",
  formData: FormData,
): Promise<void> {
  await resolveFraudFlagAction(flagId, partnerId, status, String(formData.get("resolution") ?? ""));
}
