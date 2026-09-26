"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import type { ZodError } from "zod";

import { DomainError } from "@/domain/errors/domain-error";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { localizeActionError, localizeZodFieldErrors } from "@/presentation/i18n/server";
import { createQuoteSchema, updateQuoteSchema } from "@/application/dto/quote.dto";
import {
  makeCreateQuoteUseCase,
  makeGetProfessionalQuoteUseCase,
  makeUpdateQuoteUseCase,
  makeWithdrawQuoteUseCase,
} from "@/application/use-cases/quotes/compose";
import { makeAntiAbuseService } from "@/application/use-cases/security/compose";

export type ActionResult =
  | { success: true }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

export type CreateQuoteActionResult =
  | { success: true; id: string }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

// Module 120 — errors are localised at the edge (`localizeActionError`):
// domain errors map to their catalog sentence, anything else is logged
// server-side and replaced with the localised fallback.
type FallbackKey =
  | "submitQuote"
  | "updateQuote"
  | "withdrawQuote";

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
 * Marketplace abuse (Module 24, threat C) — quote spam across many
 * service requests. CreateQuoteUseCase already rejects a *second* quote
 * on the *same* request (ConflictError, see its own doc comment); this
 * adds the complementary per-professional frequency guard across
 * *different* requests (see rate-limit-policies.ts's QUOTE_CREATE_BY_USER).
 */
export async function createQuoteAction(
  requestId: string,
  formData: unknown,
): Promise<CreateQuoteActionResult> {
  const user = await requireAuth();

  const parsed = createQuoteSchema.safeParse({ ...(formData as Record<string, unknown>), serviceRequestId: requestId });
  if (!parsed.success) {
    return (await invalid(parsed.error)) as CreateQuoteActionResult;
  }

  const antiAbuse = makeAntiAbuseService();
  try {
    await antiAbuse.assertNotBlocked(user.id);
    await antiAbuse.enforceRateLimit("QUOTE_CREATE_BY_USER", { userId: user.id }, "QUOTE_RATE_LIMITED");
  } catch (error) {
    if (error instanceof DomainError) {
      return { success: false, error: await localizeActionError(error) } as CreateQuoteActionResult;
    }
    throw error;
  }

  try {
    const created = await makeCreateQuoteUseCase().execute(user.id, parsed.data);
    revalidatePath("/dashboard/professional/quotes");
    revalidatePath(`/dashboard/professional/requests/${requestId}`);
    revalidatePath(`/requests/${requestId}/quotes`);
    return { success: true, id: created.id };
  } catch (error) {
    const result = await fromDomainError(error, "submitQuote");
    return result as CreateQuoteActionResult;
  }
}

export async function updateQuoteAction(quoteId: string, formData: unknown): Promise<ActionResult> {
  const user = await requireAuth();

  const parsed = updateQuoteSchema.safeParse(formData);
  if (!parsed.success) {
    return invalid(parsed.error);
  }

  try {
    const updated = await makeUpdateQuoteUseCase().execute(user.id, quoteId, parsed.data);
    revalidatePath("/dashboard/professional/quotes");
    revalidatePath(`/dashboard/professional/quotes/${quoteId}`);
    revalidatePath(`/requests/${updated.serviceRequestId}/quotes`);
    return { success: true };
  } catch (error) {
    return fromDomainError(error, "updateQuote");
  }
}

export async function withdrawQuoteAction(quoteId: string): Promise<ActionResult> {
  const user = await requireAuth();

  try {
    // Fetched first (via the same ownership-checked use case) only to know
    // which customer-facing path to revalidate — WithdrawQuoteUseCase
    // itself re-checks ownership independently below.
    const quote = await makeGetProfessionalQuoteUseCase().execute(user.id, quoteId);
    await makeWithdrawQuoteUseCase().execute(user.id, quoteId);
    revalidatePath("/dashboard/professional/quotes");
    revalidatePath(`/dashboard/professional/quotes/${quoteId}`);
    revalidatePath(`/requests/${quote.serviceRequestId}/quotes`);
    return { success: true };
  } catch (error) {
    return fromDomainError(error, "withdrawQuote");
  }
}
