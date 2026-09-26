"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";

import { createCompanySchema, updateCompanySchema } from "@/application/dto/company.dto";
import {
  makeCreateCompanyUseCase,
  makeGetCompanyForMemberUseCase,
  makeUpdateCompanyUseCase,
} from "@/application/use-cases/company/compose";
import type { CompanyRecord } from "@/domain/repositories/company-repository";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { localizeActionError, localizeZodError } from "@/presentation/i18n/server";

/**
 * Module 18 — Company Professional: thin Server Action adapters for
 * company creation/profile management — same pattern as every other
 * module's actions.ts. `userId` always comes from the session; `companyId`
 * identifies the target company but ownership/role is always re-derived
 * server-side inside the use case (resolveCompanyActor), never trusted from
 * the client.
 */

export type ActionResult<T = undefined> = { success: true; data: T } | { success: false; error: string };

async function fromDomainError<T>(error: unknown, fallback: string): Promise<ActionResult<T>> {
  return { success: false, error: await localizeActionError(error, fallback) };
}

function formToInput(formData: FormData) {
  const raw = Object.fromEntries(formData.entries());
  const categoryIds = formData.getAll("categoryIds").map(String);
  return { ...raw, categoryIds: categoryIds.length ? categoryIds : undefined };
}

export async function createCompanyAction(formData: FormData): Promise<ActionResult<CompanyRecord>> {
  const user = await requireAuth();
  const parsed = createCompanySchema.safeParse(formToInput(formData));
  if (!parsed.success) {
    const t = await getTranslations("company.errors");
    return { success: false, error: await localizeZodError(parsed.error, t("invalidDetails")) };
  }
  try {
    const company = await makeCreateCompanyUseCase().execute(user.id, parsed.data);
    revalidatePath("/dashboard/company");
    return { success: true, data: company };
  } catch (error) {
    const t = await getTranslations("company.errors");
    return fromDomainError(error, t("createFailed"));
  }
}

export async function updateCompanyAction(companyId: string, formData: FormData): Promise<ActionResult<CompanyRecord>> {
  const user = await requireAuth();
  const parsed = updateCompanySchema.safeParse(formToInput(formData));
  if (!parsed.success) {
    const t = await getTranslations("company.errors");
    return { success: false, error: await localizeZodError(parsed.error, t("invalidDetails")) };
  }
  try {
    const company = await makeUpdateCompanyUseCase().execute(user.id, companyId, parsed.data);
    revalidatePath(`/dashboard/company/${companyId}/profile`);
    return { success: true, data: company };
  } catch (error) {
    const t = await getTranslations("company.errors");
    return fromDomainError(error, t("updateFailed"));
  }
}

export async function getCompanyForMemberAction(companyId: string): Promise<ActionResult<CompanyRecord>> {
  const user = await requireAuth();
  try {
    const company = await makeGetCompanyForMemberUseCase().execute(user.id, companyId);
    return { success: true, data: company };
  } catch (error) {
    const t = await getTranslations("company.errors");
    return fromDomainError(error, t("loadFailed"));
  }
}

export async function updateCompanyFormAction(companyId: string, formData: FormData): Promise<void> {
  await updateCompanyAction(companyId, formData);
}

export async function createCompanyFormAction(formData: FormData): Promise<void> {
  await createCompanyAction(formData);
}
