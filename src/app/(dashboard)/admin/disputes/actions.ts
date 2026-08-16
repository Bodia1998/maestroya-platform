"use server";

import { revalidatePath } from "next/cache";

import {
  addDisputeInternalNoteSchema,
  assignDisputeSchema,
  changeDisputeStatusSchema,
  closeDisputeSchema,
  listAdminDisputesSchema,
  rejectDisputeSchema,
  resolveDisputeSchema,
  resolveDisputeWithFinancialOutcomeSchema,
} from "@/application/dto/dispute.dto";
import {
  makeAddDisputeInternalNoteUseCase,
  makeAssignDisputeUseCase,
  makeChangeDisputeStatusUseCase,
  makeCloseDisputeUseCase,
  makeGetAdminDisputeUseCase,
  makeListAdminDisputesUseCase,
  makeRejectDisputeUseCase,
  makeResolveDisputeUseCase,
} from "@/application/use-cases/dispute/compose";
import { makeResolveDisputeWithFinancialOutcomeUseCase } from "@/application/use-cases/dispute-resolution/compose";
import { DomainError } from "@/domain/errors/domain-error";
import type { DisputeRecord } from "@/domain/repositories/dispute-repository";
import type { DisputeResolutionDecisionRecord } from "@/domain/repositories/dispute-resolution-decision-repository";
import type { AdminDisputeDetail } from "@/application/use-cases/dispute/get-admin-dispute.use-case";
import { ROLES, requireRole } from "@/infrastructure/auth/rbac";

/**
 * Module 21 — Disputes & Support: admin Server Action adapters — same
 * "requireRole first, business logic in the use case" convention as
 * admin/actions.ts. Every action requires ADMIN/SUPER_ADMIN/SUPPORT.
 */
export type ActionResult<T = undefined> = { success: true; data: T } | { success: false; error: string };

function fromDomainError<T>(error: unknown, fallback: string): ActionResult<T> {
  if (error instanceof DomainError) {
    return { success: false, error: error.message };
  }
  console.error(error);
  return { success: false, error: fallback };
}

export async function listAdminDisputesAction(
  input: Record<string, unknown> = {},
): Promise<ActionResult<DisputeRecord[]>> {
  await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.SUPPORT);
  const parsed = listAdminDisputesSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }
  try {
    const disputes = await makeListAdminDisputesUseCase().execute(parsed.data);
    return { success: true, data: disputes };
  } catch (error) {
    return fromDomainError(error, "Something went wrong loading disputes.");
  }
}

export async function getAdminDisputeAction(disputeId: string): Promise<ActionResult<AdminDisputeDetail>> {
  await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.SUPPORT);
  try {
    const detail = await makeGetAdminDisputeUseCase().execute(disputeId);
    return { success: true, data: detail };
  } catch (error) {
    return fromDomainError(error, "Something went wrong loading this dispute.");
  }
}

export async function assignDisputeAction(disputeId: string, adminUserId: string | null): Promise<ActionResult<DisputeRecord>> {
  const admin = await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.SUPPORT);
  const parsed = assignDisputeSchema.safeParse({ disputeId, adminUserId });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }
  try {
    const dispute = await makeAssignDisputeUseCase().execute(admin.id, parsed.data.disputeId, parsed.data.adminUserId);
    revalidatePath(`/admin/disputes/${disputeId}`);
    return { success: true, data: dispute };
  } catch (error) {
    return fromDomainError(error, "Something went wrong assigning this dispute.");
  }
}

export async function changeDisputeStatusAction(disputeId: string, status: string): Promise<ActionResult<DisputeRecord>> {
  const admin = await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.SUPPORT);
  const parsed = changeDisputeStatusSchema.safeParse({ disputeId, status });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }
  try {
    const dispute = await makeChangeDisputeStatusUseCase().execute(admin.id, parsed.data.disputeId, parsed.data.status);
    revalidatePath(`/admin/disputes/${disputeId}`);
    return { success: true, data: dispute };
  } catch (error) {
    return fromDomainError(error, "Something went wrong changing this dispute's status.");
  }
}

export async function addDisputeInternalNoteAction(disputeId: string, body: string): Promise<ActionResult> {
  const admin = await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.SUPPORT);
  const parsed = addDisputeInternalNoteSchema.safeParse({ disputeId, body });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid note." };
  }
  try {
    await makeAddDisputeInternalNoteUseCase().execute(admin.id, parsed.data.disputeId, parsed.data.body);
    revalidatePath(`/admin/disputes/${disputeId}`);
    return { success: true, data: undefined };
  } catch (error) {
    return fromDomainError(error, "Something went wrong adding this note.");
  }
}

export async function resolveDisputeAction(
  disputeId: string,
  resolution: string,
  resolutionNote: string,
): Promise<ActionResult<DisputeRecord>> {
  const admin = await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.SUPPORT);
  const parsed = resolveDisputeSchema.safeParse({ disputeId, resolution, resolutionNote });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid resolution." };
  }
  try {
    const dispute = await makeResolveDisputeUseCase().execute(admin.id, parsed.data.disputeId, {
      resolution: parsed.data.resolution,
      resolutionNote: parsed.data.resolutionNote,
    });
    revalidatePath(`/admin/disputes/${disputeId}`);
    return { success: true, data: dispute };
  } catch (error) {
    return fromDomainError(error, "Something went wrong resolving this dispute.");
  }
}

export async function rejectDisputeAction(disputeId: string, resolutionNote: string): Promise<ActionResult<DisputeRecord>> {
  const admin = await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.SUPPORT);
  const parsed = rejectDisputeSchema.safeParse({ disputeId, resolutionNote });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid rejection." };
  }
  try {
    const dispute = await makeRejectDisputeUseCase().execute(admin.id, parsed.data.disputeId, parsed.data.resolutionNote);
    revalidatePath(`/admin/disputes/${disputeId}`);
    return { success: true, data: dispute };
  } catch (error) {
    return fromDomainError(error, "Something went wrong rejecting this dispute.");
  }
}

/**
 * Module 68 — Dispute Resolution & Financial Protection: the one atomic
 * admin action that resolves a Dispute AND determines/applies its
 * financial outcome together — see
 * `ResolveDisputeWithFinancialOutcomeUseCase`'s own doc comment. Prefer
 * this over the plain `resolveDisputeAction` above for any resolution that
 * needs a real financial consequence; `resolveDisputeAction` still exists
 * for `NO_ACTION`/`PROFESSIONAL_FAVOR`-only workflows that pre-date this
 * module and remain valid (see `disputeResolutionRequiresFinancialSettlementBeforeClose`).
 *
 * ## Module 70.1 — Pre-Stripe Security & Integration Hardening
 * (Objective E — segregation of duties)
 *
 * The Module 70 audit found `ROLES.SUPPORT` included in this action's
 * `requireRole` alongside `ADMIN`/`SUPER_ADMIN` — meaning a SUPPORT agent
 * could, on their own, both resolve a dispute AND directly trigger the
 * refund/commission-reversal financial adjustment that resolution
 * produces (`ResolveDisputeWithFinancialOutcomeUseCase` ->
 * `CreateFinancialAdjustmentUseCase` -> a real, signed ledger entry — see
 * that use case's own doc comment). Every other admin-side action in this
 * file that only *investigates or triages* a dispute (assign, add an
 * internal note, change status, the non-financial `resolveDisputeAction`
 * for `NO_ACTION`/`PROFESSIONAL_FAVOR`-only outcomes, close) intentionally
 * keeps SUPPORT — this module's decision narrows only the one action that
 * *authorizes a financial outcome*, per the module brief's explicit
 * preference for ADMIN/SUPER_ADMIN on financial-authorization actions.
 *
 * Decision: **SUPPORT loses this specific authority.** Rationale:
 *  - SUPPORT already has full triage authority — they can investigate,
 *    assign, note, and even resolve a dispute with no financial outcome.
 *    They lose only the ability to *also* be the one who authorizes real
 *    money movement for their own resolution, restoring a two-role
 *    separation between "who investigates/decides the dispute" and "who
 *    authorizes the resulting financial adjustment" for the highest-risk
 *    action in this file — the one Module 71 (Stripe Connect) will
 *    eventually make trigger a real payout-affecting ledger entry.
 *  - `ResolveDisputeWithFinancialOutcomeUseCase` already writes a full
 *    audit trail via `DisputeResolutionDecision`/the financial ledger's
 *    own append-only `Transaction` rows (Module 68/22) regardless of who
 *    calls it — narrowing the caller role adds a preventive control on
 *    top of the existing detective one, rather than replacing it.
 *  - No use-case-level assumption changes: `ResolveDisputeWithFinancialOutcomeUseCase`
 *    itself takes an already-authorized `adminUserId` and does not read
 *    or care about the caller's role — this fix is entirely at the
 *    Server Action's authorization boundary, exactly where every other
 *    role check in this codebase already lives.
 */
export async function resolveDisputeWithFinancialOutcomeAction(
  input: Record<string, unknown>,
): Promise<ActionResult<DisputeResolutionDecisionRecord>> {
  const admin = await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
  const parsed = resolveDisputeWithFinancialOutcomeSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid resolution." };
  }
  try {
    const decision = await makeResolveDisputeWithFinancialOutcomeUseCase().execute(admin.id, parsed.data.disputeId, {
      resolution: parsed.data.resolution,
      resolutionNote: parsed.data.resolutionNote,
      requestedAmount: parsed.data.requestedAmount ?? null,
      requestedAdjustmentType: parsed.data.requestedAdjustmentType ?? null,
    });
    revalidatePath(`/admin/disputes/${parsed.data.disputeId}`);
    return { success: true, data: decision };
  } catch (error) {
    return fromDomainError(error, "Something went wrong resolving this dispute's financial outcome.");
  }
}

export async function closeDisputeAction(disputeId: string): Promise<ActionResult<DisputeRecord>> {
  const admin = await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.SUPPORT);
  const parsed = closeDisputeSchema.safeParse({ disputeId });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }
  try {
    const dispute = await makeCloseDisputeUseCase().execute(admin.id, parsed.data.disputeId);
    revalidatePath(`/admin/disputes/${disputeId}`);
    return { success: true, data: dispute };
  } catch (error) {
    return fromDomainError(error, "Something went wrong closing this dispute.");
  }
}
