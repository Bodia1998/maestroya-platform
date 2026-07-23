import { z } from "zod";

/**
 * Offers/Quotes module. Same convention as service-request.dto.ts/
 * professional.dto.ts: one schema shared by the client form (via
 * @hookform/resolvers/zod) and the Server Action that receives it.
 *
 * Deliberately absent from every schema here: `totalAmount`,
 * `professionalProfileId`, `submittedByUserId`, `serviceRequestId` (on
 * update), and `status`. Totals are always calculated server-side from
 * `items` (see domain/services/money.ts) — a client-supplied total is never
 * trusted even if present. Ownership fields are always derived from the
 * authenticated session (see CreateQuoteUseCase/UpdateQuoteUseCase). Status
 * changes go through their own dedicated actions (withdraw), never through
 * this general-purpose input.
 */

export const MAX_QUOTE_ITEMS = 20;
export const MAX_QUOTE_ITEM_DESCRIPTION_LENGTH = 300;
export const MAX_QUOTE_NOTES_LENGTH = 3000;
export const MAX_QUOTE_ITEM_QUANTITY = 100000;
export const MAX_QUOTE_ITEM_UNIT_PRICE = 1000000;

export const quoteItemSchema = z.object({
  description: z
    .string()
    .trim()
    .min(1, "Enter a description for this item.")
    .max(
      MAX_QUOTE_ITEM_DESCRIPTION_LENGTH,
      `Item description must be ${MAX_QUOTE_ITEM_DESCRIPTION_LENGTH} characters or fewer.`,
    ),
  quantity: z.coerce
    .number()
    .positive("Quantity must be greater than zero.")
    .max(MAX_QUOTE_ITEM_QUANTITY, "Enter a realistic quantity."),
  unitPrice: z.coerce
    .number()
    .min(0, "Unit price cannot be negative.")
    .max(MAX_QUOTE_ITEM_UNIT_PRICE, "Enter a realistic unit price."),
});
export type QuoteItemInput = z.infer<typeof quoteItemSchema>;

/**
 * Shared by create and update — a quote's price is always expressed as a
 * list of line items (the schema supports QuoteItem, so this module always
 * uses it rather than a single freeform amount), and its total is always
 * derived from those items, never accepted directly (see money.ts).
 */
const quoteFieldsSchema = z.object({
  items: z
    .array(quoteItemSchema)
    .min(1, "Add at least one item to your quote.")
    .max(MAX_QUOTE_ITEMS, `A quote can have at most ${MAX_QUOTE_ITEMS} items.`),
  notes: z.string().trim().max(MAX_QUOTE_NOTES_LENGTH).optional().or(z.literal("")),
  validUntil: z.coerce
    .date({ invalid_type_error: "Enter a valid date." })
    .optional()
    .refine((date) => date === undefined || date.getTime() > Date.now(), {
      message: "Validity date must be in the future.",
    }),
});

export const createQuoteSchema = quoteFieldsSchema.extend({
  serviceRequestId: z.string().uuid("Invalid service request."),
});
export type CreateQuoteInput = z.infer<typeof createQuoteSchema>;

// Update reuses the same field-level rules as create, but never accepts a
// serviceRequestId — the ServiceRequest a quote belongs to can never change
// (see UpdateQuoteFields' doc comment).
export const updateQuoteSchema = quoteFieldsSchema;
export type UpdateQuoteInput = z.infer<typeof updateQuoteSchema>;

export const listProfessionalQuotesSchema = z.object({
  status: z
    .enum(["PENDING", "SENT", "VIEWED", "ACCEPTED", "REJECTED", "EXPIRED", "WITHDRAWN"])
    .optional(),
});
export type ListProfessionalQuotesInput = z.infer<typeof listProfessionalQuotesSchema>;
