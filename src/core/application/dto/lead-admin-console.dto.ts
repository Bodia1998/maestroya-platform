import { z } from "zod";

import { LEAD_STATUSES } from "@/domain/services/lead";
import { LEAD_ABUSE_RESTRICTED_ACTIONS } from "@/domain/services/lead-abuse-controls";
import {
  LEAD_ADMIN_DEFAULT_PAGE_SIZE,
  LEAD_ADMIN_MAX_OFFSET,
  LEAD_ADMIN_MAX_PAGE_SIZE,
  LEAD_ADMIN_MAX_SEARCH_LENGTH,
} from "@/domain/services/lead-admin-console";
import { LEAD_FEE_DISPUTE_STATUSES } from "@/domain/services/lead-fee-dispute";
import { LEAD_PURCHASE_STATUSES } from "@/domain/services/lead-purchase";
import { LEAD_QUALITY_CLAIM_DECISIONS, LEAD_QUALITY_CLAIM_STATUSES } from "@/domain/services/lead-quality-claim";

/**
 * Module 157 — input schemas of the console's Server Actions (shape validation at the boundary; the use cases validate again).
 *
 * Deliberately absent from every schema: the acting administrator's id or role (always taken from the session by `requireRole`),
 * and every actor/ownership claim. Identifiers are uuids; free text is length-bounded here and checked for control characters,
 * contact-like content and the exact M154/M155/M156 limits by the owning use case, which stays the authority. Messages are
 * validation keys, not prose (docs/MODULE_120_LOCALIZATION_CONVENTIONS.md §4).
 */

const uuid = z.string({ required_error: "required", invalid_type_error: "invalid" }).trim().uuid("invalid");
const text = (max: number) =>
  z.string({ required_error: "required", invalid_type_error: "invalid" }).trim().min(1, "required").max(max, "invalid");
const optionalUuid = z.preprocess((v) => (v === "" || v === null ? undefined : v), uuid.optional());
const optionalText = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.string({ invalid_type_error: "invalid" }).trim().max(LEAD_ADMIN_MAX_SEARCH_LENGTH, "invalid").optional(),
);
const optionalEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess((v) => (v === "" || v === null ? undefined : v), z.enum(values, { invalid_type_error: "invalid" }).optional());
const optionalDate = z.preprocess(
  (v) => (v === "" || v === null ? undefined : v),
  z.string({ invalid_type_error: "invalid" }).refine((s) => !Number.isNaN(new Date(s).getTime()), "invalid").optional(),
);

const page = {
  limit: z.coerce.number().int("invalid").min(1, "invalid").max(LEAD_ADMIN_MAX_PAGE_SIZE, "invalid").default(LEAD_ADMIN_DEFAULT_PAGE_SIZE),
  offset: z.coerce.number().int("invalid").min(0, "invalid").max(LEAD_ADMIN_MAX_OFFSET, "invalid").default(0),
};

export const listAdminLeadsSchema = z.object({
  leadId: optionalUuid,
  status: optionalEnum(LEAD_STATUSES),
  purchaseStatus: optionalEnum(LEAD_PURCHASE_STATUSES),
  categoryId: optionalUuid,
  region: optionalText,
  city: optionalText,
  createdFrom: optionalDate,
  createdTo: optionalDate,
  ...page,
});

export const listAdminLeadClaimsSchema = z.object({ status: optionalEnum(LEAD_QUALITY_CLAIM_STATUSES), ...page });
export const listAdminLeadDisputesSchema = z.object({ status: optionalEnum(LEAD_FEE_DISPUTE_STATUSES), ...page });

export const adminLeadIdSchema = z.object({ leadId: uuid });
export const adminAbuseSubjectSchema = z.object({ subjectUserId: uuid });

// ------------------------------------------------------------------ mutations (each delegates to an M154 / M155 / M156 use case)

export const startClaimReviewSchema = z.object({ claimId: uuid });

export const decideClaimSchema = z.object({
  claimId: uuid,
  decision: z.enum(LEAD_QUALITY_CLAIM_DECISIONS, { required_error: "required", invalid_type_error: "invalid" }),
  explanation: text(1000),
});

export const revokePurchaseSchema = z.object({
  leadPurchaseId: uuid,
  explanation: text(1000),
  evidenceReference: text(200),
});

/** Block length in whole minutes, 30 minutes .. 30 days (M156's own bounds are re-checked by `ImposeLeadAbuseBlockUseCase`). */
export const imposeAbuseBlockSchema = z.object({
  subjectUserId: uuid,
  restrictedAction: z.enum(LEAD_ABUSE_RESTRICTED_ACTIONS, { required_error: "required", invalid_type_error: "invalid" }),
  durationMinutes: z.coerce.number({ invalid_type_error: "invalid" }).int("invalid").min(30, "invalid").max(30 * 24 * 60, "invalid"),
  explanation: text(500),
});

export const liftAbuseDecisionSchema = z.object({ decisionId: uuid, note: text(500) });

export type ListAdminLeadsInputDto = z.infer<typeof listAdminLeadsSchema>;
