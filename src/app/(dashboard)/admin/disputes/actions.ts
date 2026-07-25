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
import { DomainError } from "@/domain/errors/domain-error";
import type { DisputeRecord } from "@/domain/repositories/dispute-repository";
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
