import { z } from "zod";

import { LEAD_ADMIN_DEFAULT_PAGE_SIZE, LEAD_ADMIN_MAX_OFFSET, LEAD_ADMIN_MAX_PAGE_SIZE } from "@/domain/services/lead-admin-console";
import { LEAD_ESTIMATE_OUTCOME_NOTE_MAX_LENGTH } from "@/domain/services/lead-estimate-outcome";
import { LEAD_PRICING_REVIEW_NOTE_MAX_LENGTH, LEAD_PRICING_REVIEW_STATUSES } from "@/domain/services/lead-pricing-review";

/**
 * Module 164 — input schemas of the pricing-review Server Actions (shape validation at the boundary; the use cases validate again
 * and stay the authority). Deliberately absent: the acting administrator (always `requireRole`'s session user). Messages are
 * validation keys, not prose.
 */
const uuid = z.string({ required_error: "required", invalid_type_error: "invalid" }).trim().uuid("invalid");
const money = z.string({ required_error: "required", invalid_type_error: "invalid" }).trim().regex(/^\d{1,12}(\.\d{1,2})?$/, "invalid");
const optionalNote = (max: number) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string({ invalid_type_error: "invalid" }).trim().max(max, "invalid").optional(),
  );

export const listLeadPricingReviewsSchema = z.object({
  status: z.preprocess((v) => (v === "" ? undefined : v), z.enum(LEAD_PRICING_REVIEW_STATUSES).optional()),
  limit: z.coerce.number().int().min(1).max(LEAD_ADMIN_MAX_PAGE_SIZE).default(LEAD_ADMIN_DEFAULT_PAGE_SIZE),
  offset: z.coerce.number().int().min(0).max(LEAD_ADMIN_MAX_OFFSET).default(0),
});

export const leadPricingReviewIdSchema = z.object({ reviewId: uuid });

export const decideLeadPricingReviewSchema = z.discriminatedUnion("outcome", [
  z.object({ reviewId: uuid, outcome: z.literal("APPROVED"), reviewedJobValue: money, note: optionalNote(LEAD_PRICING_REVIEW_NOTE_MAX_LENGTH) }),
  z.object({ reviewId: uuid, outcome: z.literal("REJECTED"), note: optionalNote(LEAD_PRICING_REVIEW_NOTE_MAX_LENGTH) }),
]);

export const recordLeadEstimateOutcomeSchema = z.object({
  leadId: uuid,
  actualJobValue: money,
  note: optionalNote(LEAD_ESTIMATE_OUTCOME_NOTE_MAX_LENGTH),
});
