"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";

import { DomainError } from "@/domain/errors/domain-error";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { createServiceRequestSchema } from "@/application/dto/service-request.dto";
import {
  makeCreateLeadV1ServiceRequestUseCase,
  makePublishLeadUseCase,
} from "@/application/use-cases/lead/compose";
import { makeAntiAbuseService } from "@/application/use-cases/security/compose";
import { localizeActionError, localizeZodFieldErrors } from "@/presentation/i18n/server";

/**
 * Module 125 — Lead Marketplace customer entry points (Server Actions).
 * Thin by design: authenticate, validate, rate-limit, call ONE use case,
 * map errors. No business rule lives here. Identity is always the session
 * user; the request body never carries (and the schemas strip) customer /
 * owner / user ids or a flow version.
 */
export type CreateLeadServiceRequestResult =
  | { success: true; serviceRequestId: string; leadId: string }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

export type PublishLeadResult = { success: true; leadId: string } | { success: false; error: string };

const publishLeadSchema = z.object({ leadId: z.string().uuid() });

/** Creates a LEAD_V1 ServiceRequest + its DRAFT Lead (does NOT publish). */
export async function createLeadServiceRequestAction(formData: unknown): Promise<CreateLeadServiceRequestResult> {
  const user = await requireAuth();

  const parsed = createServiceRequestSchema.safeParse(formData);
  if (!parsed.success) {
    const tValidation = await getTranslations("validation");
    return {
      success: false,
      error: tValidation("summary"),
      fieldErrors: await localizeZodFieldErrors(parsed.error),
    };
  }

  // Same marketplace-abuse protection as the legacy creation action.
  const antiAbuse = makeAntiAbuseService();
  try {
    await antiAbuse.assertNotBlocked(user.id);
    await antiAbuse.enforceRateLimit("SERVICE_REQUEST_CREATE_BY_USER", { userId: user.id }, "SERVICE_REQUEST_RATE_LIMITED");
  } catch (error) {
    if (error instanceof DomainError) return { success: false, error: await localizeActionError(error) };
    throw error;
  }

  try {
    const { serviceRequest, lead } = await makeCreateLeadV1ServiceRequestUseCase().execute(user.id, parsed.data);
    revalidatePath("/requests");
    return { success: true, serviceRequestId: serviceRequest.id, leadId: lead.id };
  } catch (error) {
    const t = await getTranslations("customer");
    return { success: false, error: await localizeActionError(error, t("requests.errors.createFailed")) };
  }
}

/** Publishes the signed-in customer's own DRAFT Lead (idempotent). */
export async function publishLeadAction(leadId: unknown): Promise<PublishLeadResult> {
  const user = await requireAuth();

  const parsed = publishLeadSchema.safeParse({ leadId });
  if (!parsed.success) {
    const tValidation = await getTranslations("validation");
    return { success: false, error: tValidation("summary") };
  }

  try {
    const lead = await makePublishLeadUseCase().execute(user.id, parsed.data.leadId);
    revalidatePath("/requests");
    return { success: true, leadId: lead.id };
  } catch (error) {
    const t = await getTranslations("customer");
    return { success: false, error: await localizeActionError(error, t("requests.errors.updateFailed")) };
  }
}
