import { z } from "zod";

import { MAX_DESCRIPTION_LENGTH, MAX_TITLE_LENGTH, MIN_TITLE_LENGTH } from "@/domain/services/portfolio-rules";

/**
 * Portfolio module (Module 14). Same convention as review.dto.ts: one
 * schema shared by the client form/action caller and the Server Action
 * that receives it.
 *
 * Deliberately absent from every schema here: `professionalProfileId`/
 * `id` for the owning professional — ownership is always derived
 * server-side from the authenticated session (see CreatePortfolioItemUseCase/
 * UpdatePortfolioItemUseCase), never accepted as client input.
 */

export const createPortfolioItemSchema = z.object({
  title: z
    .string()
    .trim()
    .min(MIN_TITLE_LENGTH, `Title must be at least ${MIN_TITLE_LENGTH} characters.`)
    .max(MAX_TITLE_LENGTH, `Title must be ${MAX_TITLE_LENGTH} characters or fewer.`),
  description: z
    .string()
    .trim()
    .max(MAX_DESCRIPTION_LENGTH, `Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer.`)
    .optional()
    .or(z.literal("")),
  mediaUrl: z.string().trim().url("Enter a valid media URL."),
  serviceCategoryId: z.string().uuid("Invalid service category.").optional().or(z.literal("")),
});
export type CreatePortfolioItemInput = z.infer<typeof createPortfolioItemSchema>;

// Update reuses the same field-level rules as create — every field is
// fully resupplied, same "no partial patch" convention as
// UpdateQuoteInput/quote.dto.ts.
export const updatePortfolioItemSchema = createPortfolioItemSchema;
export type UpdatePortfolioItemInput = z.infer<typeof updatePortfolioItemSchema>;

export const listPortfolioItemsSchema = z.object({
  professionalProfileId: z.string().uuid("Invalid professional."),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListPortfolioItemsInput = z.infer<typeof listPortfolioItemsSchema>;
