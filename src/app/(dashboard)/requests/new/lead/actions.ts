"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";

import { DomainError, UnauthorizedError } from "@/domain/errors/domain-error";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { logger } from "@/infrastructure/observability/logger";
import { leadRequestSchema, type CustomerLeadRequestReceipt } from "@/application/dto/lead-request.dto";
import { makeAntiAbuseService } from "@/application/use-cases/security/compose";
import { makeSubmitLeadRequestUseCase } from "@/application/use-cases/lead-request/compose";
import { LeadRequestCategoryUnsupportedError } from "@/application/use-cases/lead-request/submit-lead-request.use-case";
import { localizeActionError, localizeZodFieldErrors } from "@/presentation/i18n/server";

/**
 * Module 142 — customer "Request a service" submission (Server Action).
 *
 * Thin by design: authenticate -> validate -> abuse protection -> ONE use
 * case -> map the outcome. Identity is the session user ONLY; the schema
 * strips any client-sent owner/flow/status/id field, and the use case forces
 * LEAD_V1. The result is an explicit customer-safe shape — never a lead,
 * pricing, publication, payment or contact record.
 */
export type SubmitLeadRequestActionResult =
  | { success: true; receipt: CustomerLeadRequestReceipt }
  | { success: false; code: "UNAUTHENTICATED" | "INVALID" | "CATEGORY_UNSUPPORTED" | "FAILED"; error: string; fieldErrors?: Record<string, string[]> };

export async function submitLeadRequestAction(formData: unknown): Promise<SubmitLeadRequestActionResult> {
  const t = await getTranslations("customer.requests.leadForm");

  let user: Awaited<ReturnType<typeof requireAuth>>;
  try {
    user = await requireAuth();
  } catch (error) {
    if (error instanceof UnauthorizedError) return { success: false, code: "UNAUTHENTICATED", error: t("errors.unauthenticated") };
    throw error;
  }

  const parsed = leadRequestSchema.safeParse(formData);
  if (!parsed.success) {
    const tValidation = await getTranslations("validation");
    return {
      success: false,
      code: "INVALID",
      error: tValidation("summary"),
      fieldErrors: await localizeZodFieldErrors(parsed.error),
    };
  }

  const antiAbuse = makeAntiAbuseService();
  try {
    await antiAbuse.assertNotBlocked(user.id);
    await antiAbuse.enforceRateLimit("SERVICE_REQUEST_CREATE_BY_USER", { userId: user.id }, "SERVICE_REQUEST_RATE_LIMITED");
  } catch (error) {
    if (error instanceof DomainError) return { success: false, code: "FAILED", error: await localizeActionError(error) };
    throw error;
  }

  try {
    const { receipt, publication } = await makeSubmitLeadRequestUseCase().execute(user.id, parsed.data);
    if (publication === "DEFERRED") logger.warn("lead_request.publication_deferred", { requestId: receipt.requestId });
    revalidatePath("/requests");
    return { success: true, receipt };
  } catch (error) {
    if (error instanceof LeadRequestCategoryUnsupportedError) {
      return {
        success: false,
        code: "CATEGORY_UNSUPPORTED",
        error: t("errors.categoryUnsupported"),
        fieldErrors: { categoryId: [t("errors.categoryUnsupported")] },
      };
    }
    return { success: false, code: "FAILED", error: await localizeActionError(error, t("errors.submitFailed")) };
  }
}
