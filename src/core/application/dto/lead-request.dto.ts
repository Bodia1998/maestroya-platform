import { z } from "zod";

import type { ScopeQuestionnaireView } from "@/domain/services/lead-scope-questionnaire";
import { MAX_SERVICE_REQUEST_DESCRIPTION_LENGTH, MAX_SERVICE_REQUEST_TITLE_LENGTH } from "@/application/dto/service-request.dto";

/**
 * Module 142 — customer LEAD_V1 request form contract (client + Server Action).
 *
 * Deliberately a SEPARATE schema from the legacy `createServiceRequestSchema`
 * (which stays untouched): the stricter minimum lengths and text
 * normalization below must not change the legacy quote flow.
 *
 * Only fields the backend actually uses are accepted. Everything else —
 * `flowVersion`, `customerId`, `userId`, status, coordinates, budget — is
 * stripped by Zod (unknown keys are dropped) and therefore can never reach the
 * use case. Messages are Zod defaults / validation keys, resolved to the
 * user's language at the edge (see shared/i18n/validation-messages.ts).
 */
export const LEAD_REQUEST_TITLE_MIN_LENGTH = 5;
export const LEAD_REQUEST_DESCRIPTION_MIN_LENGTH = 20;

/**
 * Whitespace normalization for free text: unify line endings, collapse runs
 * of spaces/tabs, drop trailing spaces per line, keep at most one blank line
 * between paragraphs, trim the ends. Idempotent.
 */
export function normalizeFreeText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Single-line fields: every whitespace run (including newlines) becomes one space. */
export function normalizeSingleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

const text = (normalize: (v: string) => string, min: number, max: number) =>
  z
    .string()
    .transform(normalize)
    .pipe(z.string().min(1, "required").min(min).max(max));

/**
 * Module 163 — structured scope answers as submitted: question id -> option value (string) or integer. Shape only; whether the
 * ids/values are valid for the category's questionnaire is decided on the server by the domain (`evaluateScopeAnswers`), and an
 * answer that is not valid is REJECTED, never ignored. Free text and budget-like values cannot pass: values are short
 * option-shaped strings or safe integers, and unknown question ids are refused by the domain.
 */
export const MAX_SCOPE_ANSWERS = 30;
const scopeAnswersSchema = z
  .record(z.string().max(40), z.union([z.string().max(40), z.number().int().safe()]))
  .refine((answers) => Object.keys(answers).length <= MAX_SCOPE_ANSWERS, "invalid");

export const leadRequestSchema = z.object({
  categoryId: z.string().uuid("dto.categories.invalid"),
  title: text(normalizeSingleLine, LEAD_REQUEST_TITLE_MIN_LENGTH, MAX_SERVICE_REQUEST_TITLE_LENGTH),
  description: text(normalizeFreeText, LEAD_REQUEST_DESCRIPTION_MIN_LENGTH, MAX_SERVICE_REQUEST_DESCRIPTION_LENGTH),
  urgency: z.enum(["LOW", "MEDIUM", "HIGH", "EMERGENCY"]).optional(),
  /** Module 163: optional. Absent = no structured scope (the request is estimated exactly as before). */
  scopeAnswers: scopeAnswersSchema.optional(),
  location: z.object({
    line1: z.string().transform(normalizeSingleLine).pipe(z.string().min(1, "dto.address.street").max(200)),
    line2: z.string().transform(normalizeSingleLine).pipe(z.string().max(200)).optional(),
    city: z.string().transform(normalizeSingleLine).pipe(z.string().min(1, "dto.address.city").max(100)),
    province: z.string().transform(normalizeSingleLine).pipe(z.string().max(100)).optional(),
    postalCode: z.string().transform(normalizeSingleLine).pipe(z.string().min(1, "dto.address.postalCode").max(20)),
    country: z.string().transform(normalizeSingleLine).pipe(z.string().min(2, "dto.address.country").max(100)).default("ES"),
  }),
});
export type LeadRequestInput = z.infer<typeof leadRequestSchema>;
/** What the form holds before parsing (fields may still be raw/unnormalized). */
export type LeadRequestFormValues = z.input<typeof leadRequestSchema>;

/**
 * The ONLY thing a customer receives after submitting. No lead id, no
 * pricing, no publication/buyer/payment state, no contact data: the request's
 * own id (it is theirs) and a coarse acknowledgement.
 */
export interface CustomerLeadRequestReceipt {
  requestId: string;
  status: "RECEIVED";
}

/** Category option for the picker: id + localizable slug/name only. */
export interface LeadRequestCategoryOption {
  id: string;
  slug: string;
  name: string;
  /** Module 163: the customer-facing questionnaire for this category (ids, kinds, allowed values — never factors). Absent = none. */
  scope?: ScopeQuestionnaireView;
}
