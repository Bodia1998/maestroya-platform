"use server";

import { adminCompanyIdSchema, listAdminCompaniesSchema } from "@/application/dto/company.dto";
import {
  makeGetAdminCompanyUseCase,
  makeListAdminCompaniesUseCase,
  makeReactivateCompanyUseCase,
  makeSuspendCompanyUseCase,
} from "@/application/use-cases/admin/compose";
import { DomainError } from "@/domain/errors/domain-error";
import type { AdminCompanyRecord } from "@/domain/repositories/admin-repository";
import { ROLES, requireRole } from "@/infrastructure/auth/rbac";
import { revalidatePath } from "next/cache";

/**
 * Module 18 — Company Professional: admin company oversight Server Actions.
 * Same discipline as admin/actions.ts and admin/verifications/actions.ts —
 * every action calls requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN) first, and
 * every mutation's actor id is the session-derived admin, never client input.
 */

export type ActionResult<T = undefined> = { success: true; data: T } | { success: false; error: string };

function fromDomainError<T>(error: unknown, fallback: string): ActionResult<T> {
  if (error instanceof DomainError) {
    return { success: false, error: error.message };
  }
  console.error(error);
  return { success: false, error: fallback };
}

export async function listAdminCompaniesAction(
  input: { limit?: number; offset?: number; search?: string; status?: string } = {},
): Promise<ActionResult<AdminCompanyRecord[]>> {
  await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
  const parsed = listAdminCompaniesSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }
  try {
    const companies = await makeListAdminCompaniesUseCase().execute(parsed.data);
    return { success: true, data: companies };
  } catch (error) {
    return fromDomainError(error, "Something went wrong loading companies.");
  }
}

export async function getAdminCompanyAction(companyId: string): Promise<ActionResult<AdminCompanyRecord>> {
  await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
  const parsed = adminCompanyIdSchema.safeParse({ companyId });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid company." };
  }
  try {
    const company = await makeGetAdminCompanyUseCase().execute(parsed.data.companyId);
    return { success: true, data: company };
  } catch (error) {
    return fromDomainError(error, "Something went wrong loading this company.");
  }
}

export async function suspendCompanyAction(companyId: string): Promise<ActionResult<AdminCompanyRecord>> {
  const admin = await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
  const parsed = adminCompanyIdSchema.safeParse({ companyId });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid company." };
  }
  try {
    const company = await makeSuspendCompanyUseCase().execute(admin.id, parsed.data.companyId);
    revalidatePath("/admin/companies");
    revalidatePath(`/admin/companies/${parsed.data.companyId}`);
    return { success: true, data: company };
  } catch (error) {
    return fromDomainError(error, "Something went wrong suspending this company.");
  }
}

export async function reactivateCompanyAction(companyId: string): Promise<ActionResult<AdminCompanyRecord>> {
  const admin = await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
  const parsed = adminCompanyIdSchema.safeParse({ companyId });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid company." };
  }
  try {
    const company = await makeReactivateCompanyUseCase().execute(admin.id, parsed.data.companyId);
    revalidatePath("/admin/companies");
    revalidatePath(`/admin/companies/${parsed.data.companyId}`);
    return { success: true, data: company };
  } catch (error) {
    return fromDomainError(error, "Something went wrong reactivating this company.");
  }
}

// --- Form-bindable wrappers (see admin/actions.ts for the rationale) ---

export async function suspendCompanyFormAction(companyId: string): Promise<void> {
  await suspendCompanyAction(companyId);
}

export async function reactivateCompanyFormAction(companyId: string): Promise<void> {
  await reactivateCompanyAction(companyId);
}
