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

/**
 * Module 22 — Commission & Financial addition: `category` distinguishes
 * labor from materials so commission (7.5% of labor only — see
 * domain/services/commission-policy.ts) is never calculated against
 * materials. Optional (rather than defaulted at the schema level) so the
 * *inferred TypeScript type* stays optional too — this keeps every
 * existing call site that builds a CreateQuoteInput/UpdateQuoteInput
 * object literal without a category (tests, and any client that hasn't
 * been updated to send one yet) compiling and behaving exactly as before.
 * CreateQuoteUseCase/UpdateQuoteUseCase coalesce a missing category to
 * "LABOR" when mapping to the repository layer — see those use cases'
 * own comments and QuoteItem.category's doc comment in schema.prisma for
 * why LABOR is the conservative default.
 */
export const quoteItemCategorySchema = z.enum(["LABOR", "MATERIALS"]).optional();

/**
 * Module 63 — Materials Procurement Workflow: who sources the materials
 * this Quote's work needs. Duplicates
 * `domain/value-objects/materials-strategy.ts`'s `MaterialsStrategyValue`
 * union rather than importing it — same "DTO layer duplicates the domain
 * vocabulary as a literal" convention `quoteItemCategorySchema` already
 * follows for `QuoteItemCategoryValue`. Optional, same reasoning as
 * `quoteItemCategorySchema`'s own doc comment: keeps the inferred type
 * optional so every pre-Module-63 caller/test that builds a
 * CreateQuoteInput/UpdateQuoteInput without one keeps compiling —
 * CreateQuoteUseCase/UpdateQuoteUseCase coalesce a missing value to
 * PROFESSIONAL_SUPPLIED (see materials-strategy.ts's
 * DEFAULT_MATERIALS_STRATEGY).
 */
export const materialsStrategySchema = z.enum(["PROFESSIONAL_SUPPLIED", "CUSTOMER_PURCHASED"]).optional();

export const MAX_MATERIALS_ITEMS = 50;
export const MAX_MATERIAL_NAME_LENGTH = 200;
export const MAX_MATERIAL_BRAND_LENGTH = 100;
export const MAX_MATERIAL_MODEL_LENGTH = 100;
export const MAX_MATERIAL_NOTES_LENGTH = 1000;
export const MAX_MATERIAL_QUANTITY = 100000;

/**
 * One line of the required-materials checklist a professional attaches
 * when materialsStrategy is CUSTOMER_PURCHASED — e.g. "Bosch Condens
 * 2300iW boiler", qty 1. No price field, unlike quoteItemSchema — this
 * list only ever tells the customer what to buy, never prices anything
 * (see domain/repositories/quote-repository.ts's QuoteMaterialInput).
 */
export const quoteMaterialSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter a name for this material.")
    .max(MAX_MATERIAL_NAME_LENGTH, `Material name must be ${MAX_MATERIAL_NAME_LENGTH} characters or fewer.`),
  brand: z.string().trim().max(MAX_MATERIAL_BRAND_LENGTH).optional().or(z.literal("")),
  model: z.string().trim().max(MAX_MATERIAL_MODEL_LENGTH).optional().or(z.literal("")),
  quantity: z.coerce
    .number()
    .positive("Quantity must be greater than zero.")
    .max(MAX_MATERIAL_QUANTITY, "Enter a realistic quantity."),
  notes: z.string().trim().max(MAX_MATERIAL_NOTES_LENGTH).optional().or(z.literal("")),
});
export type QuoteMaterialInput = z.infer<typeof quoteMaterialSchema>;

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
  category: quoteItemCategorySchema,
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
  // Module 63 — Materials Procurement Workflow.
  materialsStrategy: materialsStrategySchema,
  materials: z
    .array(quoteMaterialSchema)
    .max(MAX_MATERIALS_ITEMS, `A materials list can have at most ${MAX_MATERIALS_ITEMS} items.`)
    .optional(),
});

/**
 * Module 63 — Materials Procurement Workflow's central business rule at
 * the DTO layer: "If Purchased by customer, the professional must provide
 * a required materials list." This is UX-layer fast feedback only — the
 * authoritative check every use case actually trusts is
 * `domain/services/materials-procurement-rules.ts`'s
 * `assertValidMaterialsList`, run again server-side after this schema
 * parses (same "DTO refinement mirrors the domain rule, domain rule is
 * the real gate" split every other cross-field rule in this codebase
 * follows).
 */
function requireMaterialsWhenCustomerPurchased(
  data: { materialsStrategy?: (typeof materialsStrategySchema)["_output"]; materials?: QuoteMaterialInput[] },
  ctx: z.RefinementCtx,
): void {
  if (data.materialsStrategy === "CUSTOMER_PURCHASED" && (!data.materials || data.materials.length === 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["materials"],
      message: "Add at least one required material when materials are purchased by the customer.",
    });
  }
}

export const createQuoteSchema = quoteFieldsSchema
  .extend({
    serviceRequestId: z.string().uuid("Invalid service request."),
  })
  .superRefine(requireMaterialsWhenCustomerPurchased);
export type CreateQuoteInput = z.infer<typeof createQuoteSchema>;

// Update reuses the same field-level rules as create, but never accepts a
// serviceRequestId — the ServiceRequest a quote belongs to can never change
// (see UpdateQuoteFields' doc comment).
export const updateQuoteSchema = quoteFieldsSchema.superRefine(requireMaterialsWhenCustomerPurchased);
export type UpdateQuoteInput = z.infer<typeof updateQuoteSchema>;

export const listProfessionalQuotesSchema = z.object({
  status: z
    .enum(["PENDING", "SENT", "VIEWED", "ACCEPTED", "REJECTED", "EXPIRED", "WITHDRAWN"])
    .optional(),
});
export type ListProfessionalQuotesInput = z.infer<typeof listProfessionalQuotesSchema>;
