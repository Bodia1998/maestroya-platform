/**
 * Module 63 — Materials Procurement Workflow.
 *
 * A Quote's materials strategy: who is responsible for sourcing the
 * materials the quoted work requires. Deliberately identical to the
 * Prisma `MaterialsStrategy` enum (`prisma/schema.prisma`, Quote model) —
 * duplicated rather than imported from `@prisma/client` so the domain
 * layer stays framework-agnostic, the same discipline
 * `value-objects/payment-status.ts` already follows for `PaymentStatus`.
 *
 * - `PROFESSIONAL_SUPPLIED` — today's existing behavior, unchanged by this
 *   module: the professional's quoted price already includes materials.
 *   This is the default for every Quote, including every one created
 *   before this module existed.
 * - `CUSTOMER_PURCHASED` — the professional instead hands the customer a
 *   required shopping list (see `QuoteMaterialInput`/`QuoteMaterialRecord`
 *   in `domain/repositories/quote-repository.ts`) that the customer must
 *   buy themselves and then explicitly confirm before the booked work can
 *   begin. See `materials-procurement-rules.ts` for the validation and
 *   gating rules this strategy triggers.
 */
export const MATERIALS_STRATEGIES = ["PROFESSIONAL_SUPPLIED", "CUSTOMER_PURCHASED"] as const;

export type MaterialsStrategyValue = (typeof MATERIALS_STRATEGIES)[number];

export function isMaterialsStrategy(value: unknown): value is MaterialsStrategyValue {
  return typeof value === "string" && (MATERIALS_STRATEGIES as readonly string[]).includes(value);
}

/** Conservative default applied everywhere a strategy isn't explicitly
 *  supplied (DTO parsing, repository writes for pre-Module-63 call sites,
 *  etc.) — see this file's own doc comment for why. */
export const DEFAULT_MATERIALS_STRATEGY: MaterialsStrategyValue = "PROFESSIONAL_SUPPLIED";
