/**
 * Offers/Quotes module — money arithmetic helper.
 *
 * `Quote.totalAmount` and `QuoteItem.quantity`/`unitPrice`/`amount` are all
 * Prisma `Decimal(10, 2)` columns. Following the same convention already
 * used everywhere else in this codebase (see PrismaServiceRequestRepository
 * and PrismaProfessionalRepository converting `Decimal` <-> plain `number`
 * at the repository boundary rather than depending on an arbitrary-
 * precision decimal library), this module works with plain `number`s in the
 * application layer and rounds to whole cents at every arithmetic step, so
 * a QuoteItem's `amount` and a Quote's `totalAmount` are always internally
 * consistent and never accumulate floating-point drift across line items.
 *
 * Kept as a small, dependency-free domain service (same style as
 * geo-distance.ts) so the calculation is independently unit-testable and
 * has exactly one definition, rather than being reimplemented inline in
 * CreateQuoteUseCase and UpdateQuoteUseCase.
 */

export interface QuoteItemAmountInput {
  quantity: number;
  unitPrice: number;
}

/** Rounds a monetary value to 2 decimal places (whole cents). */
export function roundToCents(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

/** A single QuoteItem's line amount — always `quantity * unitPrice`, never
 *  trusted from client input even if the client also sent an `amount`. */
export function calculateQuoteItemAmount(quantity: number, unitPrice: number): number {
  return roundToCents(quantity * unitPrice);
}

/** A Quote's total — always the sum of its own items' calculated amounts,
 *  never a client-supplied total. */
export function calculateQuoteTotal(items: QuoteItemAmountInput[]): number {
  const total = items.reduce(
    (sum, item) => sum + calculateQuoteItemAmount(item.quantity, item.unitPrice),
    0,
  );
  return roundToCents(total);
}
