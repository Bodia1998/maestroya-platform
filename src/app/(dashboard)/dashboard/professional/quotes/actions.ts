"use server";

import { revalidatePath } from "next/cache";

import { DomainError } from "@/domain/errors/domain-error";
import { requireAuth } from "@/infrastructure/auth/rbac";
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

// Same translation convention as Service Request/Professional's actions.ts:
// domain errors surface their own (safe, user-facing) message, anything
// else is logged server-side and replaced with a generic message.
function fromDomainError(error: unknown, fallback: string): ActionResult {
  if (error instanceof DomainError) {
    return { success: false, error: error.message };
  }
  console.error(error);
  return { success: false, error: fallback };
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
    return {
      success: false,
      error: "Please fix the errors below.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const antiAbuse = makeAntiAbuseService();
  try {
    await antiAbuse.assertNotBlocked(user.id);
    await antiAbuse.enforceRateLimit("QUOTE_CREATE_BY_USER", { userId: user.id }, "QUOTE_RATE_LIMITED");
  } catch (error) {
    if (error instanceof DomainError) {
      return { success: false, error: error.message } as CreateQuoteActionResult;
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
    const result = fromDomainError(error, "Something went wrong submitting your quote.");
    return result as CreateQuoteActionResult;
  }
}

export async function updateQuoteAction(quoteId: string, formData: unknown): Promise<ActionResult> {
  const user = await requireAuth();

  const parsed = updateQuoteSchema.safeParse(formData);
  if (!parsed.success) {
    return {
      success: false,
      error: "Please fix the errors below.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  try {
    const updated = await makeUpdateQuoteUseCase().execute(user.id, quoteId, parsed.data);
    revalidatePath("/dashboard/professional/quotes");
    revalidatePath(`/dashboard/professional/quotes/${quoteId}`);
    revalidatePath(`/requests/${updated.serviceRequestId}/quotes`);
    return { success: true };
  } catch (error) {
    return fromDomainError(error, "Something went wrong updating your quote.");
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
    return fromDomainError(error, "Something went wrong withdrawing your quote.");
  }
}
