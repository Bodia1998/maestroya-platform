"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import type { ZodError } from "zod";

import { requireAuth } from "@/infrastructure/auth/rbac";
import {
  createProfessionalSchema,
  deactivateProfessionalSchema,
  professionalOnboardingSchema,
  updateProfessionalSchema,
  updateProfessionalServicesSchema,
} from "@/application/dto/professional.dto";
import {
  makeCompleteProfessionalOnboardingUseCase,
  makeCreateProfessionalUseCase,
  makeDeactivateProfessionalUseCase,
  makeUpdateProfessionalServicesUseCase,
  makeUpdateProfessionalUseCase,
} from "@/application/use-cases/professional/compose";
import { localizeActionError, localizeZodFieldErrors } from "@/presentation/i18n/server";

export type ActionResult =
  | { success: true }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

// Module 120 — errors are localised at the edge: domain errors map to
// their catalog sentence (`localizeActionError`), anything else is logged
// server-side and replaced with the caller's localised fallback so
// internals never leak to the client.
async function fromDomainError(error: unknown, fallbackKey: FallbackKey): Promise<ActionResult> {
  const t = await getTranslations("professional.errors");
  return { success: false, error: await localizeActionError(error, t(fallbackKey)) };
}

type FallbackKey =
  | "createProfile"
  | "onboarding"
  | "updateProfile"
  | "updateServices"
  | "deactivate";

async function invalid(error: ZodError): Promise<ActionResult> {
  const t = await getTranslations("professional.errors");
  return {
    success: false,
    error: t("fixErrors"),
    fieldErrors: await localizeZodFieldErrors(error),
  };
}

export async function createProfessionalAction(formData: unknown): Promise<ActionResult> {
  const user = await requireAuth();

  const parsed = createProfessionalSchema.safeParse(formData);
  if (!parsed.success) {
    return invalid(parsed.error);
  }

  try {
    await makeCreateProfessionalUseCase().execute(user.id, parsed.data);
    revalidatePath("/dashboard/professional");
    return { success: true };
  } catch (error) {
    return fromDomainError(error, "createProfile");
  }
}

/**
 * Professional Onboarding — the one action the onboarding form submits
 * to. Delegates entirely to `CompleteProfessionalOnboardingUseCase`,
 * which itself delegates profile creation (and the PROVIDER role grant
 * that comes with it) to the same `CreateProfessionalUseCase` the regular
 * professional dashboard's "create profile" form already uses — no
 * business logic is duplicated here or in that use case.
 */
export async function completeProfessionalOnboardingAction(
  formData: unknown,
): Promise<ActionResult> {
  const user = await requireAuth();

  const parsed = professionalOnboardingSchema.safeParse(formData);
  if (!parsed.success) {
    return invalid(parsed.error);
  }

  try {
    await makeCompleteProfessionalOnboardingUseCase().execute(user.id, parsed.data);
    revalidatePath("/dashboard/professional");
    revalidatePath("/dashboard/professional/onboarding");
    return { success: true };
  } catch (error) {
    return fromDomainError(error, "onboarding");
  }
}

export async function updateProfessionalAction(formData: unknown): Promise<ActionResult> {
  const user = await requireAuth();

  const parsed = updateProfessionalSchema.safeParse(formData);
  if (!parsed.success) {
    return invalid(parsed.error);
  }

  try {
    await makeUpdateProfessionalUseCase().execute(user.id, parsed.data);
    revalidatePath("/dashboard/professional");
    return { success: true };
  } catch (error) {
    return fromDomainError(error, "updateProfile");
  }
}

export async function updateProfessionalServicesAction(formData: unknown): Promise<ActionResult> {
  const user = await requireAuth();

  const parsed = updateProfessionalServicesSchema.safeParse(formData);
  if (!parsed.success) {
    return invalid(parsed.error);
  }

  try {
    await makeUpdateProfessionalServicesUseCase().execute(user.id, parsed.data);
    revalidatePath("/dashboard/professional");
    return { success: true };
  } catch (error) {
    return fromDomainError(error, "updateServices");
  }
}

export async function deactivateProfessionalAction(formData: unknown): Promise<ActionResult> {
  const user = await requireAuth();

  const parsed = deactivateProfessionalSchema.safeParse(formData);
  if (!parsed.success) {
    return invalid(parsed.error);
  }

  try {
    await makeDeactivateProfessionalUseCase().execute(user.id);
    revalidatePath("/dashboard/professional");
    return { success: true };
  } catch (error) {
    return fromDomainError(error, "deactivate");
  }
}
