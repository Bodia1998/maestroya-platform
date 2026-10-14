"use server";

import { revalidatePath } from "next/cache";

import { leadAdminActionFailure } from "./_lib/lead-action-errors";
import {
  decideLeadPricingReviewSchema,
  leadPricingReviewIdSchema,
  listLeadPricingReviewsSchema,
  recordLeadEstimateOutcomeSchema,
} from "@/application/dto/lead-pricing-review.dto";
import {
  makeDecideLeadPricingReviewUseCase,
  makeGetLeadPricingReviewUseCase,
  makeListLeadPricingReviewsUseCase,
  makeRecordLeadEstimateOutcomeUseCase,
} from "@/application/use-cases/lead-pricing-review/compose";
import type { LeadPricingReviewRecord } from "@/domain/services/lead-pricing-review";
import { ROLES, requireRole } from "@/infrastructure/auth/rbac";
import { localizeZodError } from "@/presentation/i18n/server";

/**
 * Module 164 — administrator boundary of the lead pricing review path. Same discipline as the M157 console actions:
 *  1. `requireRole(ADMIN, SUPER_ADMIN)` is the FIRST statement of every export (reads and mutations alike);
 *  2. the acting administrator is `admin.id` from the session — no schema has an actor field;
 *  3. input is Zod-validated here and validated again by the use case, which re-reads the administrator and stays the authority;
 *  4. no business rule lives here: the use cases own the state machine, the pricing check and the idempotency;
 *  5. failures become a localized, closed message; nothing from the database ever reaches the browser.
 *
 * A decision never publishes a lead: publication stays the customer's idempotent publish call, which re-prices at that moment.
 */
export type PricingReviewActionResult<T = undefined> = { success: true; data: T } | { success: false; error: string };

const REVIEWS_PATH = "/admin/leads";

export async function listLeadPricingReviewsAction(input: Record<string, unknown> = {}): Promise<PricingReviewActionResult<LeadPricingReviewRecord[]>> {
  const admin = await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
  const parsed = listLeadPricingReviewsSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: await localizeZodError(parsed.error) };
  try {
    return { success: true, data: await makeListLeadPricingReviewsUseCase().execute(admin.id, parsed.data) };
  } catch (error) {
    return leadAdminActionFailure(error, "loadingPricingReviews");
  }
}

export async function getLeadPricingReviewAction(reviewId: string): Promise<PricingReviewActionResult<LeadPricingReviewRecord>> {
  const admin = await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
  const parsed = leadPricingReviewIdSchema.safeParse({ reviewId });
  if (!parsed.success) return { success: false, error: await localizeZodError(parsed.error) };
  try {
    return { success: true, data: await makeGetLeadPricingReviewUseCase().execute(admin.id, parsed.data.reviewId) };
  } catch (error) {
    return leadAdminActionFailure(error, "loadingPricingReviews");
  }
}

/** APPROVED (with the assessed average job value) | REJECTED. A decision only: nothing is published or re-priced here. */
export async function decideLeadPricingReviewAction(input: Record<string, unknown>): Promise<PricingReviewActionResult<LeadPricingReviewRecord>> {
  const admin = await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
  const parsed = decideLeadPricingReviewSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: await localizeZodError(parsed.error) };
  try {
    const { reviewId, ...decision } = parsed.data;
    const record = await makeDecideLeadPricingReviewUseCase().execute(admin.id, reviewId, decision);
    revalidatePath(REVIEWS_PATH, "layout");
    return { success: true, data: record };
  } catch (error) {
    return leadAdminActionFailure(error, "decidingPricingReview");
  }
}

/** Records the actual job value of a published lead (measurement only — it never changes a price). */
export async function recordLeadEstimateOutcomeAction(input: Record<string, unknown>): Promise<PricingReviewActionResult> {
  const admin = await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
  const parsed = recordLeadEstimateOutcomeSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: await localizeZodError(parsed.error) };
  try {
    await makeRecordLeadEstimateOutcomeUseCase().execute(admin.id, parsed.data.leadId, { actualJobValue: parsed.data.actualJobValue, note: parsed.data.note });
    return { success: true, data: undefined };
  } catch (error) {
    return leadAdminActionFailure(error, "recordingEstimateOutcome");
  }
}
