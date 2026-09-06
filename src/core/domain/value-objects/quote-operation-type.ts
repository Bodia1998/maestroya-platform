/**
 * Module 97 — Tax & IVA Production Integration, Phase 4.
 *
 * The legally-relevant "what kind of work is this" characteristic of a
 * Quote's operation. Deliberately identical to the Prisma
 * `QuoteOperationType` enum (`prisma/schema.prisma`, Quote model) —
 * duplicated rather than imported from `@prisma/client`, the same
 * discipline every other value-object in this directory follows.
 *
 * This value alone never decides a tax rate — see
 * `domain/services/spain-community-iva-classification-policy.ts`, which
 * combines it with customer type, property use, and the materials ratio.
 */
export const QUOTE_OPERATION_TYPES = ["RENOVATION_OR_REPAIR", "MAINTENANCE", "OTHER"] as const;

export type QuoteOperationTypeValue = (typeof QUOTE_OPERATION_TYPES)[number];

export function isQuoteOperationType(value: unknown): value is QuoteOperationTypeValue {
  return typeof value === "string" && (QUOTE_OPERATION_TYPES as readonly string[]).includes(value);
}
