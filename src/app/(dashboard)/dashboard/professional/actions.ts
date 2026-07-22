"use server";

import { revalidatePath } from "next/cache";

import { DomainError } from "@/domain/errors/domain-error";
import { requireAuth } from "@/infrastructure/auth/rbac";
import {
  createProfessionalSchema,
  deactivateProfessionalSchema,
  updateProfessionalSchema,
  updateProfessionalServicesSchema,
} from "@/application/dto/professional.dto";
import {
  makeCreateProfessionalUseCase,
  makeDeactivateProfessionalUseCase,
  makeUpdateProfessionalServicesUseCase,
  makeUpdateProfessionalUseCase,
} from "@/application/use-cases/professional/compose";

export type ActionResult =
  | { success: true }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

// Same translation convention as the Profile module's actions.ts: domain
// errors surface their own message (safe, user-facing by construction),
// anything else is logged server-side and replaced with a generic message
// so internals never leak to the client.
function fromDomainError(error: unknown, fallback: string): ActionResult {
  if (error instanceof DomainError) {
    return { success: false, error: error.message };
  }
  console.error(error);
  return { success: false, error: fallback };
}

export async function createProfessionalAction(formData: unknown): Promise<ActionResult> {
  const user = await requireAuth();

  const parsed = createProfessionalSchema.safeParse(formData);
  if (!parsed.success) {
    return {
      success: false,
      error: "Please fix the errors below.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  try {
    await makeCreateProfessionalUseCase().execute(user.id, parsed.data);
    revalidatePath("/dashboard/professional");
    return { success: true };
  } catch (error) {
    return fromDomainError(error, "Something went wrong creating your professional profile.");
  }
}

export async function updateProfessionalAction(formData: unknown): Promise<ActionResult> {
  const user = await requireAuth();

  const parsed = updateProfessionalSchema.safeParse(formData);
  if (!parsed.success) {
    return {
      success: false,
      error: "Please fix the errors below.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  try {
    await makeUpdateProfessionalUseCase().execute(user.id, parsed.data);
    revalidatePath("/dashboard/professional");
    return { success: true };
  } catch (error) {
    return fromDomainError(error, "Something went wrong updating your professional profile.");
  }
}

export async function updateProfessionalServicesAction(formData: unknown): Promise<ActionResult> {
  const user = await requireAuth();

  const parsed = updateProfessionalServicesSchema.safeParse(formData);
  if (!parsed.success) {
    return {
      success: false,
      error: "Please fix the errors below.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  try {
    await makeUpdateProfessionalServicesUseCase().execute(user.id, parsed.data);
    revalidatePath("/dashboard/professional");
    return { success: true };
  } catch (error) {
    return fromDomainError(error, "Something went wrong updating your service categories.");
  }
}

export async function deactivateProfessionalAction(formData: unknown): Promise<ActionResult> {
  const user = await requireAuth();

  const parsed = deactivateProfessionalSchema.safeParse(formData);
  if (!parsed.success) {
    return {
      success: false,
      error: "Please fix the errors below.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  try {
    await makeDeactivateProfessionalUseCase().execute(user.id);
    revalidatePath("/dashboard/professional");
    return { success: true };
  } catch (error) {
    return fromDomainError(error, "Something went wrong deactivating your professional profile.");
  }
}
