"use server";

import { revalidatePath } from "next/cache";

import { leadAdminActionFailure } from "./_lib/lead-action-errors";
import {
  adminAbuseSubjectSchema,
  adminLeadIdSchema,
  decideClaimSchema,
  imposeAbuseBlockSchema,
  liftAbuseDecisionSchema,
  listAdminLeadClaimsSchema,
  listAdminLeadDisputesSchema,
  listAdminLeadsSchema,
  revokePurchaseSchema,
  startClaimReviewSchema,
} from "@/application/dto/lead-admin-console.dto";
import {
  makeGetAdminAbuseSubjectUseCase,
  makeGetAdminLeadDetailUseCase,
  makeListAdminLeadClaimsUseCase,
  makeListAdminLeadDisputesUseCase,
  makeListAdminLeadsUseCase,
} from "@/application/use-cases/lead-admin-console/compose";
import type {
  AdminAbuseSubjectView,
  AdminLeadDetailView,
} from "@/application/use-cases/lead-admin-console/lead-admin-console.use-cases";
import { makeImposeLeadAbuseBlockUseCase, makeLiftLeadAbuseDecisionUseCase, makeListOpenLeadAbuseFlagsUseCase } from "@/application/use-cases/lead-abuse/compose";
import type { LeadAbuseDecisionDTO } from "@/application/use-cases/lead-abuse/admin-lead-abuse.use-cases";
import { makeRevokeLeadPurchaseUseCase } from "@/application/use-cases/lead-fee-dispute/compose";
import { makeDecideLeadQualityClaimUseCase, makeStartLeadQualityClaimReviewUseCase } from "@/application/use-cases/lead-quality-claim/compose";
import type { AdminClaimQueueRow, AdminDisputeQueueRow, AdminLeadListRow } from "@/domain/repositories/lead-admin-console-reader";
import { ROLES, requireRole } from "@/infrastructure/auth/rbac";
import { localizeZodError } from "@/presentation/i18n/server";

/**
 * Module 157 — Lead Admin Operations Console: the administrator boundary.
 *
 * Discipline, identical for every export below:
 *  1. `requireRole(ADMIN, SUPER_ADMIN)` is the FIRST statement (it also re-verifies the admin against the database), for reads and
 *     mutations alike. SUPPORT is not allowed: the console exposes claim decisions, revocation and abuse blocks, and the M154/M155/M156
 *     use cases already refuse any actor that is not ADMIN/SUPER_ADMIN.
 *  2. The acting administrator is `admin.id` from the session — never a client-supplied value. Input schemas have no actor field.
 *  3. Input is Zod-validated here and validated again by the use case.
 *  4. Mutations call the EXISTING M154 / M155 / M156 use cases and nothing else. This file holds no business rule, no state machine and
 *     no audit write: separation of duties, status-conditional (race-safe) writes and the atomic audit entry live in those use cases.
 *  5. Failures become a localized, closed message (see `leadAdminActionFailure`); no database error or stack ever reaches the browser.
 *
 * Read actions return plain server data meant for Server Components. Mutation actions return `{ success }` only.
 */
export type LeadAdminActionResult<T = undefined> = { success: true; data: T } | { success: false; error: string };

const LEADS_PATH = "/admin/leads";
const refresh = () => revalidatePath(LEADS_PATH, "layout");

// ------------------------------------------------------------------ reads

export async function listAdminLeadsAction(input: Record<string, unknown> = {}): Promise<LeadAdminActionResult<AdminLeadListRow[]>> {
  const admin = await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
  const parsed = listAdminLeadsSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: await localizeZodError(parsed.error) };
  try {
    return { success: true, data: await makeListAdminLeadsUseCase().execute(admin.id, parsed.data) };
  } catch (error) {
    return leadAdminActionFailure(error, "loadingLeads");
  }
}

export async function getAdminLeadDetailAction(leadId: string): Promise<LeadAdminActionResult<AdminLeadDetailView>> {
  const admin = await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
  const parsed = adminLeadIdSchema.safeParse({ leadId });
  if (!parsed.success) return { success: false, error: await localizeZodError(parsed.error) };
  try {
    return { success: true, data: await makeGetAdminLeadDetailUseCase().execute(admin.id, parsed.data.leadId) };
  } catch (error) {
    return leadAdminActionFailure(error, "loadingThisLead");
  }
}

export async function listAdminLeadClaimsAction(input: Record<string, unknown> = {}): Promise<LeadAdminActionResult<AdminClaimQueueRow[]>> {
  const admin = await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
  const parsed = listAdminLeadClaimsSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: await localizeZodError(parsed.error) };
  try {
    return { success: true, data: await makeListAdminLeadClaimsUseCase().execute(admin.id, parsed.data) };
  } catch (error) {
    return leadAdminActionFailure(error, "loadingLeadClaims");
  }
}

export async function listAdminLeadDisputesAction(input: Record<string, unknown> = {}): Promise<LeadAdminActionResult<AdminDisputeQueueRow[]>> {
  const admin = await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
  const parsed = listAdminLeadDisputesSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: await localizeZodError(parsed.error) };
  try {
    return { success: true, data: await makeListAdminLeadDisputesUseCase().execute(admin.id, parsed.data) };
  } catch (error) {
    return leadAdminActionFailure(error, "loadingLeadDisputes");
  }
}

export async function listOpenLeadAbuseFlagsAction(): Promise<LeadAdminActionResult<LeadAbuseDecisionDTO[]>> {
  const admin = await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
  try {
    return { success: true, data: await makeListOpenLeadAbuseFlagsUseCase().execute(admin.id, 100) };
  } catch (error) {
    return leadAdminActionFailure(error, "loadingAbuseFlags");
  }
}

export async function getAdminAbuseSubjectAction(subjectUserId: string): Promise<LeadAdminActionResult<AdminAbuseSubjectView>> {
  const admin = await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
  const parsed = adminAbuseSubjectSchema.safeParse({ subjectUserId });
  if (!parsed.success) return { success: false, error: await localizeZodError(parsed.error) };
  try {
    return { success: true, data: await makeGetAdminAbuseSubjectUseCase().execute(admin.id, parsed.data.subjectUserId) };
  } catch (error) {
    return leadAdminActionFailure(error, "loadingAbuseSubject");
  }
}

// ------------------------------------------------------------------ mutations (M154 / M155 / M156 use cases)

/** M154 `StartLeadQualityClaimReviewUseCase`: SUBMITTED -> UNDER_REVIEW. */
export async function startLeadClaimReviewAction(claimId: string): Promise<LeadAdminActionResult> {
  const admin = await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
  const parsed = startClaimReviewSchema.safeParse({ claimId });
  if (!parsed.success) return { success: false, error: await localizeZodError(parsed.error) };
  try {
    await makeStartLeadQualityClaimReviewUseCase().execute(admin.id, parsed.data.claimId);
    refresh();
    return { success: true, data: undefined };
  } catch (error) {
    return leadAdminActionFailure(error, "reviewingThisLeadClaim");
  }
}

/** M154 `DecideLeadQualityClaimUseCase`: APPROVED | REJECTED, a DECISION only (no refund is created or implied). */
export async function decideLeadClaimAction(input: { claimId: string; decision: string; explanation: string }): Promise<LeadAdminActionResult> {
  const admin = await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
  const parsed = decideClaimSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: await localizeZodError(parsed.error) };
  try {
    await makeDecideLeadQualityClaimUseCase().execute(admin.id, parsed.data);
    refresh();
    return { success: true, data: undefined };
  } catch (error) {
    return leadAdminActionFailure(error, "decidingThisLeadClaim");
  }
}

/** M155 `RevokeLeadPurchaseUseCase`: CONFIRMED -> REVOKED without refund (access withdrawn at once). */
export async function revokeLeadPurchaseAction(input: { leadPurchaseId: string; explanation: string; evidenceReference: string }): Promise<LeadAdminActionResult> {
  const admin = await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
  const parsed = revokePurchaseSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: await localizeZodError(parsed.error) };
  try {
    await makeRevokeLeadPurchaseUseCase().execute({ actorUserId: admin.id, ...parsed.data });
    refresh();
    return { success: true, data: undefined };
  } catch (error) {
    return leadAdminActionFailure(error, "revokingThisLeadPurchase");
  }
}

/** M156 `ImposeLeadAbuseBlockUseCase`: one temporary block of ONE action for ONE account (effective only while the rollout mode is ENFORCE). */
export async function imposeLeadAbuseBlockAction(input: {
  subjectUserId: string;
  restrictedAction: string;
  durationMinutes: number;
  explanation: string;
}): Promise<LeadAdminActionResult> {
  const admin = await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
  const parsed = imposeAbuseBlockSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: await localizeZodError(parsed.error) };
  try {
    await makeImposeLeadAbuseBlockUseCase().execute(admin.id, {
      subjectUserId: parsed.data.subjectUserId,
      restrictedAction: parsed.data.restrictedAction,
      durationMs: parsed.data.durationMinutes * 60_000,
      explanation: parsed.data.explanation,
    });
    refresh();
    return { success: true, data: undefined };
  } catch (error) {
    return leadAdminActionFailure(error, "blockingThisSubject");
  }
}

/** M156 `LiftLeadAbuseDecisionUseCase`: lifts a block or resolves a review flag ("unflag"), with a mandatory note. */
export async function liftLeadAbuseDecisionAction(input: { decisionId: string; note: string }): Promise<LeadAdminActionResult> {
  const admin = await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
  const parsed = liftAbuseDecisionSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: await localizeZodError(parsed.error) };
  try {
    await makeLiftLeadAbuseDecisionUseCase().execute(admin.id, parsed.data);
    refresh();
    return { success: true, data: undefined };
  } catch (error) {
    return leadAdminActionFailure(error, "liftingThisAbuseDecision");
  }
}
