"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import type { ZodError } from "zod";

import { createPortfolioItemSchema, updatePortfolioItemSchema } from "@/application/dto/portfolio.dto";
import {
  makeCreatePortfolioItemUseCase,
  makeDeletePortfolioItemUseCase,
  makeUpdatePortfolioItemUseCase,
} from "@/application/use-cases/portfolio/compose";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { localizeActionError, localizeZodFieldErrors } from "@/presentation/i18n/server";

export type ActionResult =
  | { success: true }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

// Module 120 — errors are localised at the edge (`localizeActionError`):
// domain errors map to their catalog sentence, anything else is logged
// server-side and replaced with the localised fallback.
type FallbackKey =
  | "createPortfolioItem"
  | "updatePortfolioItem"
  | "deletePortfolioItem";

async function fromDomainError(error: unknown, fallbackKey: FallbackKey): Promise<ActionResult> {
  const t = await getTranslations("professional.errors");
  return { success: false, error: await localizeActionError(error, t(fallbackKey)) };
}

async function invalid(error: ZodError): Promise<ActionResult> {
  const t = await getTranslations("professional.errors");
  return {
    success: false,
    error: t("fixErrors"),
    fieldErrors: await localizeZodFieldErrors(error),
  };
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
    return invalid(parsed.error);
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
    return fromDomainError(error, "createPortfolioItem");
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
    return invalid(parsed.error);
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
    return fromDomainError(error, "updatePortfolioItem");
  }
}

export async function deletePortfolioItemAction(portfolioItemId: string): Promise<ActionResult> {
  const user = await requireAuth();

  try {
    await makeDeletePortfolioItemUseCase().execute(user.id, portfolioItemId);
    revalidatePath("/dashboard/professional/portfolio");
    return { success: true };
  } catch (error) {
    return fromDomainError(error, "deletePortfolioItem");
  }
}
