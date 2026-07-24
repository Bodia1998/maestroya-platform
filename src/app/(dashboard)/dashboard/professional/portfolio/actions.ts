"use server";

import { revalidatePath } from "next/cache";

import { createPortfolioItemSchema, updatePortfolioItemSchema } from "@/application/dto/portfolio.dto";
import {
  makeCreatePortfolioItemUseCase,
  makeDeletePortfolioItemUseCase,
  makeUpdatePortfolioItemUseCase,
} from "@/application/use-cases/portfolio/compose";
import { DomainError } from "@/domain/errors/domain-error";
import { requireAuth } from "@/infrastructure/auth/rbac";

export type ActionResult =
  | { success: true }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

// Same translation convention as every other module's actions.ts (see
// reviews/actions.ts, dashboard/professional/actions.ts): domain errors
// surface their own safe, user-facing message; anything else is logged
// server-side and replaced with a generic one.
function fromDomainError(error: unknown, fallback: string): ActionResult {
  if (error instanceof DomainError) {
    return { success: false, error: error.message };
  }
  console.error(error);
  return { success: false, error: fallback };
}

/**
 * Portfolio module (Module 14): thin Server Action adapter — all business
 * logic (professional-profile ownership, field validation, deriving the
 * owner from the session) lives in CreatePortfolioItemUseCase, never here.
 * `professionalProfileId` is never accepted from the client — it is always
 * re-derived server-side from the authenticated session inside the use
 * case.
 */
export async function createPortfolioItemAction(formData: unknown): Promise<ActionResult> {
  const user = await requireAuth();

  const parsed = createPortfolioItemSchema.safeParse(formData);
  if (!parsed.success) {
    return {
      success: false,
      error: "Please fix the errors below.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  try {
    await makeCreatePortfolioItemUseCase().execute(user.id, {
      title: parsed.data.title,
      description: parsed.data.description ? parsed.data.description : null,
      mediaUrl: parsed.data.mediaUrl,
      serviceCategoryId: parsed.data.serviceCategoryId ? parsed.data.serviceCategoryId : null,
    });
    revalidatePath("/dashboard/professional/portfolio");
    return { success: true };
  } catch (error) {
    return fromDomainError(error, "Something went wrong creating this portfolio item.");
  }
}

/**
 * Ownership is re-checked inside UpdatePortfolioItemUseCase against the
 * caller's own ProfessionalProfile — `portfolioItemId` alone is never
 * treated as proof of ownership.
 */
export async function updatePortfolioItemAction(portfolioItemId: string, formData: unknown): Promise<ActionResult> {
  const user = await requireAuth();

  const parsed = updatePortfolioItemSchema.safeParse(formData);
  if (!parsed.success) {
    return {
      success: false,
      error: "Please fix the errors below.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  try {
    await makeUpdatePortfolioItemUseCase().execute(user.id, portfolioItemId, {
      title: parsed.data.title,
      description: parsed.data.description ? parsed.data.description : null,
      mediaUrl: parsed.data.mediaUrl,
      serviceCategoryId: parsed.data.serviceCategoryId ? parsed.data.serviceCategoryId : null,
    });
    revalidatePath("/dashboard/professional/portfolio");
    return { success: true };
  } catch (error) {
    return fromDomainError(error, "Something went wrong updating this portfolio item.");
  }
}

export async function deletePortfolioItemAction(portfolioItemId: string): Promise<ActionResult> {
  const user = await requireAuth();

  try {
    await makeDeletePortfolioItemUseCase().execute(user.id, portfolioItemId);
    revalidatePath("/dashboard/professional/portfolio");
    return { success: true };
  } catch (error) {
    return fromDomainError(error, "Something went wrong deleting this portfolio item.");
  }
}
